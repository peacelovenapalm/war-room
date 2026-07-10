/**
 * Perfect-ops day (v3 stage 3 — KICKOFF-v3.1 §3 WS-C item 2).
 *
 * A server-side rule over REAL timestamps already flowing through the
 * pipeline — nothing here polls, guesses, or reads token volume:
 *
 *   A local day is PERFECT iff
 *     1. real work happened that day (report.turnsCompleted > 0 — the
 *        same activity floor progression/economy apply at day close;
 *        absence of work never mints, Steady Hands doctrine), AND
 *     2. zero crises went unanswered past N minutes — measured from the
 *        poll-observed blocked transition (`since`) to the poll-observed
 *        resolution, the exact same observed-transition contract
 *        CrisisXpSink holds, AND
 *     3. zero dispatches exited nonzero that day.
 *
 * N defaults to PERFECT_OPS_DEFAULT_MAX_UNANSWERED_MINUTES (30 — see
 * economyConstants.ts for the sizing rationale) and is configurable via
 * WAR_ROOM_PERFECT_OPS_MAX_MINUTES, read per evaluation (v3Flags
 * discipline — an ops change applies without a restart).
 *
 * Honesty rules (all documented per-branch below):
 *  - A crisis still OPEN at day close violates the closing day only if it
 *    had already sat unanswered past N before that day's midnight.
 *  - A crisis resolved past N violates the day the over-N resolution was
 *    OBSERVED (cross-midnight episodes attribute to the resolution day).
 *  - A session that VANISHED while blocked (the per-tick observed clear)
 *    violates only if it was already past N when it vanished — vanishing
 *    under N means it never sat unanswered past N.
 *  - Killed dispatches are a deliberate player halt, NOT a failure (v1.1
 *    item-3 doctrine) — the /status route only feeds real 'exited'
 *    events here, and only exitCode !== 0 violates.
 *  - The TTL sweep and poller-silence clears feed NOTHING here (ambiguous
 *    is never evidence in either direction).
 *  - The award is a SINGLE bonus event with full receipts: the closed
 *    day plus every clean crisis/dispatch event observed that day.
 *  - Bonus-only: a violated day pays 0, costs 0, and notifies nothing.
 *
 * Violations are force-persisted the moment they are observed — a server
 * restart must never launder a violated day into a perfect one (silent +
 * irreversible boundary).
 */

import type { EconomyCause } from '../../core/src/messages.js';
import {
  PERFECT_OPS_DEFAULT_MAX_UNANSWERED_MINUTES,
  PERFECT_OPS_REP_BONUS,
} from './economyConstants.js';
import { economyStore } from './economyStore.js';
import type { ShiftReport } from './shiftStats.js';
import { V3JsonPersistence } from './v3Persistence.js';

/** Cap on refs retained per day (both evidence and violations) — receipts
 *  stay bounded on a heavy day; the day's verdict never depends on refs
 *  beyond the cap (violated is a boolean, not a count). */
const MAX_REFS_PER_DAY = 50;
/** Retain per-day state for this many distinct dates (day-close arrives
 *  lazily, sometimes days late — never let the map grow unbounded). */
const MAX_TRACKED_DAYS = 7;

const PERFECT_OPS_FILE_NAME = 'perfect-ops.json';

/** Ops override for N — parsed per evaluation, falls back to the
 *  documented default on anything non-numeric or non-positive. */
export function perfectOpsMaxUnansweredMs(): number {
  const raw = Number(process.env['WAR_ROOM_PERFECT_OPS_MAX_MINUTES']);
  const minutes =
    Number.isFinite(raw) && raw > 0 ? raw : PERFECT_OPS_DEFAULT_MAX_UNANSWERED_MINUTES;
  return minutes * 60_000;
}

interface PerfectOpsDayState {
  violated: boolean;
  /** Refs of the events that broke the day (kept for the one-tap-real
   *  decomposition of a "not perfect" verdict; capped). */
  violationRefs: string[];
  /** Refs of the clean observed events — these become the award receipt. */
  evidenceRefs: string[];
}

interface PerfectOpsData {
  /** Keyed by local date (YYYY-MM-DD). */
  days: Record<string, PerfectOpsDayState>;
  /** Crisis key (`agent:<id>`) → observed blocked-transition ts. */
  openCrises: Record<string, number>;
  /** Idempotence: the last date the bonus was paid for. */
  lastAwardedDate: string | null;
}

function emptyData(): PerfectOpsData {
  return { days: {}, openCrises: {}, lastAwardedDate: null };
}

function emptyDay(): PerfectOpsDayState {
  return { violated: false, violationRefs: [], evidenceRefs: [] };
}

function localDate(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** First instant AFTER the given local date (start of the next day). */
function endOfDayTs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d + 1).getTime();
}

export class PerfectOpsDayTracker {
  private data: PerfectOpsData | null = null;
  private readonly persistence: V3JsonPersistence<PerfectOpsData>;
  private readonly awardReputation: (delta: number, cause: EconomyCause) => void;

  constructor(
    persistPath?: string,
    awardReputation?: (delta: number, cause: EconomyCause) => void,
  ) {
    this.persistence = new V3JsonPersistence(PERFECT_OPS_FILE_NAME, persistPath);
    // Injected for tests; the process-wide singleton wires the real
    // economyStore (same convention as contractStore/studioContractIngest).
    this.awardReputation =
      awardReputation ?? ((delta, cause) => economyStore.addReputation(delta, cause));
  }

