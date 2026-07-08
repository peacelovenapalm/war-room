/**
 * Progression store (v1 mechanic #3) — server-side XP, level, daily-use
 * streak, and unlock flags.
 *
 * Lives server-side (not per-browser) per Greg's 2026-07-07 decision: one
 * user, many screens — progression must be shared across devices and
 * survive cache clears. Persisted like shiftStats.ts, at
 * ~/.pixel-agents/progression.json.
 *
 * HARD GUARDRAIL (no dark patterns on real money): XP comes ONLY from real,
 * observed events —
 *   - a completed turn (hook Stop, Claude sessions only — same exclusion
 *     shiftStats applies to coworker heartbeats),
 *   - an OBSERVED crisis resolution (a real state transition away from
 *     blocked) — never a stale/TTL sweep clear, which just means the poller
 *     went quiet and the session may still be stuck,
 *   - a shift-report day closing with a grade (LEAN/STEADY/HEAVY, wired via
 *     ShiftStats' onDayClose callback) — never token volume itself.
 * Nothing here ever reads token counts. Burning more tokens earns nothing.
 *
 * The daily-use STREAK is the M5 soak mechanic made literal: a local-
 * calendar day counts once real session activity (a completed turn) is
 * observed that day. Consecutive days increment it; a gap resets it to 1.
 *
 * Unlock flags are DATA ONLY in this wave — mechanic #5 (expression/decor)
 * consumes them later. Flags are permanent achievements: once true, they
 * never revert (e.g. a broken streak doesn't un-unlock what it already
 * earned).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LAYOUT_FILE_DIR } from './constants.js';
import type { ShiftReport } from './shiftStats.js';

const PERSIST_THROTTLE_MS = 5_000;
const PROGRESSION_FILE_NAME = 'progression.json';

/** Resolved lazily — test suites mock os.homedir with values that only exist
 *  after their setup runs (same rationale as shiftStats.ts). */
function defaultProgressionFile(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, PROGRESSION_FILE_NAME);
}

// ── XP sources (tuned small; frequency, not size, drives growth) ──────────
export const XP_TURN_COMPLETED = 5;
export const XP_CRISIS_RESOLVED = 15;
/** Shift-grade bonus, awarded once per day at rollover. LOWER spend grades
 *  better and earns MORE — never the reverse (no-dark-patterns guardrail). */
export const XP_SHIFT_GRADE_BONUS: Record<NonNullable<ShiftReport['efficiency']>, number> = {
  LEAN: 50,
  STEADY: 20,
  HEAVY: 0,
};

/** XP required to REACH a given level from 0 (level 1 = the starting level). */
export function xpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < level; l++) total += 100 + 50 * (l - 1);
  return total;
}

export interface LevelInfo {
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
}

export function computeLevel(xp: number): LevelInfo {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  const floor = xpForLevel(level);
  const ceil = xpForLevel(level + 1);
  return { level, xpIntoLevel: xp - floor, xpForNextLevel: ceil - floor };
}

interface StreakState {
  current: number;
  longest: number;
  /** Local-calendar date (YYYY-MM-DD) of the last day real activity was observed. */
  lastActiveDate: string | null;
}

/** Persisted progression state. */
interface ProgressionData {
  xp: number;
  streak: StreakState;
  /** Cumulative count of LEAN-graded shift days (feeds an unlock). */
  leanDayCount: number;
  /** Permanent achievement flags — data only; mechanic #5 renders decor from these. */
  unlocks: Record<string, boolean>;
}

/** Broadcast-friendly snapshot (what goes out over the WS plane / GET /api/progression). */
export interface ProgressionSnapshot {
  xp: number;
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  streakCurrent: number;
  streakLongest: number;
  unlocks: Record<string, boolean>;
}

/** Day-close summary ShiftStats hands to the progression store's onDayClose hook. */
export interface DayCloseSummary {
  date: string;
  turnsCompleted: number;
  efficiency: ShiftReport['efficiency'];
}

/**
 * Unlock definitions — DATA ONLY. Mechanic #5 (expression pass) will map
 * these keys to actual decor/furniture; nothing renders from them yet.
 */
const UNLOCK_KEYS = [
  'streakBronze', // 3-day streak
  'streakSilver', // 7-day streak
  'streakGold', // 30-day streak (the M5 soak length)
  'leanGrade5', // 5 cumulative LEAN-graded shift days
  'level5',
  'level10',
] as const;
export type UnlockKey = (typeof UNLOCK_KEYS)[number];

function emptyData(): ProgressionData {
  const unlocks: Record<string, boolean> = {};
  for (const key of UNLOCK_KEYS) unlocks[key] = false;
  return {
    xp: 0,
    streak: { current: 0, longest: 0, lastActiveDate: null },
    leanDayCount: 0,
    unlocks,
  };
}

function localDate(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole-day gap between two YYYY-MM-DD local-calendar dates. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const msPerDay = 86_400_000;
  const da = new Date(ay, am - 1, ad).getTime();
  const db = new Date(by, bm - 1, bd).getTime();
  return Math.round((db - da) / msPerDay);
}

export class ProgressionStore {
  private data: ProgressionData | null = null;
  private lastPersistAt = 0;
  private explicitPath: string | undefined;
  private resolvedPath: string | undefined;
  private usingDefaultPath = false;
  private listeners: Array<(snapshot: ProgressionSnapshot) => void> = [];

