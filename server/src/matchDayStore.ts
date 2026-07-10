/**
 * Match Day store (v3 tentpole — KICKOFF-v3.1 §1 "Match Day", STAGE 1
 * SKELETON). Chain runs become fixtures: team sheet (pre), live
 * commentary synthesized from real tail lines (live), result card from
 * real git/test outcomes (result).
 *
 * Hard rules enforced HERE:
 *  - Fixtures derive 1:1 from real chain runs — openFixture REQUIRES a
 *    chainRunId and is idempotent per unsettled run; no fixture ever
 *    exists without a run behind it.
 *  - One-tap-real: every feed event REQUIRES a non-empty sourceRef;
 *    commentary is the costume OVER the real line, never a replacement.
 *  - NO DATA is never guessed: settle() rejects a result card where a
 *    REAL axis is missing value/sourceRef, or a NO_DATA axis carries
 *    either — the schema's protocol-violation rule made executable.
 *  - Honest W/D/L: the verdict mapping itself lands in stage 2 (computed
 *    from real outcomes at the call site); the store only refuses
 *    malformed cards.
 *
 * Persisted via the shared v3 sidecar discipline (v3Persistence.ts) at
 * ~/.pixel-agents/match-days.json. Settled fixtures are retained up to
 * MATCH_DAY_SETTLED_RETENTION (oldest pruned) — the durable record of the
 * underlying run stays chainStore's own persistence.
 */

import { randomUUID } from 'crypto';

import type {
  MatchDayAxis,
  MatchDayEvent,
  MatchDayFeedEvent,
  MatchDayResult,
} from '../../core/src/messages.js';
import { V3JsonPersistence } from './v3Persistence.js';

const FILE_NAME = 'match-days.json';

/** Settled fixtures kept for the trophy/history plane before pruning. */
export const MATCH_DAY_SETTLED_RETENTION = 20;

export interface MatchDayFixture {
  fixtureId: string;
  chainRunId: string;
  phase: 'pre' | 'live' | 'result';
  events: MatchDayFeedEvent[];
  result?: MatchDayResult;
  createdAt: number;
  updatedAt: number;
}

export type MatchDayResultOutcome =
  | { ok: true; fixture: MatchDayFixture }
  | { ok: false; reason: string };

interface MatchDayData {
  fixtures: Record<string, MatchDayFixture>;
}

function emptyData(): MatchDayData {
  return { fixtures: {} };
}

/** The wire message for a fixture snapshot (internal bookkeeping fields
 *  stripped — the broadcast plane carries exactly the asyncapi shape). */
export function toMatchDayEvent(fixture: MatchDayFixture): MatchDayEvent {
  return {
    type: 'matchDayEvent',
    fixtureId: fixture.fixtureId,
    chainRunId: fixture.chainRunId,
    phase: fixture.phase,
    events: fixture.events,
    ...(fixture.result ? { result: fixture.result } : {}),
  };
}

/** REAL axes carry value + sourceRef; NO_DATA axes carry neither. */
function axisViolation(axis: MatchDayAxis): string | null {
  if (axis.status === 'REAL') {
    if (axis.value === undefined) return 'real-axis-missing-value';
    if (axis.sourceRef === undefined || axis.sourceRef.trim() === '') {
      return 'real-axis-missing-source-ref';
    }
    return null;
  }
  if (axis.value !== undefined || axis.sourceRef !== undefined) {
    return 'no-data-axis-carries-data';
  }
  return null;
}

export class MatchDayStore {
  private data: MatchDayData | null = null;
  private readonly persistence: V3JsonPersistence<MatchDayData>;
  private listeners: Array<(fixture: MatchDayFixture) => void> = [];

  constructor(persistPath?: string) {
    this.persistence = new V3JsonPersistence(FILE_NAME, persistPath);
  }