  private ensureLoaded(): PerfectOpsData {
    if (!this.data) {
      this.data = this.persistence.load(
        (raw) => typeof raw.days === 'object' && raw.days !== null,
        emptyData,
      );
    }
    return this.data;
  }

  private day(data: PerfectOpsData, date: string): PerfectOpsDayState {
    if (!data.days[date]) data.days[date] = emptyDay();
    return data.days[date];
  }

  private violate(data: PerfectOpsData, date: string, ref: string, now: number): void {
    const day = this.day(data, date);
    day.violated = true;
    if (day.violationRefs.length < MAX_REFS_PER_DAY) day.violationRefs.push(ref);
    // Force-persist: a violation is an irreversible fact about the day —
    // a restart must never launder it back into a perfect day.
    this.persistence.persist(data, now, true);
  }

  private evidence(data: PerfectOpsData, date: string, ref: string, now: number): void {
    const day = this.day(data, date);
    if (day.evidenceRefs.length < MAX_REFS_PER_DAY) day.evidenceRefs.push(ref);
    this.persistence.persist(data, now);
  }

  // ── Real-event feed (wired to the SAME observed transitions the v3
  //    crisis sinks and the dispatch /status route already carry) ───────

  /** The poller explicitly reported a new blocked state (V3CrisisSinks
   *  onCrisisStarted contract). `key` is the shiftStats episode key. */
  recordCrisisStarted(key: string, now: number = Date.now()): void {
    const data = this.ensureLoaded();
    if (data.openCrises[key] !== undefined) return; // already burning
    data.openCrises[key] = now;
    this.persistence.persist(data, now);
  }

  /** An OBSERVED resolution with the measured duration (never a stale
   *  sweep). Violates the day the over-N resolution was observed;
   *  otherwise the resolved episode is clean evidence for that day. */
  recordCrisisResolved(key: string, durationMs: number, now: number = Date.now()): void {
    const data = this.ensureLoaded();
    const startedAt = data.openCrises[key] ?? now - durationMs;
    delete data.openCrises[key];
    const ref = `crisis:${key}@${startedAt}`;
    if (durationMs > perfectOpsMaxUnansweredMs()) {
      this.violate(data, localDate(now), ref, now);
    } else {
      this.evidence(data, localDate(now), ref, now);
    }
  }

  /** The session vanished from the poller's report while blocked (the
   *  per-tick OBSERVED clear — never the ambiguous TTL sweep). Violates
   *  only if the crisis had already sat unanswered past N when it
   *  vanished; a sub-N vanish never sat unanswered past N and is neither
   *  violation nor evidence (it was never answered either). */
  recordCrisisAbandoned(key: string, now: number = Date.now()): void {
    const data = this.ensureLoaded();
    const startedAt = data.openCrises[key];
    if (startedAt === undefined) return;
    delete data.openCrises[key];
    if (now - startedAt > perfectOpsMaxUnansweredMs()) {
      this.violate(data, localDate(now), `crisis:${key}@${startedAt}`, now);
    } else {
      this.persistence.persist(data, now);
    }
  }

  /** A real dispatch exit ('exited' status events only — a player kill is
   *  a deliberate halt, not a failure, and never reaches here). */
  recordDispatchExit(dispatchId: string, exitCode: number, now: number = Date.now()): void {
    const data = this.ensureLoaded();
    if (exitCode !== 0) {
      this.violate(data, localDate(now), `dispatch:${dispatchId}#exit=${exitCode}`, now);
    } else {
      this.evidence(data, localDate(now), `dispatch:${dispatchId}`, now);
    }
  }

  // ── Day-close evaluation (wired via ShiftStats' onDayClose) ──────────

  /** Evaluate the just-closed day and pay the single bonus iff perfect.
   *  Idempotent per date. `report` is the closed day's final scorecard —
   *  its real turnsCompleted is the activity floor. */
  recordDayClose(report: ShiftReport, now: number = Date.now()): void {
    const data = this.ensureLoaded();
    const date = report.date;

    // Crises still open at close: violated only if the episode had already
    // sat unanswered past N BEFORE the closing day's midnight — day-close
    // fires lazily (first activity after midnight), and the hours past
    // midnight belong to the next day, not the closing one.
    const dayEnd = endOfDayTs(date);
    for (const [key, startedAt] of Object.entries(data.openCrises)) {
      if (dayEnd - startedAt > perfectOpsMaxUnansweredMs()) {
        this.violate(data, date, `crisis:${key}@${startedAt}#open-at-close`, now);
      }
    }

    const day = data.days[date] ?? emptyDay();
    const alreadyPaid = data.lastAwardedDate === date;
    const hadRealWork = report.turnsCompleted > 0;

    if (!alreadyPaid && hadRealWork && !day.violated) {
      this.awardReputation(PERFECT_OPS_REP_BONUS, {
        label: `perfect-ops-day:${date}`,
        // Receipts: the closed real day plus every clean observed event —
        // the one-tap-real decomposition of the bonus.
        sourceEventRefs: [`shift-day:${date}`, ...day.evidenceRefs],
      });
      data.lastAwardedDate = date;
    }

    // Prune old day states (keep the newest MAX_TRACKED_DAYS dates).
    const dates = Object.keys(data.days).sort();
    while (dates.length > MAX_TRACKED_DAYS) {
      delete data.days[dates.shift()!];
    }
    this.persistence.persist(data, now, true);
  }
}

/** Process-wide instance (the server is single-process), wired to the
 *  real economyStore. */
export const perfectOpsDay = new PerfectOpsDayTracker();