  constructor(persistPath?: string) {
    this.explicitPath = persistPath;
  }

  /** Subscribe to progression changes (fired after every XP/streak/unlock
   *  mutation). Returns an unsubscribe function. */
  onChange(listener: (snapshot: ProgressionSnapshot) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private persistPath(): string {
    if (!this.resolvedPath) {
      this.usingDefaultPath = this.explicitPath === undefined;
      this.resolvedPath = this.explicitPath ?? defaultProgressionFile();
    }
    return this.resolvedPath;
  }

  private ensureLoaded(): ProgressionData {
    if (!this.data) {
      this.data = this.load() ?? emptyData();
    }
    return this.data;
  }

  /** A completed real turn (Claude sessions only — callers filter out
   *  coworker heartbeats, same rule as shiftStats.recordTurnEnd). Awards XP
   *  and touches today's streak. */
  recordTurnEnd(now: number = Date.now()): void {
    const data = this.ensureLoaded();
    data.xp += XP_TURN_COMPLETED;
    this.touchStreak(data, now);
    this.finish(now);
  }

  /** An OBSERVED crisis resolution (real state transition, never a stale
   *  sweep clear — callers must not call this for TTL/poller-silence
   *  clears). Awards XP only. */
  recordCrisisResolved(now: number = Date.now()): void {
    const data = this.ensureLoaded();
    data.xp += XP_CRISIS_RESOLVED;
    this.finish(now);
  }

  /** A shift-report day closed with a grade (wired via ShiftStats'
   *  onDayClose callback). Awards a one-time bonus scaled by efficiency —
   *  LOWER spend always grades better and earns MORE, never less. Skips
   *  days with zero completed turns (nothing to grade). */
  recordShiftDayClosed(closed: DayCloseSummary, now: number = Date.now()): void {
    if (closed.turnsCompleted <= 0 || closed.efficiency === null) return;
    const data = this.ensureLoaded();
    data.xp += XP_SHIFT_GRADE_BONUS[closed.efficiency];
    if (closed.efficiency === 'LEAN') data.leanDayCount += 1;
    this.finish(now);
  }

  private touchStreak(data: ProgressionData, now: number): void {
    const date = localDate(now);
    const { lastActiveDate } = data.streak;
    if (lastActiveDate === date) return; // already counted today
    if (lastActiveDate === null) {
      data.streak.current = 1;
    } else {
      const gap = daysBetween(lastActiveDate, date);
      data.streak.current = gap === 1 ? data.streak.current + 1 : 1;
    }
    data.streak.longest = Math.max(data.streak.longest, data.streak.current);
    data.streak.lastActiveDate = date;
  }

  /** Recompute permanent unlock flags (never un-set a flag once true), persist + broadcast. */
  private finish(now: number): void {
    const data = this.ensureLoaded();
    if (data.streak.current >= 3) data.unlocks.streakBronze = true;
    if (data.streak.current >= 7) data.unlocks.streakSilver = true;
    if (data.streak.current >= 30) data.unlocks.streakGold = true;
    if (data.leanDayCount >= 5) data.unlocks.leanGrade5 = true;
    const { level } = computeLevel(data.xp);
    if (level >= 5) data.unlocks.level5 = true;
    if (level >= 10) data.unlocks.level10 = true;
    this.persist(now);
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  getSnapshot(): ProgressionSnapshot {
    const data = this.ensureLoaded();
    const { level, xpIntoLevel, xpForNextLevel } = computeLevel(data.xp);
    return {
      xp: data.xp,
      level,
      xpIntoLevel,
      xpForNextLevel,
      streakCurrent: data.streak.current,
      streakLongest: data.streak.longest,
      unlocks: { ...data.unlocks },
    };
  }

  // ── Persistence (tolerant, throttled — same pattern as shiftStats.ts) ──

  private load(): ProgressionData | null {
    try {
      const raw = JSON.parse(
        fs.readFileSync(this.persistPath(), 'utf8'),
      ) as Partial<ProgressionData>;
      if (raw && typeof raw.xp === 'number' && raw.streak) {
        const base = emptyData();
        return {
          xp: raw.xp,
          streak: {
            current: raw.streak.current ?? 0,
            longest: raw.streak.longest ?? 0,
            lastActiveDate: raw.streak.lastActiveDate ?? null,
          },
          leanDayCount: raw.leanDayCount ?? 0,
          unlocks: { ...base.unlocks, ...(raw.unlocks ?? {}) },
        };
      }
    } catch {
      /* missing/corrupt → fresh state */
    }
    return null;
  }

  private persist(now: number, force = false): void {
    const target = this.persistPath();
    // Never let unit tests (which exercise the process-wide singleton
    // indirectly via handleStop / poll-state / day-rollover wiring) write
    // the REAL sidecar. Persistence tests construct their own instance with
    // an explicit temp path, which still writes (same rule as shiftStats.ts).
    if (process.env.VITEST && this.usingDefaultPath) return;
    if (!force && now - this.lastPersistAt < PERSIST_THROTTLE_MS) return;
    this.lastPersistAt = now;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(this.ensureLoaded()), 'utf8');
    } catch {
      /* progression loss on write failure is acceptable — never crash the server */
    }
  }
}

/** Process-wide instance (the server is single-process). */
export const progression = new ProgressionStore();