  /** Fired once per fixture mutation (opened, event appended, settled). */
  onChange(listener: (fixture: MatchDayFixture) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  // ── Reads ──────────────────────────────────────────────────────────

  getAll(): MatchDayFixture[] {
    return Object.values(this.ensureLoaded().fixtures);
  }

  getById(fixtureId: string): MatchDayFixture | undefined {
    return this.ensureLoaded().fixtures[fixtureId];
  }

  /** Unsettled fixtures — the WS connect replay set. */
  getActive(): MatchDayFixture[] {
    return this.getAll().filter((f) => f.phase !== 'result');
  }

  /** Source-data flag input (v3Flags.ts). */
  hasRecords(): boolean {
    return Object.keys(this.ensureLoaded().fixtures).length > 0;
  }

  // ── Mutations ──────────────────────────────────────────────────────

  /** Open a `pre` fixture for a REAL chain run. Idempotent: an unsettled
   *  fixture for the same run is returned as-is (one fixture per run). */
  openFixture(chainRunId: string, now: number = Date.now()): MatchDayResultOutcome {
    if (chainRunId.trim() === '') return { ok: false, reason: 'empty-chain-run-id' };
    const data = this.ensureLoaded();
    const existing = Object.values(data.fixtures).find(
      (f) => f.chainRunId === chainRunId && f.phase !== 'result',
    );
    if (existing) return { ok: true, fixture: existing };
    const fixture: MatchDayFixture = {
      fixtureId: randomUUID(),
      chainRunId,
      phase: 'pre',
      events: [],
      createdAt: now,
      updatedAt: now,
    };
    data.fixtures[fixture.fixtureId] = fixture;
    this.finish(fixture, now);
    return { ok: true, fixture };
  }

  /** Append one commentary event synthesized from a REAL tail/git/test
   *  line. Advances pre → live on the first event (kickoff). Rejects
   *  events with an empty sourceRef (one-tap-real) and any append to a
   *  settled fixture. */
  recordEvent(fixtureId: string, event: MatchDayFeedEvent): MatchDayResultOutcome {
    if (event.sourceRef.trim() === '') return { ok: false, reason: 'missing-source-ref' };
    const fixture = this.ensureLoaded().fixtures[fixtureId];
    if (!fixture) return { ok: false, reason: 'not-found' };
    if (fixture.phase === 'result') return { ok: false, reason: 'already-settled' };
    fixture.events.push(event);
    if (fixture.phase === 'pre') fixture.phase = 'live';
    this.finish(fixture, event.ts);
    return { ok: true, fixture };
  }

  /** Settle the fixture with a result card. Refuses malformed cards
   *  (axisViolation) — NO DATA is rendered, never guessed; REAL values
   *  always keep their source reference. Prunes the oldest settled
   *  fixtures past MATCH_DAY_SETTLED_RETENTION. */
  settle(
    fixtureId: string,
    result: MatchDayResult,
    now: number = Date.now(),
  ): MatchDayResultOutcome {
    const fixture = this.ensureLoaded().fixtures[fixtureId];
    if (!fixture) return { ok: false, reason: 'not-found' };
    if (fixture.phase === 'result') return { ok: false, reason: 'already-settled' };
    for (const axis of [result.tests, result.build, result.scope, result.burn]) {
      const violation = axisViolation(axis);
      if (violation) return { ok: false, reason: violation };
    }
    fixture.phase = 'result';
    fixture.result = result;
    // Stamp before pruning: the prune sorts settled fixtures by updatedAt,
    // and the one settling right now must sort as the NEWEST, not carry a
    // stale pre-settle timestamp into the "oldest first" cut.
    fixture.updatedAt = now;
    this.pruneSettled();
    this.finish(fixture, now);
    return { ok: true, fixture };
  }

  // ── Internal ──────────────────────────────────────────────────────

  private pruneSettled(): void {
    const data = this.ensureLoaded();
    const settled = Object.values(data.fixtures)
      .filter((f) => f.phase === 'result')
      .sort((a, b) => a.updatedAt - b.updatedAt);
    while (settled.length > MATCH_DAY_SETTLED_RETENTION) {
      const oldest = settled.shift();
      if (oldest) delete data.fixtures[oldest.fixtureId];
    }
  }

  private finish(fixture: MatchDayFixture, now: number): void {
    fixture.updatedAt = now;
    this.persistence.persist(this.ensureLoaded(), now, true);
    for (const listener of this.listeners) listener(fixture);
  }

  private ensureLoaded(): MatchDayData {
    if (!this.data) {
      this.data = this.persistence.load((raw) => typeof raw.fixtures === 'object', emptyData);
    }
    return this.data;
  }
}

/** Process-wide instance (the server is single-process). */
export const matchDayStore = new MatchDayStore();
