/**
 * Unit tests for the shift-report accumulator (v1 mechanic #2).
 *
 * Covers: turn/token accounting, blocked-episode lifecycle (mean/longest
 * time-to-unblock), day rollover, efficiency grading (LOW spend = better),
 * briefing-delta baseline behavior, and sidecar persistence.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearBriefingCache } from '../src/briefingProvider.js';
import { EFFICIENCY_LEAN_MAX, EFFICIENCY_STEADY_MAX, ShiftStats } from '../src/shiftStats.js';

/** 2026-07-07 12:00 local. */
const NOON = new Date(2026, 6, 7, 12, 0, 0).getTime();
const NEXT_DAY = new Date(2026, 6, 8, 9, 0, 0).getTime();

let tmpDir: string;
let statsPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shift-stats-'));
  statsPath = path.join(tmpDir, 'shift-stats.json');
  // No briefing env sources in tests → todo/tracker halves are null.
  delete process.env.WAR_ROOM_TODO_DIR;
  delete process.env.WAR_ROOM_TRACKER_STATE;
  clearBriefingCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ShiftStats', () => {
  it('accumulates turns and token deltas for the day', () => {
    const s = new ShiftStats(statsPath);
    s.recordTurnEnd(NOON);
    s.recordTurnEnd(NOON + 1000);
    s.recordTokens(1000, 200, NOON + 2000);
    s.recordTokens(500, 100, NOON + 3000);
    const r = s.getReport(NOON + 4000);
    expect(r.turnsCompleted).toBe(2);
    expect(r.tokensIn).toBe(1500);
    expect(r.tokensOut).toBe(300);
    expect(r.outputTokensPerTurn).toBe(150);
    expect(r.efficiency).toBe('LEAN');
  });

  it('tracks blocked episodes: mean + longest time-to-unblock, open count', () => {
    const s = new ShiftStats(statsPath);
    s.startBlocked('agent:1', NOON, NOON);
    s.startBlocked('agent:2', NOON + 10_000, NOON + 10_000);
    s.endBlocked('agent:1', NOON + 60_000); // 60s episode
    expect(s.getReport(NOON + 61_000).crisesOpen).toBe(1);
    s.endBlocked('agent:2', NOON + 130_000); // 120s episode
    const r = s.getReport(NOON + 131_000);
    expect(r.crisesIgnited).toBe(2);
    expect(r.crisesResolved).toBe(2);
    expect(r.crisesOpen).toBe(0);
    expect(r.meanTimeToUnblockMs).toBe(90_000);
    expect(r.longestBlockedMs).toBe(120_000);
  });

  it('is idempotent per episode key and ignores unknown ends', () => {
    const s = new ShiftStats(statsPath);
    s.startBlocked('agent:1', NOON, NOON);
    s.startBlocked('agent:1', NOON + 5_000, NOON + 5_000); // still the same fire
    expect(s.getReport(NOON + 6_000).crisesIgnited).toBe(1);
    s.endBlocked('agent:9', NOON + 7_000); // never started
    expect(s.getReport(NOON + 8_000).crisesResolved).toBe(0);
  });

  it('rolls the ledger at the local date change; open episodes carry over', () => {
    const s = new ShiftStats(statsPath);
    s.recordTurnEnd(NOON);
    s.startBlocked('agent:1', NOON, NOON);
    const nextDay = s.getReport(NEXT_DAY);
    expect(nextDay.date).toBe('2026-07-08');
    expect(nextDay.turnsCompleted).toBe(0); // yesterday's turns gone
    expect(nextDay.crisesOpen).toBe(1); // the fire is still burning
    // ...and resolving it counts for TODAY
    s.endBlocked('agent:1', NEXT_DAY + 1000);
    expect(s.getReport(NEXT_DAY + 2000).crisesResolved).toBe(1);
  });

  it('grades efficiency by output tokens per turn — LOWER is better', () => {
    const lean = new ShiftStats(path.join(tmpDir, 'a.json'));
    lean.recordTurnEnd(NOON);
    lean.recordTokens(0, EFFICIENCY_LEAN_MAX, NOON);
    expect(lean.getReport(NOON).efficiency).toBe('LEAN');

    const steady = new ShiftStats(path.join(tmpDir, 'b.json'));
    steady.recordTurnEnd(NOON);
    steady.recordTokens(0, EFFICIENCY_STEADY_MAX, NOON);
    expect(steady.getReport(NOON).efficiency).toBe('STEADY');

    const heavy = new ShiftStats(path.join(tmpDir, 'c.json'));
    heavy.recordTurnEnd(NOON);
    heavy.recordTokens(0, EFFICIENCY_STEADY_MAX + 1, NOON);
    expect(heavy.getReport(NOON).efficiency).toBe('HEAVY');

    // No turns yet → no score, no grade (never divide by zero).
    const idle = new ShiftStats(path.join(tmpDir, 'd.json'));
    expect(idle.getReport(NOON).outputTokensPerTurn).toBeNull();
    expect(idle.getReport(NOON).efficiency).toBeNull();
  });

  it('briefing deltas are null without configured sources', () => {
    const s = new ShiftStats(statsPath);
    const r = s.getReport(NOON);
    expect(r.todosClosed).toBeNull();
    expect(r.gatesAdvanced).toBeNull();
  });

  it('persists the day and reloads it (server restart survives)', () => {
    const s = new ShiftStats(statsPath);
    s.recordTurnEnd(NOON);
    s.recordTokens(100, 50, NOON + 1);
    // force a flush via a day-scoped forced persist: getReport captures baseline
    s.getReport(NOON + 2);
    const reloaded = new ShiftStats(statsPath);
    const r = reloaded.getReport(NOON + 3);
    expect(r.turnsCompleted).toBe(1);
    expect(r.tokensOut).toBe(50);
  });

  describe('rollover retention + push (deferred nit + shift push)', () => {
    it('has no yesterday report before the first rollover', () => {
      const s = new ShiftStats(statsPath);
      s.recordTurnEnd(NOON);
      expect(s.getYesterdayReport(NOON)).toBeNull();
    });

    it('retains the closed day as "yesterday" at rollover', () => {
      const s = new ShiftStats(statsPath);
      s.recordTurnEnd(NOON);
      s.recordTokens(100, 300, NOON + 1000);
      // Rolls over — today's ledger resets, but the final scorecard for
      // 2026-07-07 must survive as "yesterday".
      const today = s.getReport(NEXT_DAY);
      expect(today.date).toBe('2026-07-08');
      expect(today.turnsCompleted).toBe(0);

      const yesterday = s.getYesterdayReport(NEXT_DAY);
      expect(yesterday).not.toBeNull();
      expect(yesterday?.date).toBe('2026-07-07');
      expect(yesterday?.turnsCompleted).toBe(1);
      expect(yesterday?.tokensOut).toBe(300);
    });

    it('the yesterday snapshot survives a restart (persisted)', () => {
      const s = new ShiftStats(statsPath);
      s.recordTurnEnd(NOON);
      s.recordTokens(0, 200, NOON);
      s.getReport(NEXT_DAY); // triggers rollover + forced persist

      const reloaded = new ShiftStats(statsPath);
      const yesterday = reloaded.getYesterdayReport(NEXT_DAY);
      expect(yesterday?.date).toBe('2026-07-07');
      expect(yesterday?.turnsCompleted).toBe(1);
    });

    it("fires onDayClose exactly once with the closed day's final report", () => {
      const onDayClose = vi.fn();
      const s = new ShiftStats(statsPath, onDayClose);
      s.recordTurnEnd(NOON);
      s.recordTokens(0, 300, NOON);
      s.startBlocked('agent:1', NOON, NOON);
      s.endBlocked('agent:1', NOON + 30_000);

      // Multiple calls right at/after rollover must still fire onDayClose
      // only once (rollDay reassigns this.day synchronously on first hit).
      s.getReport(NEXT_DAY);
      s.getReport(NEXT_DAY + 100);
      s.recordTurnEnd(NEXT_DAY + 200);

      expect(onDayClose).toHaveBeenCalledTimes(1);
      const closed = onDayClose.mock.calls[0][0];
      expect(closed.date).toBe('2026-07-07');
      expect(closed.turnsCompleted).toBe(1);
      expect(closed.crisesResolved).toBe(1);
    });

    it('a throwing onDayClose never breaks stat recording', () => {
      const s = new ShiftStats(statsPath, () => {
        throw new Error('push blew up');
      });
      s.recordTurnEnd(NOON);
      expect(() => s.getReport(NEXT_DAY)).not.toThrow();
      expect(s.getReport(NEXT_DAY).date).toBe('2026-07-08');
    });
  });
});
