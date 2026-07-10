/**
 * Unit tests for the progression store (v1 mechanic #3).
 *
 * Covers: XP sources (turn completion, crisis resolution, shift-grade
 * bonus), level curve, the daily-use streak (M5 soak mechanic), permanent
 * unlock flags, persistence, and the change-notification plane used to
 * broadcast over WebSocket.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  computeLevel,
  ProgressionStore,
  XP_CRISIS_RESOLVED,
  XP_SHIFT_GRADE_BONUS,
  XP_TURN_COMPLETED,
} from '../src/progressionStore.js';

/** 2026-07-07 12:00 local. */
const DAY1 = new Date(2026, 6, 7, 12, 0, 0).getTime();
const DAY2 = new Date(2026, 6, 8, 9, 0, 0).getTime(); // +1 day
const DAY3 = new Date(2026, 6, 9, 9, 0, 0).getTime(); // +2 days
const DAY5 = new Date(2026, 6, 11, 9, 0, 0).getTime(); // +2-day gap from DAY3

let tmpDir: string;
let statePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'progression-'));
  statePath = path.join(tmpDir, 'progression.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('computeLevel', () => {
  it('starts at level 1 with zero XP required', () => {
    expect(computeLevel(0)).toEqual({ level: 1, xpIntoLevel: 0, xpForNextLevel: 100 });
  });

  it('advances a level once enough XP accrues, carrying the remainder', () => {
    const info = computeLevel(100);
    expect(info.level).toBe(2);
    expect(info.xpIntoLevel).toBe(0);
  });

  it('never regresses for growing XP', () => {
    let prevLevel = 1;
    for (let xp = 0; xp <= 5000; xp += 37) {
      const { level } = computeLevel(xp);
      expect(level).toBeGreaterThanOrEqual(prevLevel);
      prevLevel = level;
    }
  });
});

