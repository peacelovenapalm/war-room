/**
 * Shift report accumulator (v1 mechanic #2) — the end-of-day scorecard.
 *
 * Counts REAL work as it streams through the server, scoped to the local
 * calendar day: completed turns (hook Stop events), token deltas (JSONL
 * usage records), crisis episodes (poll-state blocked transitions — the
 * canonical cross-machine "blocked" signal), and briefing deltas (todos
 * closed / gates advanced vs the day's first snapshot).
 *
 * Efficiency REWARDS LOW SPEND (hard guardrail: tokens are real money):
 * the score is average output tokens per completed turn — lower is better —
 * graded as a WORD (LEAN / STEADY / HEAVY), never a color.
 *
 * State survives restarts via a JSON sidecar next to the app config
 * (~/.pixel-agents/shift-stats.json), throttled writes, tolerant loads.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { Briefing } from './briefingProvider.js';
import { getBriefing } from './briefingProvider.js';

const PERSIST_THROTTLE_MS = 5_000;

/** Resolved lazily (NOT at import time) — test suites mock os.homedir with
 *  values that only exist after their setup runs. */
function defaultStatsFile(): string {
  return path.join(os.homedir(), '.pixel-agents', 'shift-stats.json');
}

/** Briefing counts captured at the day's first look (delta baseline). */
interface BriefingBaseline {
  openTodos: number;
  gatesDone: number;
  capturedAt: number;
}

interface ShiftDay {
  date: string;
  turnsCompleted: number;
  tokensIn: number;
  tokensOut: number;
  crisesIgnited: number;
  crisesResolved: number;
  /** Sum of resolved blocked episode durations (mean = total / resolved). */
  blockedMsTotal: number;
  longestBlockedMs: number;
  baseline?: BriefingBaseline;
}

export interface ShiftReport {
  date: string;
  turnsCompleted: number;
  tokensIn: number;
  tokensOut: number;
  crisesIgnited: number;
  crisesResolved: number;
  crisesOpen: number;
  meanTimeToUnblockMs: number | null;
  longestBlockedMs: number;
  /** Briefing deltas vs the day's first snapshot; null until a baseline exists. */
  todosClosed: number | null;
  gatesAdvanced: number | null;
  /** Average OUTPUT tokens per completed turn — lower is better. */
  outputTokensPerTurn: number | null;
  /** WORD grade for the efficiency score (colorblind rule: word, not color). */
  efficiency: 'LEAN' | 'STEADY' | 'HEAVY' | null;
  generatedAt: string;
}

/** Efficiency bands (avg output tokens per completed turn). Lower = better. */
export const EFFICIENCY_LEAN_MAX = 1_500;
export const EFFICIENCY_STEADY_MAX = 6_000;

