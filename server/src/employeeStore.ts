/**
 * Employee store (v2 mechanic G1) — every distinct real work identity
 * (machine, project) becomes a persistent colony-sim Employee. Traits are
 * derived from real behavior, never player-assigned. Mood-only (needs are
 * CUT per GAME-DESIGN.md §4 rev 2 / interrogation delta #2).
 *
 * Persisted like progressionStore.ts (lazy homedir, 5s throttled persist,
 * tolerant load, onChange listener list, VITEST guard) at
 * ~/.pixel-agents/employees.json. Unbounded per-employee ledger lives
 * outside the hot file at ~/.pixel-agents/employee-history/<id>.jsonl,
 * tail-kept at 5000→2500 lines.
 *
 * HARD GUARDRAIL (no dark patterns): XP/mood-positive events come ONLY from
 * real, observed sources — a completed turn (hook Stop), an OBSERVED crisis
 * resolution, or (G3+) a dispatch exit. Nothing here ever reads token
 * VOLUME as a reward signal — `tokenEfficiency` scores LOWER output-token
 * spend HIGHER, same polarity as shiftStats' efficiency grade.
 *
 * Identity (GAME-DESIGN §4.1/§9.5): one employee per (machine, project).
 * Firing blacklists the routing key for that base identity — the NEXT real
 * telemetry for the same base allocates a fresh `${base}#${n}` record. A
 * natural quit does NOT blacklist — the same id auto-rehires (status flips
 * back to 'active') the moment new telemetry arrives for it.
 *
 * G2 dependencies (economy Cash/Reputation, vacation-mode flag) are wired
 * via an optional injected-deps object (`EmployeeStoreDeps`), each with a
 * permissive no-op default (never on vacation / silent no-op / debit
 * always succeeds) for test-constructed instances — only the process-wide
 * singleton export below wires the real economyStore. train()/promote()
 * debit Cash this way (GAME-DESIGN §3.1, F1: 100/session and
 * `200 * nextTierIndex`); other verbs' non-economic gates
 * (level/mood/status thresholds) are unaffected.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { hashString, mulberry32 } from '../../core/src/deterministicRandom.js';
import { employeeId } from '../../core/src/employeeId.js';
import { computeLevel, xpForLevel } from '../../core/src/leveling.js';
import { buffsForDesk, globalBuffs } from './buildingBuffs.js';
import { LAYOUT_FILE_DIR } from './constants.js';
import type { EconomyCause } from './economyStore.js';
import { economyStore } from './economyStore.js';
import { EMPLOYEE_NAMES } from './employeeNames.js';
import { getOfficeLayout } from './officeLayoutStore.js';
import { EFFICIENCY_LEAN_MAX, EFFICIENCY_STEADY_MAX } from './shiftStats.js';

const PERSIST_THROTTLE_MS = 5_000;
const EMPLOYEES_FILE_NAME = 'employees.json';
const LEDGER_DIR_NAME = 'employee-history';
const LEDGER_MAX_LINES = 5000;
const LEDGER_TRIM_TO_LINES = 2500;

function defaultEmployeesFile(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, EMPLOYEES_FILE_NAME);
}

function defaultLedgerDir(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, LEDGER_DIR_NAME);
}

// ── Leveling ────────────────────────────────────────────────────────────
/** Flatter than the account-wide {base:100,step:50} curve — many employees
 *  leveling in parallel should each feel faster (GAME-DESIGN §4.4). */
export const EMPLOYEE_LEVEL_CURVE = { base: 60, step: 30 };

export const XP_TURN = 4;
export const XP_CRISIS_RESOLVED = 12;
export const XP_DISPATCH_EXIT_0 = 8;
export const XP_DISPATCH_EXIT_NONZERO = 2;

export type EmployeeStatus =
  | 'candidate'
  | 'active'
  | 'on_break'
  | 'training'
  | 'quit'
  | 'fired'
  | 'retired';
export type EmployeeRank = 'Junior' | 'Senior' | 'Lead' | 'Principal';
export type ScoreTrack = 'speed' | 'accuracy' | 'nightOwl' | 'tokenEfficiency';

interface RankTier {
  rank: EmployeeRank;
  minLevel: number;
  trainingCap: number;
}
export const RANK_TIERS: readonly RankTier[] = [
  { rank: 'Junior', minLevel: 1, trainingCap: 12 },
  { rank: 'Senior', minLevel: 5, trainingCap: 20 },
  { rank: 'Lead', minLevel: 10, trainingCap: 28 },
  { rank: 'Principal', minLevel: 18, trainingCap: 36 },
];

