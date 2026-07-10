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
import { contractStore } from './contractStore.js';
import { economyStore } from './economyStore.js';
import { progression } from './progressionStore.js';
import { pushShiftReport } from './shiftPush.js';

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
  /** Rework-bin crates dismissed today (v3 failure loop — dismiss is a
   *  first-class verb and is COUNTED, never shamed: a plain number on the
   *  scorecard with zero grade impact). */
  reworkDismissed: number;
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
  /** Rework-bin crates dismissed today (v3 — informational count only). */
  reworkDismissed: number;
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
    reworkDismissed: 0,
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
  /** The last CLOSED day's final scorecard (deferred nit: previous-day card). */
  private yesterdayReport: ShiftReport | null = null;
  private lastPersistAt = 0;
  private explicitPath: string | undefined;
  private resolvedPath: string | undefined;
  private usingDefaultPath = false;
  private readonly onDayClose: (report: ShiftReport) => void;

  /** `onDayClose` fires once per rollover with the just-closed day's final
   *  report — production wires it to `pushShiftReport` (fire-and-forget,
   *  env-gated) AND to the progression store's shift-grade XP bonus (v1
   *  mechanic #3 — LOWER spend grades better and earns MORE, never less);
   *  tests can inject a spy instead of touching either. */
  constructor(persistPath?: string, onDayClose?: (report: ShiftReport) => void) {
    // Everything filesystem-touching is lazy — the process-wide singleton is
    // constructed at import time, before test mocks (os.homedir) exist.
    this.explicitPath = persistPath;
    this.onDayClose =
      onDayClose ??
      ((report) => {
        pushShiftReport(report);
        const summary = {
          date: report.date,
          turnsCompleted: report.turnsCompleted,
          efficiency: report.efficiency,
        };
        progression.recordShiftDayClosed(summary);
        // Economy (v2 mechanic G2, GAME-DESIGN §3): same day-close call
        // site as progression above — added alongside, not instead of.
        economyStore.recordShiftDayClosed(summary);
        // Missions (v2 mechanic G4, GAME-DESIGN §6.2): dailies/weeklies are
        // self-certifying, but only ever mint off a day that actually had
        // real activity — the same turnsCompleted>0 gate progression/economy
        // already apply, so a zero-activity day never pays a contract.
        if (report.turnsCompleted > 0) {
          contractStore.mintDaily();
          if (new Date().getDay() === 1) contractStore.mintWeekly();
        }
      });
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
      // The ledger is closing — snapshot its final scorecard BEFORE wiping
      // it: this is what "yesterday" means (deferred nit: previous-day
      // card) and what gets pushed to Greg's phone/morning page (feature
      // #1: shift push). Runs exactly once per rollover — this.day is
      // reassigned synchronously below, so re-entrant calls in the same
      // tick never see the stale date again.
      const closedReport = this.computeReport(this.day, this.openBlocked.size, now);
      this.yesterdayReport = closedReport;
      try {
        this.onDayClose(closedReport);
      } catch {
        /* push delivery must never break stat recording */
      }
      this.day = emptyDay(date);
      // Open episodes carry across midnight — a fire burning at 23:59 is
      // still burning at 00:01; its resolution counts for the new day.
      this.captureBaseline(now);
      this.persist(now, true);
    }
    return this.day;
  }

  /** Pure scorecard builder shared by the live report and the rollover
   *  snapshot pushed/retained as "yesterday". */
  private computeReport(day: ShiftDay, openCount: number, now: number): ShiftReport {
    const briefing = getBriefing(now);
    const counts = briefingCounts(briefing);
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
      crisesOpen: openCount,
      meanTimeToUnblockMs:
        day.crisesResolved > 0 ? Math.round(day.blockedMsTotal / day.crisesResolved) : null,
      longestBlockedMs: day.longestBlockedMs,
      todosClosed:
        hasBriefingSources && day.baseline
          ? Math.max(0, day.baseline.openTodos - counts.openTodos)
          : null,
      gatesAdvanced:
        hasBriefingSources && day.baseline
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
      reworkDismissed: day.reworkDismissed,
      generatedAt: new Date(now).toISOString(),
    };
  }

  /** Snapshot briefing counts as the day's delta baseline. Runs once per day
   *  (day creation or first report) — getBriefing is 60s-cached anyway. */
  private captureBaseline(now: number): void {
    if (!this.day || this.day.baseline) return;
    try {
      this.day.baseline = { ...briefingCounts(getBriefing(now)), capturedAt: now };
    } catch {
      /* briefing failure must never break stats recording */
    }
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

  /** A rework-bin crate was dismissed (v3 failure loop — the REQUIRED
   *  dismiss verb, counted on the scorecard; no grade or award effect). */
  recordReworkDismissed(now: number = Date.now()): void {
    this.rollDay(now).reworkDismissed++;
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
    if (!day.baseline) {
      this.captureBaseline(now);
      this.persist(now, true);
    }
    return this.computeReport(day, this.openBlocked.size, now);
  }

  /** The last CLOSED day's final scorecard, or null before the first
   *  rollover has ever happened (deferred nit: previous-day card). Rolls
   *  the ledger first so a call right after midnight sees the fresh split. */
  getYesterdayReport(now: number = Date.now()): ShiftReport | null {
    this.rollDay(now);
    return this.yesterdayReport;
  }

  // ── Persistence (tolerant, throttled) ─────────────────────────

  private load(): ShiftDay | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.persistPath(), 'utf8')) as ShiftDay & {
        openBlocked?: Array<[string, number]>;
        yesterdayReport?: ShiftReport | null;
      };
      if (raw && typeof raw.date === 'string' && typeof raw.turnsCompleted === 'number') {
        // Open episodes survive restarts — otherwise a still-burning session
        // re-ignites on the next poll tick and inflates crisesIgnited.
        if (Array.isArray(raw.openBlocked)) {
          for (const [key, since] of raw.openBlocked) {
            if (typeof key === 'string' && typeof since === 'number') {
              this.openBlocked.set(key, since);
            }
          }
        }
        // Previous-day card survives restarts too (deferred nit fix).
        if (raw.yesterdayReport && typeof raw.yesterdayReport === 'object') {
          this.yesterdayReport = raw.yesterdayReport;
        }
        delete raw.openBlocked;
        delete raw.yesterdayReport;
        // Sidecars written before the v3 rework counter existed lack the
        // field — normalize rather than reset the whole day.
        if (typeof raw.reworkDismissed !== 'number') raw.reworkDismissed = 0;
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
      fs.writeFileSync(
        target,
        JSON.stringify({
          ...this.day,
          openBlocked: [...this.openBlocked.entries()],
          yesterdayReport: this.yesterdayReport,
        }),
        'utf8',
      );
    } catch {
      /* stats loss on write failure is acceptable — never crash the server */
    }
  }
}

/** Process-wide instance (the server is single-process). */
export const shiftStats = new ShiftStats();
