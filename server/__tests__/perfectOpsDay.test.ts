/**
 * Perfect-ops day (v3 stage 3 — KICKOFF-v3.1 §3 WS-C item 2).
 *
 * Covers: the perfect-day award with full receipts, every violation path
 * (slow resolution, still-open-past-N at close, over-N abandonment,
 * failed dispatch), the honesty edges (sub-N abandonment and cross-
 * midnight open crises never violate; zero-turn days never mint;
 * bonus-only — a violated day pays 0), idempotence per date, the
 * WAR_ROOM_PERFECT_OPS_MAX_MINUTES override, and violation persistence
 * across a restart (a reboot must never launder a violated day).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PERFECT_OPS_DEFAULT_MAX_UNANSWERED_MINUTES,
  PERFECT_OPS_REP_BONUS,
} from '../src/economyConstants.js';
import { PerfectOpsDayTracker, perfectOpsMaxUnansweredMs } from '../src/perfectOpsDay.js';
import type { ShiftReport } from '../src/shiftStats.js';

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => '/nonexistent-perfect-ops-home' };
});

let tmpDir: string;
let statePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perfect-ops-'));
  statePath = path.join(tmpDir, 'perfect-ops.json');
  delete process.env['WAR_ROOM_PERFECT_OPS_MAX_MINUTES'];
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env['WAR_ROOM_PERFECT_OPS_MAX_MINUTES'];
});

const DAY1 = new Date(2026, 6, 7, 12, 0, 0).getTime(); // Tue 2026-07-07 noon
const DATE1 = '2026-07-07';
const MINUTE = 60_000;
const N_MS = PERFECT_OPS_DEFAULT_MAX_UNANSWERED_MINUTES * MINUTE;

function report(overrides: Partial<ShiftReport> = {}): ShiftReport {
  return {
    date: DATE1,
    turnsCompleted: 5,
    tokensIn: 0,
    tokensOut: 0,
    crisesIgnited: 0,
    crisesResolved: 0,
    crisesOpen: 0,
    meanTimeToUnblockMs: null,
    longestBlockedMs: 0,
    todosClosed: null,
    gatesAdvanced: null,
    outputTokensPerTurn: null,
    efficiency: null,
    reworkDismissed: 0,
    generatedAt: new Date(DAY1).toISOString(),
    ...overrides,
  };
}

function makeTracker() {
  const award = vi.fn();
  const tracker = new PerfectOpsDayTracker(statePath, award);
  return { tracker, award };
}

describe('perfectOpsMaxUnansweredMs — configurable N with documented default', () => {
  it('defaults to PERFECT_OPS_DEFAULT_MAX_UNANSWERED_MINUTES (30)', () => {
    expect(PERFECT_OPS_DEFAULT_MAX_UNANSWERED_MINUTES).toBe(30);
    expect(perfectOpsMaxUnansweredMs()).toBe(30 * MINUTE);
  });

  it('honors WAR_ROOM_PERFECT_OPS_MAX_MINUTES and ignores junk values', () => {
    process.env['WAR_ROOM_PERFECT_OPS_MAX_MINUTES'] = '5';
    expect(perfectOpsMaxUnansweredMs()).toBe(5 * MINUTE);
    process.env['WAR_ROOM_PERFECT_OPS_MAX_MINUTES'] = 'banana';
    expect(perfectOpsMaxUnansweredMs()).toBe(N_MS);
    process.env['WAR_ROOM_PERFECT_OPS_MAX_MINUTES'] = '-3';
    expect(perfectOpsMaxUnansweredMs()).toBe(N_MS);
  });
});

describe('PerfectOpsDayTracker — the perfect day', () => {
  it('awards the single bonus with full receipts on a clean day with real work', () => {
    const { tracker, award } = makeTracker();
    // A crisis answered fast and a clean dispatch — both clean evidence.
    tracker.recordCrisisStarted('agent:7', DAY1);
    tracker.recordCrisisResolved('agent:7', 2 * MINUTE, DAY1 + 2 * MINUTE);
    tracker.recordDispatchExit('d-1', 0, DAY1 + 3 * MINUTE);

    tracker.recordDayClose(report({ turnsCompleted: 4 }), DAY1 + 13 * 3_600_000);

    expect(award).toHaveBeenCalledTimes(1);
    const [delta, cause] = award.mock.calls[0];
    expect(delta).toBe(PERFECT_OPS_REP_BONUS);
    expect(cause.label).toBe(`perfect-ops-day:${DATE1}`);
    expect(cause.sourceEventRefs).toContain(`shift-day:${DATE1}`);
    expect(cause.sourceEventRefs).toContain(`crisis:agent:7@${DAY1}`);
    expect(cause.sourceEventRefs).toContain('dispatch:d-1');
  });

  it('a day with zero crises and zero dispatches but real turns is still perfect', () => {
    const { tracker, award } = makeTracker();
    tracker.recordDayClose(report({ turnsCompleted: 1 }), DAY1);
    expect(award).toHaveBeenCalledTimes(1);
    expect(award.mock.calls[0][1].sourceEventRefs).toEqual([`shift-day:${DATE1}`]);
  });

  it('is idempotent per date — a re-close of the same day never double-pays', () => {
    const { tracker, award } = makeTracker();
    tracker.recordDayClose(report(), DAY1);
    tracker.recordDayClose(report(), DAY1 + 1000);
    expect(award).toHaveBeenCalledTimes(1);
  });

  it('a zero-turn day never mints, however flawless (absence of work is not ops)', () => {
    const { tracker, award } = makeTracker();
    tracker.recordDispatchExit('d-1', 0, DAY1);
    tracker.recordDayClose(report({ turnsCompleted: 0 }), DAY1);
    expect(award).not.toHaveBeenCalled();
  });
});

describe('PerfectOpsDayTracker — violation paths (bonus-only: pay 0, cost 0)', () => {
  it('a crisis resolved past N minutes breaks the day', () => {
    const { tracker, award } = makeTracker();
    tracker.recordCrisisStarted('agent:7', DAY1);
    tracker.recordCrisisResolved('agent:7', N_MS + 1, DAY1 + N_MS + 1);
    tracker.recordDayClose(report(), DAY1 + 2 * N_MS);
    expect(award).not.toHaveBeenCalled();
  });

  it('a crisis resolved at exactly N minutes does NOT break the day (boundary)', () => {
    const { tracker, award } = makeTracker();
    tracker.recordCrisisStarted('agent:7', DAY1);
    tracker.recordCrisisResolved('agent:7', N_MS, DAY1 + N_MS);
    tracker.recordDayClose(report(), DAY1 + 2 * N_MS);
    expect(award).toHaveBeenCalledTimes(1);
  });

  it('a failed dispatch (exit != 0) breaks the day', () => {
    const { tracker, award } = makeTracker();
    tracker.recordDispatchExit('d-bad', 1, DAY1);
    tracker.recordDayClose(report(), DAY1 + 1000);
    expect(award).not.toHaveBeenCalled();
  });

  it('a crisis still open past N at day close breaks the closing day', () => {
    const { tracker, award } = makeTracker();
    tracker.recordCrisisStarted('agent:9', DAY1); // noon, never resolved
    // Day closes lazily next morning — the episode sat > N before midnight.
    tracker.recordDayClose(report(), DAY1 + 20 * 3_600_000);
    expect(award).not.toHaveBeenCalled();
  });

  it('a crisis that started < N before midnight does NOT break the closing day (cross-midnight honesty)', () => {
    const { tracker, award } = makeTracker();
    const tenBeforeMidnight = new Date(2026, 6, 7, 23, 50, 0).getTime();
    tracker.recordCrisisStarted('agent:9', tenBeforeMidnight);
    // Close fires at 00:30 next day: the episode is 40min old NOW, but only
    // sat 10min unanswered within the closing day itself.
    tracker.recordDayClose(report(), new Date(2026, 6, 8, 0, 30, 0).getTime());
    expect(award).toHaveBeenCalledTimes(1);
  });

  it('an abandonment past N breaks the day; a sub-N vanish neither breaks nor evidences', () => {
    const { tracker, award } = makeTracker();
    // Sub-N vanish: ambiguous end, never sat unanswered past N — clean day.
    tracker.recordCrisisStarted('agent:1', DAY1);
    tracker.recordCrisisAbandoned('agent:1', DAY1 + MINUTE);
    tracker.recordDayClose(report(), DAY1 + 2 * MINUTE);
    expect(award).toHaveBeenCalledTimes(1);
    expect(award.mock.calls[0][1].sourceEventRefs).toEqual([`shift-day:${DATE1}`]);

    // Over-N abandonment on the next day: violated.
    const day2Report = report({ date: '2026-07-08' });
    const day2 = DAY1 + 86_400_000;
    tracker.recordCrisisStarted('agent:2', day2);
    tracker.recordCrisisAbandoned('agent:2', day2 + N_MS + 1);
    tracker.recordDayClose(day2Report, day2 + N_MS + 2);
    expect(award).toHaveBeenCalledTimes(1); // still just day 1
  });

  it('honors a tightened N from the environment', () => {
    process.env['WAR_ROOM_PERFECT_OPS_MAX_MINUTES'] = '1';
    const { tracker, award } = makeTracker();
    tracker.recordCrisisStarted('agent:7', DAY1);
    tracker.recordCrisisResolved('agent:7', 2 * MINUTE, DAY1 + 2 * MINUTE); // fine at 30, not at 1
    tracker.recordDayClose(report(), DAY1 + 3 * MINUTE);
    expect(award).not.toHaveBeenCalled();
  });
});

describe('PerfectOpsDayTracker — persistence (restarts never launder a violation)', () => {
  it('a violation observed before a restart still blocks the award after it', () => {
    const first = new PerfectOpsDayTracker(statePath, vi.fn());
    first.recordDispatchExit('d-bad', 2, DAY1); // force-persisted violation

    const award = vi.fn();
    const second = new PerfectOpsDayTracker(statePath, award);
    second.recordDayClose(report(), DAY1 + 1000);
    expect(award).not.toHaveBeenCalled();
  });

  it('an already-paid date survives a restart (no double-pay after reboot)', () => {
    const award1 = vi.fn();
    const first = new PerfectOpsDayTracker(statePath, award1);
    first.recordDayClose(report(), DAY1);
    expect(award1).toHaveBeenCalledTimes(1);

    const award2 = vi.fn();
    const second = new PerfectOpsDayTracker(statePath, award2);
    second.recordDayClose(report(), DAY1 + 1000);
    expect(award2).not.toHaveBeenCalled();
  });

  it('an open crisis survives a restart and still breaks the day at close', () => {
    const first = new PerfectOpsDayTracker(statePath, vi.fn());
    first.recordCrisisStarted('agent:9', DAY1);
    // recordCrisisStarted persists throttled; force a write via a violation-free
    // day-close on a PREVIOUS date (force-persist path) — use a dispatch instead:
    first.recordDispatchExit('d-ok', 0, DAY1 + 1000);

    const award = vi.fn();
    const second = new PerfectOpsDayTracker(statePath, award);
    second.recordDayClose(report(), DAY1 + 20 * 3_600_000);
    expect(award).not.toHaveBeenCalled();
  });
});