// ── Verb costs (GAME-DESIGN §3.1/§4.6) ────────────────────────────────
export const TRAIN_COST_CASH = 100;
/** Promote costs `200 * nextTierIndex`, where nextTierIndex is the 0-based
 *  RANK_TIERS index of the tier being promoted INTO (= currentIndex + 1,
 *  same "next" already resolved via `RANK_TIERS[currentIndex + 1]`):
 *  Junior(0)->Senior(1) = 200, Senior(1)->Lead(2) = 400,
 *  Lead(2)->Principal(3) = 600. */
export const PROMOTE_COST_PER_TIER = 200;

// ── Traits ──────────────────────────────────────────────────────────────
export const MIN_SAMPLES = 5;
/** 3-min reference turn (employee-local, distinct from any account-wide constant). */
export const SPEED_MS_REFERENCE = 180_000;
/** Safety clamp on the wallMs proxy (time since this employee's previous
 *  recorded turn) — an overnight gap between turns must not read as an
 *  infinitely slow turn. */
const WALL_MS_PROXY_MIN = 1_000;
const WALL_MS_PROXY_MAX = 6 * 60 * 60 * 1000;
/** "Night" window for the nightOwl trait — 22:00–05:59 local. */
function isNightHour(hour: number): boolean {
  return hour >= 22 || hour < 6;
}

export interface EmployeeScores {
  speed: number;
  accuracy: number;
  nightOwl: number;
  tokenEfficiency: number;
}

const NEUTRAL_SCORES: EmployeeScores = {
  speed: 50,
  accuracy: 50,
  nightOwl: 0,
  tokenEfficiency: 50,
};

function clamp(min: number, max: number, value: number): number {
  return Math.min(max, Math.max(min, value));
}

interface RollingTurn {
  ts: number;
  wallMs: number;
  outputTokens: number;
  wasError: boolean;
  hour: number;
}
const ROLLING_TURNS_CAP = 50;

/** Pure — testable independent of the store. */
export function computeScores(
  recentTurns: readonly RollingTurn[],
  trainingBonus: Record<ScoreTrack, number>,
): EmployeeScores {
  if (recentTurns.length < MIN_SAMPLES) return { ...NEUTRAL_SCORES };
  const n = recentTurns.length;
  const avgWallMs = recentTurns.reduce((s, t) => s + t.wallMs, 0) / n;
  const errorRate = recentTurns.filter((t) => t.wasError).length / n;
  const nightFrac = recentTurns.filter((t) => isNightHour(t.hour)).length / n;
  const avgOutTok = recentTurns.reduce((s, t) => s + t.outputTokens, 0) / n;

  const speedBase = clamp(0, 100, 100 - (avgWallMs / SPEED_MS_REFERENCE) * 100);
  const accuracyBase = clamp(0, 100, 100 - errorRate * 200);
  const nightOwlBase = clamp(0, 100, nightFrac * 100);
  const effFrac =
    avgOutTok <= EFFICIENCY_LEAN_MAX
      ? 1
      : avgOutTok >= EFFICIENCY_STEADY_MAX
        ? 0
        : 1 - (avgOutTok - EFFICIENCY_LEAN_MAX) / (EFFICIENCY_STEADY_MAX - EFFICIENCY_LEAN_MAX);
  const tokenEfficiencyBase = clamp(0, 100, effFrac * 100);

  return {
    speed: speedBase + trainingBonus.speed,
    accuracy: accuracyBase + trainingBonus.accuracy,
    nightOwl: nightOwlBase + trainingBonus.nightOwl,
    tokenEfficiency: tokenEfficiencyBase + trainingBonus.tokenEfficiency,
  };
}

/** Pure — testable independent of the store. ROOKIE suppresses all others. */
export function computeBadges(scores: EmployeeScores, sampleCount: number): string[] {
  if (sampleCount < MIN_SAMPLES) return ['ROOKIE'];
  const badges: string[] = [];
  if (scores.speed >= 70) badges.push('FAST');
  if (scores.accuracy < 50) badges.push('SLOPPY');
  if (scores.accuracy >= 85) badges.push('METICULOUS');
  if (scores.nightOwl >= 40) badges.push('NIGHT_OWL');
  if (scores.tokenEfficiency >= 70) badges.push('EFFICIENT');
  if (scores.tokenEfficiency < 30) badges.push('BURNS_TOKENS');
  return badges;
}

// ── Mood / quit (§4.5) ─────────────────────────────────────────────────
export const MOOD_DECAY_PER_HOUR_IDLE = 0.3;
export const MOOD_BREAK_RESTORE = 30;
/** Not specified numerically by GAME-DESIGN — a documented judgment call:
 *  long enough to be a deliberate cooldown, short enough to matter in a
 *  single session. */
export const BREAK_DURATION_MS = 30 * 60_000;
export const QUIT_THRESHOLD_MOOD = 20;
export const QUIT_GRACE_DAYS = 5;
const MOOD_BOOST_CLAMP = 20;