describe('ProgressionStore', () => {
  it('awards XP for a completed turn and starts the streak at 1', () => {
    const p = new ProgressionStore(statePath);
    p.recordTurnEnd('test:turn', DAY1);
    const s = p.getSnapshot();
    expect(s.xp).toBe(XP_TURN_COMPLETED);
    expect(s.streakCurrent).toBe(1);
    expect(s.streakLongest).toBe(1);
  });

  it('awards XP for an observed crisis resolution', () => {
    const p = new ProgressionStore(statePath);
    p.recordCrisisResolved('test:crisis', DAY1);
    expect(p.getSnapshot().xp).toBe(XP_CRISIS_RESOLVED);
  });

  it('never awards XP from token volume — no such API exists on the store', () => {
    const p = new ProgressionStore(statePath);
    expect((p as unknown as Record<string, unknown>).recordTokens).toBeUndefined();
  });

  it('does not double-count the streak for multiple turns on the same day', () => {
    const p = new ProgressionStore(statePath);
    p.recordTurnEnd('test:turn', DAY1);
    p.recordTurnEnd('test:turn', DAY1 + 60_000);
    p.recordTurnEnd('test:turn', DAY1 + 120_000);
    const s = p.getSnapshot();
    expect(s.streakCurrent).toBe(1);
    expect(s.xp).toBe(XP_TURN_COMPLETED * 3);
  });

  it('increments the streak on a consecutive day and resets on a gap', () => {
    const p = new ProgressionStore(statePath);
    p.recordTurnEnd('test:turn', DAY1);
    p.recordTurnEnd('test:turn', DAY2);
    expect(p.getSnapshot().streakCurrent).toBe(2);
    p.recordTurnEnd('test:turn', DAY3);
    expect(p.getSnapshot().streakCurrent).toBe(3);
    expect(p.getSnapshot().streakLongest).toBe(3);
    // DAY5 is a 2-day gap from DAY3 — streak resets to 1, longest is retained.
    p.recordTurnEnd('test:turn', DAY5);
    const s = p.getSnapshot();
    expect(s.streakCurrent).toBe(1);
    expect(s.streakLongest).toBe(3);
  });

  it('grades the shift-day bonus by efficiency — LOWER spend earns MORE, HEAVY earns nothing', () => {
    const p = new ProgressionStore(statePath);
    p.recordShiftDayClosed({ date: '2026-07-07', turnsCompleted: 5, efficiency: 'LEAN' }, DAY1);
    expect(p.getSnapshot().xp).toBe(XP_SHIFT_GRADE_BONUS.LEAN);
    p.recordShiftDayClosed({ date: '2026-07-08', turnsCompleted: 5, efficiency: 'HEAVY' }, DAY2);
    expect(p.getSnapshot().xp).toBe(XP_SHIFT_GRADE_BONUS.LEAN + XP_SHIFT_GRADE_BONUS.HEAVY);
  });

  it('skips the shift-grade bonus for a day with zero completed turns or no grade', () => {
    const p = new ProgressionStore(statePath);
    p.recordShiftDayClosed({ date: '2026-07-07', turnsCompleted: 0, efficiency: 'LEAN' }, DAY1);
    p.recordShiftDayClosed({ date: '2026-07-08', turnsCompleted: 3, efficiency: null }, DAY2);
    expect(p.getSnapshot().xp).toBe(0);
  });

  it('unlocks streakBronze/Silver/Gold at 3/7/30 days and never reverts them', () => {
    const p = new ProgressionStore(statePath);
    for (let i = 0; i < 7; i++) {
      p.recordTurnEnd('test:turn', DAY1 + i * 86_400_000);
    }
    let s = p.getSnapshot();
    expect(s.unlocks.streakBronze).toBe(true);
    expect(s.unlocks.streakSilver).toBe(true);
    expect(s.unlocks.streakGold).toBe(false);
    // Break the streak with a big gap — unlocks already earned must stay true.
    p.recordTurnEnd('test:turn', DAY1 + 30 * 86_400_000);
    s = p.getSnapshot();
    expect(s.streakCurrent).toBe(1);
    expect(s.unlocks.streakBronze).toBe(true);
    expect(s.unlocks.streakSilver).toBe(true);
  });

  it('unlocks leanGrade5 after 5 cumulative LEAN-graded days', () => {
    const p = new ProgressionStore(statePath);
    for (let i = 0; i < 5; i++) {
      p.recordShiftDayClosed(
        { date: `day-${i}`, turnsCompleted: 1, efficiency: 'LEAN' },
        DAY1 + i * 1000,
      );
    }
    expect(p.getSnapshot().unlocks.leanGrade5).toBe(true);
  });

  it('unlocks level milestones as XP crosses the level-5/10 thresholds', () => {
    const p = new ProgressionStore(statePath);
    for (let i = 0; i < 500; i++) {
      p.recordTurnEnd('test:turn', DAY1 + i);
    }
    const s = p.getSnapshot();
    expect(s.level).toBeGreaterThanOrEqual(5);
    expect(s.unlocks.level5).toBe(true);
  });

  it('notifies onChange listeners after every mutation and supports unsubscribe', () => {
    const p = new ProgressionStore(statePath);
    const seen: number[] = [];
    const unsubscribe = p.onChange((snap) => seen.push(snap.xp));
    p.recordTurnEnd('test:turn', DAY1);
    p.recordCrisisResolved('test:crisis', DAY1);
    expect(seen).toEqual([XP_TURN_COMPLETED, XP_TURN_COMPLETED + XP_CRISIS_RESOLVED]);
    unsubscribe();
    p.recordTurnEnd('test:turn', DAY2);
    expect(seen).toHaveLength(2); // no further notifications after unsubscribe
  });

  it('persists and reloads state (survives restarts)', () => {
    const p1 = new ProgressionStore(statePath);
    p1.recordTurnEnd('test:turn', DAY1);
    const p2 = new ProgressionStore(statePath);
    const s = p2.getSnapshot();
    expect(s.xp).toBeGreaterThanOrEqual(XP_TURN_COMPLETED);
    expect(s.streakCurrent).toBe(1);
  });
});