function localDate(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function emptyDay(date: string): ShiftDay {
  return {
    date,
    turnsCompleted: 0,
    tokensIn: 0,
    tokensOut: 0,
    crisesIgnited: 0,
    crisesResolved: 0,
    blockedMsTotal: 0,
    longestBlockedMs: 0,
  };
}

function briefingCounts(briefing: Briefing): { openTodos: number; gatesDone: number } {
  const openTodos = briefing.todo ? briefing.todo.sections.reduce((sum, s) => sum + s.count, 0) : 0;
  const gatesDone = briefing.tracker
    ? briefing.tracker.gates.filter((g) => g.status === 'DONE').length
    : 0;
  return { openTodos, gatesDone };
}

export class ShiftStats {
  private day: ShiftDay | null = null;
  /** Open blocked episodes: key → episode start (ms epoch). */
  private openBlocked = new Map<string, number>();
  private lastPersistAt = 0;
  private explicitPath: string | undefined;
  private resolvedPath: string | undefined;
  private usingDefaultPath = false;

  constructor(persistPath?: string) {
    // Everything filesystem-touching is lazy — the process-wide singleton is
    // constructed at import time, before test mocks (os.homedir) exist.
    this.explicitPath = persistPath;
  }

  private persistPath(): string {
    if (!this.resolvedPath) {
      this.usingDefaultPath = this.explicitPath === undefined;
      this.resolvedPath = this.explicitPath ?? defaultStatsFile();
    }
    return this.resolvedPath;
  }

  /** Load-or-init the day ledger, rolling it when the local date changes.
   *  Lazy entry point for every record/report call. */
  private rollDay(now: number): ShiftDay {
    if (!this.day) {
      this.day = this.load() ?? emptyDay(localDate(now));
    }
    const date = localDate(now);
    if (this.day.date !== date) {
      this.day = emptyDay(date);
      // Open episodes carry across midnight — a fire burning at 23:59 is
      // still burning at 00:01; its resolution counts for the new day.
      this.persist(now, true);
    }
    return this.day;
  }

  recordTurnEnd(now: number = Date.now()): void {
    this.rollDay(now).turnsCompleted++;
    this.persist(now);
  }

  recordTokens(inputDelta: number, outputDelta: number, now: number = Date.now()): void {
    if (inputDelta <= 0 && outputDelta <= 0) return;
    const day = this.rollDay(now);
    day.tokensIn += Math.max(0, inputDelta);
    day.tokensOut += Math.max(0, outputDelta);
    this.persist(now);
  }

  /** A blocked episode began (poll state transitioned to blocked). */
  startBlocked(key: string, since: number, now: number = Date.now()): void {
    const day = this.rollDay(now);
    if (this.openBlocked.has(key)) return; // already burning
    this.openBlocked.set(key, since);
    day.crisesIgnited++;
    this.persist(now);
  }

  /** A blocked episode ended (state changed, cleared, or session closed). */
  endBlocked(key: string, now: number = Date.now()): void {
    const since = this.openBlocked.get(key);
    if (since === undefined) return;
    this.openBlocked.delete(key);
    const day = this.rollDay(now);
    const duration = Math.max(0, now - since);
    day.crisesResolved++;
    day.blockedMsTotal += duration;
    if (duration > day.longestBlockedMs) day.longestBlockedMs = duration;
    this.persist(now);
  }

  /** Build the scorecard. Captures the day's briefing baseline on first call. */
  getReport(now: number = Date.now()): ShiftReport {
    const day = this.rollDay(now);
    const briefing = getBriefing(now);
    const counts = briefingCounts(briefing);
    if (!day.baseline) {
      day.baseline = { ...counts, capturedAt: now };
      this.persist(now, true);
    }
    const hasBriefingSources = briefing.todo !== null || briefing.tracker !== null;
    const turns = day.turnsCompleted;
    const perTurn = turns > 0 ? Math.round(day.tokensOut / turns) : null;
    return {
      date: day.date,
      turnsCompleted: turns,
      tokensIn: day.tokensIn,
      tokensOut: day.tokensOut,
      crisesIgnited: day.crisesIgnited,
      crisesResolved: day.crisesResolved,
      crisesOpen: this.openBlocked.size,
      meanTimeToUnblockMs:
        day.crisesResolved > 0 ? Math.round(day.blockedMsTotal / day.crisesResolved) : null,
      longestBlockedMs: day.longestBlockedMs,
      todosClosed: hasBriefingSources
        ? Math.max(0, day.baseline.openTodos - counts.openTodos)
        : null,
      gatesAdvanced: hasBriefingSources
        ? Math.max(0, counts.gatesDone - day.baseline.gatesDone)
        : null,
      outputTokensPerTurn: perTurn,
      efficiency:
        perTurn === null
          ? null
          : perTurn <= EFFICIENCY_LEAN_MAX
            ? 'LEAN'
            : perTurn <= EFFICIENCY_STEADY_MAX
              ? 'STEADY'
              : 'HEAVY',
      generatedAt: new Date(now).toISOString(),
    };
  }

  // ── Persistence (tolerant, throttled) ─────────────────────────

  private load(): ShiftDay | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.persistPath(), 'utf8')) as ShiftDay;
      if (raw && typeof raw.date === 'string' && typeof raw.turnsCompleted === 'number') {
        return raw;
      }
    } catch {
      /* missing/corrupt → fresh day */
    }
    return null;
  }

  private persist(now: number, force = false): void {
    // Unit tests exercise the process-wide singleton indirectly (handleStop,
    // token parsing) — never let them write the REAL sidecar. Persistence
    // tests construct their own instance with a temp path, which still writes.
    const target = this.persistPath();
    if (process.env.VITEST && this.usingDefaultPath) return;
    if (!force && now - this.lastPersistAt < PERSIST_THROTTLE_MS) return;
    this.lastPersistAt = now;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(this.day), 'utf8');
    } catch {
      /* stats loss on write failure is acceptable — never crash the server */
    }
  }
}

/** Process-wide instance (the server is single-process). */
export const shiftStats = new ShiftStats();