function localDate(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Public record shape (GAME-DESIGN §4.2) ─────────────────────────────
export interface Employee {
  id: string;
  machine: string;
  projectDir: string;
  projectLabel: string;
  name: string;
  spriteIndex: number;
  defaultProvider: 'claude' | 'codex';
  defaultModel?: string;
  status: EmployeeStatus;
  rank: EmployeeRank;
  xp: number;
  mood: number;
  moodBoost: number;
  scores: EmployeeScores;
  trainingBonus: Record<ScoreTrack, number>;
  rolling: { recentTurns: RollingTurn[] };
  assignedRoomId?: string;
  createdAt: number;
  lastActiveAt: number;
  lowMoodStreakDays: number;
  breakUntil?: number;
  // ── Internal bookkeeping (not part of the GAME-DESIGN interface, but
  //    persisted here rather than a parallel map — same file, same load). ──
  turnsRecorded: number;
  lastDecayAppliedAt: number;
  lastMoodCheckDate: string | null;
  lastOutputTokensSeen: number;
  previousTurnAt: number | null;
  lastTrainedDate: string | null;
}

export type EmployeeVerbResult = { ok: true; employee: Employee } | { ok: false; reason: string };

interface PersistedData {
  employees: Record<string, Employee>;
  activeKeyForBase: Record<string, string>;
  nextSuffix: Record<string, number>;
  blacklist: string[];
}

function emptyData(): PersistedData {
  return { employees: {}, activeKeyForBase: {}, nextSuffix: {}, blacklist: [] };
}

export interface LedgerEntry {
  ts: number;
  event: string;
  [key: string]: unknown;
}

export interface EmployeeStoreDeps {
  /** G2's economyStore vacation flag — no-op (never on vacation) until wired. */
  isVacationActive?: () => boolean;
  /** G2's economyStore Reputation award — no-op until wired. */
  awardReputation?: (delta: number, cause: EconomyCause) => void;
  /** G2's economyStore Cash debit (GAME-DESIGN §3.1, F1) — mirrors
   *  economyStore.spend()'s contract exactly: returns false WITHOUT
   *  mutating anything (economy or employee state) when funds are
   *  insufficient, true (and the debit already applied) on success. Must
   *  be called, and must return, before any employee-state mutation.
   *  Permissive no-op default (always succeeds) for test-constructed
   *  instances that don't care about Cash, same posture as
   *  awardReputation's silent no-op default — only the process-wide
   *  singleton below wires the real economyStore.spend. */
  spendCash?: (amount: number, cause: EconomyCause, now: number) => boolean;
}

export class EmployeeStore {
  private data: PersistedData | null = null;
  private lastPersistAt = 0;
  private explicitPath: string | undefined;
  private resolvedPath: string | undefined;
  private usingDefaultPath = false;
  private explicitLedgerDir: string | undefined;
  private resolvedLedgerDir: string | undefined;
  private listeners: Array<(snapshot: Employee) => void> = [];
  private readonly isVacationActive: () => boolean;
  private readonly awardReputation: (delta: number, cause: EconomyCause) => void;
  private readonly spendCash: (amount: number, cause: EconomyCause, now: number) => boolean;

  constructor(persistPath?: string, ledgerDir?: string, deps: EmployeeStoreDeps = {}) {
    this.explicitPath = persistPath;
    this.explicitLedgerDir = ledgerDir;
    this.isVacationActive = deps.isVacationActive ?? (() => false);
    this.awardReputation = deps.awardReputation ?? (() => {});
    this.spendCash = deps.spendCash ?? (() => true);
  }

  /** Subscribe to per-employee mutations (fired after every recorded event
   *  or verb). Returns an unsubscribe function. */
  onChange(listener: (snapshot: Employee) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  // ── Real-event entry points ─────────────────────────────────────────

  /** A completed real turn (hook Stop, G1) or a dispatch exit (G3, via the
   *  `wasError`/`xpOverride`/`wallMsOverride` params). `outputTokensCumulative`
   *  is the caller's running total (AgentState.outputTokens) — the store
   *  tracks its own last-seen value per employee to derive the per-turn delta,
   *  the same "track our own baseline, don't subscribe to internals" pattern
   *  economyStore will use for streaks (GAME-DESIGN §3.1). */
  recordTurn(
    machine: string | undefined,
    projectDir: string,
    projectLabel: string,
    input: {
      outputTokensCumulative: number;
      wasError?: boolean;
      xpOverride?: number;
      wallMsOverride?: number;
    },
    now: number = Date.now(),
  ): Employee {
    const emp = this.touch(machine, projectDir, projectLabel, now);

    const outDelta =
      input.outputTokensCumulative >= emp.lastOutputTokensSeen
        ? input.outputTokensCumulative - emp.lastOutputTokensSeen
        : 0;
    emp.lastOutputTokensSeen = input.outputTokensCumulative;

    const wallMs =
      input.wallMsOverride ??
      (emp.previousTurnAt === null
        ? SPEED_MS_REFERENCE
        : clamp(WALL_MS_PROXY_MIN, WALL_MS_PROXY_MAX, now - emp.previousTurnAt));
    emp.previousTurnAt = now;

    emp.rolling.recentTurns.push({
      ts: now,
      wallMs,
      outputTokens: Math.max(0, outDelta),
      wasError: input.wasError ?? false,
      hour: new Date(now).getHours(),
    });
    if (emp.rolling.recentTurns.length > ROLLING_TURNS_CAP) {
      emp.rolling.recentTurns.splice(0, emp.rolling.recentTurns.length - ROLLING_TURNS_CAP);
    }
    emp.scores = computeScores(emp.rolling.recentTurns, emp.trainingBonus);

    emp.turnsRecorded += 1;
    if (emp.status === 'candidate' && emp.turnsRecorded >= 3) emp.status = 'active';

    emp.xp += input.xpOverride ?? XP_TURN;
    emp.lastActiveAt = now;

    this.finish(emp, now, 'turn', {
      wallMs,
      outputTokens: outDelta,
      wasError: input.wasError ?? false,
    });
    return { ...emp };
  }

  /** An OBSERVED crisis resolution (real state transition, never a stale
   *  sweep clear — callers must not call this for TTL/poller-silence
   *  clears; mirrors progressionStore's CrisisXpSink contract). XP +
   *  moodBoost only, no rolling-turn entry. `crisisXpBonusPct` is the War
   *  Room buff (G2, GAME-DESIGN §5.4) — computed by the caller (mirrors
   *  hookEventHandler.ts's xpOverride pattern: pollStateHandler.ts looks up
   *  the resolving employee's assignedRoomId via getById BEFORE calling
   *  this, since only it has the point-in-time office layout in scope) and
   *  rounded the same way xpOverride is. Not subject to the desk 40% cap
   *  pool (single source, nothing else stacks against it). */
  recordCrisisResolved(
    machine: string | undefined,
    projectDir: string,
    now: number = Date.now(),
    crisisXpBonusPct = 0,
  ): void {
    // No projectLabel available at this call site (pollStateHandler only
    // has machine/projectDir) — reuse the existing record if present,
    // otherwise fall back to the raw dir as label (same as a fresh hire).
    const emp = this.touch(machine, projectDir, path.basename(projectDir), now);
    emp.xp += Math.round(XP_CRISIS_RESOLVED * (1 + crisisXpBonusPct / 100));
    emp.moodBoost = clamp(-MOOD_BOOST_CLAMP, MOOD_BOOST_CLAMP, emp.moodBoost + 5);
    emp.lastActiveAt = now;
    this.finish(emp, now, 'crisis-resolved', {});
  }

  /** A dispatch run tagged with this employee's id exited (v2 mechanic G3 —
   *  the one integration point Employees consumes for dispatch-driven XP
   *  growth, GAME-DESIGN §7.3). Exit 0 pays XP_DISPATCH_EXIT_0; any other
   *  exit pays the smaller XP_DISPATCH_EXIT_NONZERO — real observed event
   *  either way (never token volume). No-op on an unknown id (a chain step
   *  can reference an employee that was fired/deleted after the chain was
   *  authored — an honest no-op, not a crash). */
  recordDispatchExit(id: string, exitCode: number, now: number = Date.now()): void {
    const emp = this.getExisting(id, now);
    if (!emp) return;
    emp.xp += exitCode === 0 ? XP_DISPATCH_EXIT_0 : XP_DISPATCH_EXIT_NONZERO;
    emp.lastActiveAt = now;
    this.finish(emp, now, 'dispatch-exit', { exitCode });
  }

  /** GAME-DESIGN §7.3 — reads exactly the 4 REAL record fields (an earlier
   *  draft named homeMachine/defaultCwd, which don't exist on this record).
   *  Consumed at three call sites (CallModal prefill, ChainStepDef,
   *  StandingOrder) — explicit fields at those call sites always win over
   *  these defaults, this is a prefill convenience only. */
  resolveEmployeeDefaults(id: string):
    | {
        machine: string;
        projectDir: string;
        defaultProvider: 'claude' | 'codex';
        defaultModel?: string;
      }
    | undefined {
    const emp = this.getExisting(id, Date.now());
    if (!emp) return undefined;
    return {
      machine: emp.machine,
      projectDir: emp.projectDir,
      defaultProvider: emp.defaultProvider,
      defaultModel: emp.defaultModel,
    };
  }

  /** World events (v2 mechanic G4, §6.3) — rival_poach/birthday nudge an
   *  employee's transient moodBoost. No-op on an unknown id (an event may
   *  target an employee who was fired/deleted between the pick and the
   *  nudge — an honest no-op, same posture as recordDispatchExit). */
  nudgeMoodBoost(id: string, delta: number, now: number = Date.now()): void {
    const emp = this.getExisting(id, now);
    if (!emp) return;
    emp.moodBoost = clamp(-MOOD_BOOST_CLAMP, MOOD_BOOST_CLAMP, emp.moodBoost + delta);
    this.finish(emp, now, 'mood-nudge', { delta });
  }

  // ── Verbs (GAME-DESIGN §4.6) ────────────────────────────────────────

  train(id: string, track: ScoreTrack, now: number = Date.now()): EmployeeVerbResult {
    const emp = this.getExisting(id, now);
    if (!emp) return { ok: false, reason: 'not-found' };
    if (emp.status !== 'active') return { ok: false, reason: 'not-active' };
    const tier = RANK_TIERS.find((t) => t.rank === emp.rank)!;
    if (emp.trainingBonus[track] >= tier.trainingCap) return { ok: false, reason: 'track-at-cap' };
    const today = localDate(now);
    if (emp.lastTrainedDate === today) return { ok: false, reason: 'cooldown' };
    // GAME-DESIGN §3.1: 100 Cash/session. Checked last, right before the
    // first mutation — every gate above is a free read-only refusal, so
    // insufficient Cash never burns the once/day cooldown or grants any
    // partial XP/mood/track effect (no dark patterns).
    if (
      !this.spendCash(
        TRAIN_COST_CASH,
        { label: `train-${track}`, sourceEventRefs: [`player-action:train:${id}:${track}`] },
        now,
      )
    ) {
      return { ok: false, reason: 'insufficient-cash' };
    }
    emp.trainingBonus[track] = Math.min(tier.trainingCap, emp.trainingBonus[track] + 2);
    emp.scores = computeScores(emp.rolling.recentTurns, emp.trainingBonus);
    emp.moodBoost = clamp(-MOOD_BOOST_CLAMP, MOOD_BOOST_CLAMP, emp.moodBoost + 3);
    emp.lastTrainedDate = today;
    this.finish(emp, now, 'train', { track });
    return { ok: true, employee: { ...emp } };
  }

  promote(id: string, now: number = Date.now()): EmployeeVerbResult {
    const emp = this.getExisting(id, now);
    if (!emp) return { ok: false, reason: 'not-found' };
    if (emp.status !== 'active') return { ok: false, reason: 'not-active' };
    const currentIndex = RANK_TIERS.findIndex((t) => t.rank === emp.rank);
    const next = RANK_TIERS[currentIndex + 1];
    if (!next) return { ok: false, reason: 'max-rank' };
    const { level } = computeLevel(emp.xp, EMPLOYEE_LEVEL_CURVE);
    if (level < next.minLevel) return { ok: false, reason: 'level-too-low' };
    if (emp.mood < 50) return { ok: false, reason: 'mood-too-low' };
    // GAME-DESIGN §3.1: `200 * nextTierIndex` — nextTierIndex is `next`'s
    // own 0-based RANK_TIERS index (currentIndex + 1). Checked last, right
    // before the first mutation — insufficient Cash never grants the rank
    // or the +15 moodBoost (no dark patterns).
    const nextTierIndex = currentIndex + 1;
    const cost = PROMOTE_COST_PER_TIER * nextTierIndex;
    if (
      !this.spendCash(
        cost,
        { label: `promote-${next.rank}`, sourceEventRefs: [`player-action:promote:${id}`] },
        now,
      )
    ) {
      return { ok: false, reason: 'insufficient-cash' };
    }
    emp.rank = next.rank;
    emp.moodBoost = clamp(-MOOD_BOOST_CLAMP, MOOD_BOOST_CLAMP, emp.moodBoost + 15);
    this.finish(emp, now, 'promote', { rank: next.rank });
    return { ok: true, employee: { ...emp } };
  }

  break_(id: string, now: number = Date.now()): EmployeeVerbResult {
    const emp = this.getExisting(id, now);
    if (!emp) return { ok: false, reason: 'not-found' };
    if (emp.status !== 'active') return { ok: false, reason: 'not-active' };
    emp.status = 'on_break';
    // Break Room moodRegenMult (G2, GAME-DESIGN §5.4): x1.5 when this
    // employee's desk is inside a Break Room, x1 otherwise — a
    // point-in-time layout read, same access pattern as
    // hookEventHandler.ts's Dev Pit XP-bonus lookup. A missing layout or
    // an unassigned desk degrades to the neutral x1 (buffsForDesk's
    // existing "unknown desk returns all-zero/neutral" contract).
    let moodRegenMult = 1;
    if (emp.assignedRoomId) {
      const layout = getOfficeLayout();
      if (layout) {
        moodRegenMult = buffsForDesk(layout, emp.assignedRoomId).moodRegenMult;
      }
    }
    emp.mood = clamp(0, 100, emp.mood + MOOD_BREAK_RESTORE * moodRegenMult);
    emp.breakUntil = now + BREAK_DURATION_MS;
    this.finish(emp, now, 'break', {});
    return { ok: true, employee: { ...emp } };
  }

  fire(id: string, now: number = Date.now()): EmployeeVerbResult {
    const emp = this.getExisting(id, now);
    if (!emp) return { ok: false, reason: 'not-found' };
    if (emp.status === 'fired' || emp.status === 'retired')
      return { ok: false, reason: 'terminal' };
    emp.status = 'fired';
    const data = this.ensureLoaded();
    if (!data.blacklist.includes(id)) data.blacklist.push(id);
    this.awardReputation(-10, {
      label: `fired:${id}`,
      sourceEventRefs: [`player-action:fire-employee:${id}`],
    });
    this.finish(emp, now, 'fired', {});
    return { ok: true, employee: { ...emp } };
  }

  retire(id: string, now: number = Date.now()): EmployeeVerbResult {
    const emp = this.getExisting(id, now);
    if (!emp) return { ok: false, reason: 'not-found' };
    if (emp.status === 'fired' || emp.status === 'retired')
      return { ok: false, reason: 'terminal' };
    const { level } = computeLevel(emp.xp, EMPLOYEE_LEVEL_CURVE);
    if (level < 10) return { ok: false, reason: 'level-too-low' };
    emp.status = 'retired';
    this.awardReputation(10, {
      label: `retired:${id}`,
      sourceEventRefs: [`player-action:retire-employee:${id}`],
    });
    this.finish(emp, now, 'retired', { rank: emp.rank, level });
    return { ok: true, employee: { ...emp } };
  }

  rehire(id: string, now: number = Date.now()): EmployeeVerbResult {
    const emp = this.getExisting(id, now);
    if (!emp) return { ok: false, reason: 'not-found' };
    if (emp.status !== 'fired' && emp.status !== 'quit')
      return { ok: false, reason: 'not-terminal' };
    const data = this.ensureLoaded();
    const idx = data.blacklist.indexOf(id);
    if (idx !== -1) data.blacklist.splice(idx, 1);
    emp.status = 'active';
    this.finish(emp, now, 'rehired', {});
    return { ok: true, employee: { ...emp } };
  }

  assign(id: string, roomId: string | undefined, now: number = Date.now()): EmployeeVerbResult {
    const emp = this.getExisting(id, now);
    if (!emp) return { ok: false, reason: 'not-found' };
    if (emp.status !== 'active') return { ok: false, reason: 'not-active' };
    emp.assignedRoomId = roomId;
    this.finish(emp, now, 'assigned', { roomId });
    return { ok: true, employee: { ...emp } };
  }

  onboard(id: string, now: number = Date.now()): EmployeeVerbResult {
    const emp = this.getExisting(id, now);
    if (!emp) return { ok: false, reason: 'not-found' };
    if (emp.status !== 'candidate') return { ok: false, reason: 'not-candidate' };
    emp.status = 'active';
    this.finish(emp, now, 'onboarded', {});
    return { ok: true, employee: { ...emp } };
  }

  // ── Reads ────────────────────────────────────────────────────────────

  getAll(now: number = Date.now()): Employee[] {
    const data = this.ensureLoaded();
    return Object.values(data.employees).map((emp) => {
      this.applyUpkeep(emp, now);
      return { ...emp };
    });
  }

  getById(id: string, now: number = Date.now()): Employee | undefined {
    const emp = this.getExisting(id, now);
    return emp ? { ...emp } : undefined;
  }

  history(id: string, limit = 50): LedgerEntry[] {
    try {
      const raw = fs.readFileSync(this.ledgerPath(id), 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      return lines
        .slice(-limit)
        .map((line) => {
          try {
            return JSON.parse(line) as LedgerEntry;
          } catch {
            return null;
          }
        })
        .filter((e): e is LedgerEntry => e !== null);
    } catch {
      return [];
    }
  }

  // ── Internal: identity routing + upkeep ────────────────────────────

  private getExisting(id: string, now: number): Employee | undefined {
    const data = this.ensureLoaded();
    const emp = data.employees[id];
    if (!emp) return undefined;
    this.applyUpkeep(emp, now);
    return emp;
  }

  /** Resolve (machine, projectDir) telemetry to the employee record it
   *  should update, creating one if this is the first time this base
   *  identity has been observed (or reviving a blacklisted base under a
   *  fresh `#n` id). Applies lazy upkeep before returning. */
  private touch(
    machine: string | undefined,
    projectDir: string,
    projectLabel: string,
    now: number,
  ): Employee {
    const data = this.ensureLoaded();
    const base = employeeId(machine, projectDir);
    let routeId = data.activeKeyForBase[base] ?? base;
    if (data.blacklist.includes(routeId)) {
      const n = data.nextSuffix[base] ?? 1;
      data.nextSuffix[base] = n + 1;
      routeId = `${base}#${n}`;
      data.activeKeyForBase[base] = routeId;
    } else if (!(base in data.activeKeyForBase)) {
      data.activeKeyForBase[base] = routeId;
    }

    let emp = data.employees[routeId];
    if (!emp) {
      emp = this.createEmployee(routeId, machine ?? 'LOCAL', projectDir, projectLabel, now);
      data.employees[routeId] = emp;
    } else {
      this.applyUpkeep(emp, now);
      // Auto-rehire: a natural quit never blacklists, so the SAME id
      // returning real telemetry flips straight back to active.
      if (emp.status === 'quit') emp.status = 'active';
    }
    return emp;
  }

  private createEmployee(
    id: string,
    machine: string,
    projectDir: string,
    projectLabel: string,
    now: number,
  ): Employee {
    const h = hashString(id);
    return {
      id,
      machine,
      projectDir,
      projectLabel,
      name: EMPLOYEE_NAMES[h % EMPLOYEE_NAMES.length],
      spriteIndex: h,
      defaultProvider: 'claude',
      status: 'candidate',
      rank: 'Junior',
      xp: 0,
      mood: 70,
      moodBoost: 0,
      scores: { ...NEUTRAL_SCORES },
      trainingBonus: { speed: 0, accuracy: 0, nightOwl: 0, tokenEfficiency: 0 },
      rolling: { recentTurns: [] },
      createdAt: now,
      lastActiveAt: now,
      lowMoodStreakDays: 0,
      turnsRecorded: 0,
      lastDecayAppliedAt: now,
      lastMoodCheckDate: null,
      lastOutputTokensSeen: 0,
      previousTurnAt: null,
      lastTrainedDate: null,
    };
  }

  /** Idle mood decay (continuous, hour-granular) + once-per-local-day
   *  moodBoost halving / quit-streak-and-roll bookkeeping. Suspended
   *  entirely while vacation mode is on (G2's economyStore flag, injected). */
  private applyUpkeep(emp: Employee, now: number): void {
    if (this.isVacationActive()) {
      emp.lastDecayAppliedAt = now;
      return;
    }
    // Working never drains mood (GAME-DESIGN §4.5) — only decay the gap
    // since the last upkeep tick, and only for statuses that are actually
    // idle (on_break restores instead; terminal statuses don't decay).
    if (emp.status === 'active' || emp.status === 'candidate') {
      const elapsedHours = (now - emp.lastDecayAppliedAt) / 3_600_000;
      if (elapsedHours > 0) {
        // Kitchen moodDecayMult (G2, GAME-DESIGN §5.4): a GLOBAL buff (x0.85
        // company-wide) while a Kitchen exists anywhere in the layout — no
        // assignedRoomId/desk lookup, just layout presence. Same
        // point-in-time read pattern as the desk buffs above; a missing
        // layout degrades to the neutral x1 (globalBuffs' own contract).
        const layout = getOfficeLayout();
        const moodDecayMult = layout ? globalBuffs(layout).moodDecayMult : 1;
        emp.mood = clamp(
          0,
          100,
          emp.mood - elapsedHours * MOOD_DECAY_PER_HOUR_IDLE * moodDecayMult,
        );
      }
    }
    emp.lastDecayAppliedAt = now;

    if (emp.status === 'on_break' && emp.breakUntil !== undefined && now >= emp.breakUntil) {
      emp.status = 'active';
      emp.breakUntil = undefined;
    }

    const today = localDate(now);
    if (emp.lastMoodCheckDate === today) return;
    const isFirstCheck = emp.lastMoodCheckDate === null;
    emp.lastMoodCheckDate = today;
    if (isFirstCheck) return; // don't roll a quit-streak day-1 on creation

    emp.moodBoost = emp.moodBoost / 2;

    if (emp.mood < QUIT_THRESHOLD_MOOD) emp.lowMoodStreakDays += 1;
    else emp.lowMoodStreakDays = 0;

    if (emp.status === 'active' && emp.lowMoodStreakDays >= QUIT_GRACE_DAYS) {
      const roll = mulberry32(hashString(`${emp.id}|${today}`))();
      const chance = clamp(0, 0.6, ((QUIT_THRESHOLD_MOOD - emp.mood) / QUIT_THRESHOLD_MOOD) * 0.6);
      if (roll < chance) {
        const { level } = computeLevel(emp.xp, EMPLOYEE_LEVEL_CURVE);
        emp.xp = xpForLevel(Math.max(1, Math.floor(level / 2)), EMPLOYEE_LEVEL_CURVE);
        emp.status = 'quit';
        // KICKOFF v1.1 item 6: quits are a real state-consistency mutation
        // like every other verb here (recordTurn/train/fire/...) — must go
        // through finish() (persist + ledger + broadcast), not just append
        // to the ledger. A quit that never persists/broadcasts is silently
        // invisible to the office view and to a fresh page load.
        this.finish(emp, now, 'quit', { level, mood: emp.mood });
      }
    }
  }

  private finish(emp: Employee, now: number, event: string, extra: Record<string, unknown>): void {
    this.persist(now);
    this.appendLedger(emp.id, { ts: now, event, ...extra });
    for (const listener of this.listeners) listener({ ...emp });
  }

  // ── Persistence (tolerant, throttled — same pattern as progressionStore.ts) ──

  private persistPath(): string {
    if (!this.resolvedPath) {
      this.usingDefaultPath = this.explicitPath === undefined;
      this.resolvedPath = this.explicitPath ?? defaultEmployeesFile();
    }
    return this.resolvedPath;
  }

  private ledgerDir(): string {
    if (!this.resolvedLedgerDir) {
      this.resolvedLedgerDir = this.explicitLedgerDir ?? defaultLedgerDir();
    }
    return this.resolvedLedgerDir;
  }

  private ledgerPath(id: string): string {
    // id may contain ':' (machine:project) and '#' (fired-rehire suffix) —
    // both filesystem-unsafe on some platforms, so sanitize for the filename
    // only (the id itself, as returned to callers, is untouched).
    const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.ledgerDir(), `${safe}.jsonl`);
  }

  private ensureLoaded(): PersistedData {
    if (!this.data) {
      this.data = this.load() ?? emptyData();
    }
    return this.data;
  }

  private load(): PersistedData | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.persistPath(), 'utf8')) as Partial<PersistedData>;
      if (raw && typeof raw.employees === 'object') {
        return {
          employees: raw.employees ?? {},
          activeKeyForBase: raw.activeKeyForBase ?? {},
          nextSuffix: raw.nextSuffix ?? {},
          blacklist: raw.blacklist ?? [],
        };
      }
    } catch {
      /* missing/corrupt → fresh state */
    }
    return null;
  }

  private persist(now: number, force = false): void {
    // Never let unit tests (which exercise the process-wide singleton
    // indirectly) write the REAL sidecar. Persistence tests construct their
    // own instance with an explicit temp path, which still writes.
    if (process.env.VITEST && this.usingDefaultPath) return;
    if (!force && now - this.lastPersistAt < PERSIST_THROTTLE_MS) return;
    this.lastPersistAt = now;
    const target = this.persistPath();
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(this.ensureLoaded()), 'utf8');
    } catch {
      /* employee-state loss on write failure is acceptable — never crash the server */
    }
  }

  private appendLedger(id: string, entry: LedgerEntry): void {
    // Same VITEST guard rationale as persist() — only write when a test
    // explicitly supplied its own ledger dir.
    if (process.env.VITEST && this.explicitLedgerDir === undefined) return;
    try {
      const target = this.ledgerPath(id);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.appendFileSync(target, `${JSON.stringify(entry)}\n`, 'utf8');
      this.trimLedgerIfNeeded(target);
    } catch {
      /* ledger loss must never crash the server */
    }
  }

  private trimLedgerIfNeeded(target: string): void {
    try {
      const raw = fs.readFileSync(target, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      if (lines.length > LEDGER_MAX_LINES) {
        const trimmed = lines.slice(-LEDGER_TRIM_TO_LINES);
        fs.writeFileSync(target, `${trimmed.join('\n')}\n`, 'utf8');
      }
    } catch {
      /* trim failure is not fatal — the file just grows */
    }
  }
}

/** Process-wide instance (the server is single-process), wired to the real
 *  economyStore singleton (G2) for Reputation awards + vacation-mode
 *  awareness — the no-op defaults above only apply to test-constructed
 *  instances (`new EmployeeStore(path, ledgerDir)`), never this one. */
export const employeeStore = new EmployeeStore(undefined, undefined, {
  isVacationActive: () => economyStore.isVacationActive(),
  awardReputation: (delta, cause) => economyStore.addReputation(delta, cause),
  spendCash: (amount, cause, now) => economyStore.spend(amount, cause, now),
});
