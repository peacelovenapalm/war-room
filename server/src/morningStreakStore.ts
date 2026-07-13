/**
 * Clean-morning streak counter (V6-6 "parallel-run bookkeeping",
 * V6-DESIGN §V6-6 / RUN-MAP §3 V6-6). Persisted server-side via the same
 * V3JsonPersistence sidecar discipline every other v3 store uses
 * (~/.pixel-agents/morning-streak.json by default, override-able for
 * tests).
 *
 * A morning is CLEAN iff (per §0.3, restated in V6-DESIGN): the push
 * fired ON SCHEDULE (the push tick actually ran the local-hour gate, not
 * suppressed/skipped) AND GET /api/morning composed WITHOUT a degraded
 * section (no ⊘ where real data existed, no stale-presented-as-fresh).
 * Any breach resets the streak to 0 and receipts the reason — never a
 * silent reset.
 *
 * recordOutcome is idempotent per local calendar date (the SAME date
 * string the push tick itself computed, passed in rather than
 * re-derived here — this store has no timezone opinion of its own) so a
 * process restart mid-morning can't double-count.
 */

import { V3JsonPersistence } from './v3Persistence.js';

const STATE_FILE_NAME = 'morning-streak.json';

export interface MorningStreakState {
  count: number;
  /** Local date string (YYYY-MM-DD, in the push tick's own zone) of the
   *  last day an outcome was recorded — the idempotency key. */
  lastRecordedDate: string | null;
  /** Whether `lastRecordedDate`'s own outcome was clean — distinct from
   *  lastBreachReason/lastBreachAt (which stay from the MOST RECENT
   *  breach, possibly days ago, once the streak is clean again). V6-5's
   *  spot-check sampling needs "was YESTERDAY specifically degraded",
   *  which only this field answers. */
  lastOutcomeClean: boolean | null;
  lastCleanAt: number | null;
  lastBreachReason: string | null;
  lastBreachAt: number | null;
}

function emptyState(): MorningStreakState {
  return {
    count: 0,
    lastRecordedDate: null,
    lastOutcomeClean: null,
    lastCleanAt: null,
    lastBreachReason: null,
    lastBreachAt: null,
  };
}

export class MorningStreakStore {
  private data: MorningStreakState | null = null;
  private readonly persistence: V3JsonPersistence<MorningStreakState>;

  constructor(statePath?: string) {
    this.persistence = new V3JsonPersistence(STATE_FILE_NAME, statePath);
  }

  private ensureLoaded(): MorningStreakState {
    if (!this.data) {
      this.data = this.persistence.load((raw) => typeof raw.count === 'number', emptyState);
    }
    return this.data;
  }

  getSnapshot(): MorningStreakState {
    return { ...this.ensureLoaded() };
  }

  /** Records today's outcome once per `localDate`. A second call for a
   *  date already recorded is a silent no-op (mirrors notifyBark.ts's own
   *  once-per-day dedupe discipline) — never double-increments or
   *  double-resets on a restart or a retried tick. */
  recordOutcome(
    clean: boolean,
    localDate: string,
    reason: string | undefined,
    now: number = Date.now(),
  ): MorningStreakState {
    const data = this.ensureLoaded();
    if (data.lastRecordedDate === localDate) return { ...data };

    data.lastRecordedDate = localDate;
    data.lastOutcomeClean = clean;
    if (clean) {
      data.count += 1;
      data.lastCleanAt = now;
    } else {
      data.count = 0;
      data.lastBreachReason = reason ?? 'unspecified';
      data.lastBreachAt = now;
    }
    this.persistence.persist(data, now, true);
    return { ...data };
  }

  /** Test-only: force the next getSnapshot()/recordOutcome() to reload
   *  from disk instead of serving the in-memory copy. */
  clearCacheForTests(): void {
    this.data = null;
  }
}

export const morningStreakStore = new MorningStreakStore();
