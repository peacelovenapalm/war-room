/**
 * Unit tests for morningPush.ts (V6-1 push scheduler, V6-2 NEEDS-YOU
 * count, V6-3 morning-degraded escalation). notifyDigest/notifyBigMomentFn
 * are injected (never hits the real Bark URL); morningStreakStore is the
 * real process-wide singleton -- reset via clearCacheForTests() so streak
 * assertions aren't cross-contaminated by test order.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import {
  buildMorningPushMessage,
  localHourAndDate,
  morningDeepLink,
  MorningPushStateStore,
  resetMorningPushStateForTests,
  resolveMorningPushHour,
  resolveMorningTimeZone,
  runMorningPushTick,
} from '../src/morningPush.js';
import { MorningStreakStore, morningStreakStore } from '../src/morningStreakStore.js';
import type { MorningSurface } from '../src/morningSurface.js';
import { clearMorningSurfaceCache } from '../src/morningSurface.js';

beforeEach(() => {
  resetMorningPushStateForTests();
  clearMorningSurfaceCache();
  morningStreakStore.clearCacheForTests();
});

afterEach(() => {
  resetMorningPushStateForTests();
  clearMorningSurfaceCache();
  morningStreakStore.clearCacheForTests();
});

describe('resolveMorningTimeZone', () => {
  it('defaults to America/Denver', () => {
    expect(resolveMorningTimeZone({})).toBe('America/Denver');
  });

  it('accepts a valid override', () => {
    expect(resolveMorningTimeZone({ WAR_ROOM_MORNING_TZ: 'UTC' })).toBe('UTC');
  });

  it('falls back to UTC on an invalid zone, never throws', () => {
    expect(resolveMorningTimeZone({ WAR_ROOM_MORNING_TZ: 'Not/AZone' })).toBe('UTC');
  });
});

describe('resolveMorningPushHour', () => {
  it('defaults to 6', () => {
    expect(resolveMorningPushHour({})).toBe(6);
  });

  it('accepts a valid override', () => {
    expect(resolveMorningPushHour({ WAR_ROOM_MORNING_PUSH_HOUR: '7' })).toBe(7);
  });

  it('falls back to default on an out-of-range or non-numeric value', () => {
    expect(resolveMorningPushHour({ WAR_ROOM_MORNING_PUSH_HOUR: '99' })).toBe(6);
    expect(resolveMorningPushHour({ WAR_ROOM_MORNING_PUSH_HOUR: 'nope' })).toBe(6);
  });
});

describe('localHourAndDate', () => {
  it('computes the correct local hour/date for a known UTC instant in America/Denver (MDT, UTC-6)', () => {
    // 2026-07-13T12:00:00Z -> 06:00 America/Denver (July = daylight time, UTC-6)
    const { hour, date } = localHourAndDate(Date.parse('2026-07-13T12:00:00Z'), 'America/Denver');
    expect(hour).toBe(6);
    expect(date).toBe('2026-07-13');
  });

  it('computes UTC directly when timeZone is UTC', () => {
    const { hour, date } = localHourAndDate(Date.parse('2026-07-13T06:00:00Z'), 'UTC');
    expect(hour).toBe(6);
    expect(date).toBe('2026-07-13');
  });
});

describe('morningDeepLink', () => {
  it('appends ?open=morning to a bare base URL', () => {
    expect(morningDeepLink('https://nexus.example:8484/')).toBe(
      'https://nexus.example:8484/?open=morning',
    );
  });

  it('appends &open=morning when the base already has a query string', () => {
    expect(morningDeepLink('https://nexus.example:8484/?x=1')).toBe(
      'https://nexus.example:8484/?x=1&open=morning',
    );
  });
});

function makeSurface(overrides: Partial<MorningSurface> = {}): MorningSurface {
  return {
    generatedAt: '2026-07-13T06:00:00.000Z',
    morningJson: {
      available: true,
      stale: false,
      dataAgeSeconds: 60,
      date: '2026-07-13',
      top3: [],
      flags: null,
      prs: { count: 0, list: [] },
    },
    board: {
      dataAgeSeconds: 0,
      needsInput: { count: 0, names: [] },
      heldBudget: { count: 0, jobs: [] },
    },
    overnight: {
      dataAgeSeconds: 0,
      windowStart: '2026-07-12T18:00:00.000Z',
      windowEnd: '2026-07-13T06:00:00.000Z',
      receiptCount: 0,
      receipts: [],
    },
    needsYouCount: 0,
    degraded: false,
    degradedReasons: [],
    streak: {
      count: 3,
      lastRecordedDate: '2026-07-13',
      lastBreachReason: null,
      lastBreachAt: null,
    },
    memory: {
      graphAnswered: 0,
      rederived: 0,
      surfacesOpenedPerMorning: 0,
      morningDate: '2026-07-13',
      persistence: 'process',
      writePathEnabled: false,
      writeMode: 'staged',
      cleanDayCount: 0,
      promotionEligible: false,
    },
    ...overrides,
  };
}

describe('buildMorningPushMessage', () => {
  it('leads with the NEEDS YOU count (lock-screen truncation survives)', () => {
    const msg = buildMorningPushMessage(makeSurface({ needsYouCount: 3 }), undefined);
    expect(msg.startsWith('NEEDS YOU: 3')).toBe(true);
  });

  it('renders "all calm" when the count is zero and nothing is degraded', () => {
    const msg = buildMorningPushMessage(makeSurface({ needsYouCount: 0 }), undefined);
    expect(msg).toContain('all calm');
  });

  it('never claims "all calm" with open PRs pending (panel isAllCalm parity)', () => {
    const surface = makeSurface({ needsYouCount: 0 });
    surface.morningJson.prs = {
      count: 2,
      list: [
        { number: 1, title: 't1', branch: 'b1' },
        { number: 2, title: 't2', branch: 'b2' },
      ],
    };
    const msg = buildMorningPushMessage(surface, undefined);
    expect(msg).not.toContain('all calm');
    expect(msg).toContain('2 PRs');
  });

  it('never claims "all calm" with held-budget jobs pending (panel isAllCalm parity)', () => {
    const surface = makeSurface({ needsYouCount: 0 });
    surface.board.heldBudget = {
      count: 1,
      jobs: [{ machine: 'MACBOOK', promptPreview: 'held' }],
    };
    const msg = buildMorningPushMessage(surface, undefined);
    expect(msg).not.toContain('all calm');
    expect(msg).toContain('1 held job');
  });

  it('names up to 3 agents and truncates the rest honestly', () => {
    const surface = makeSurface({
      needsYouCount: 4,
      board: {
        dataAgeSeconds: 0,
        needsInput: { count: 4, names: ['a', 'b', 'c', 'd'] },
        heldBudget: { count: 0, jobs: [] },
      },
    });
    const msg = buildMorningPushMessage(surface, undefined);
    expect(msg).toContain('a, b, c');
    expect(msg).toContain('+1 more');
  });

  it('appends the degraded reason and deep link', () => {
    const surface = makeSurface({ degraded: true, degradedReasons: ['morning.json unavailable'] });
    const msg = buildMorningPushMessage(surface, 'https://board.example/');
    expect(msg).toContain('⊘ degraded: morning.json unavailable');
    expect(msg).toContain('https://board.example/?open=morning');
  });
});

describe('runMorningPushTick', () => {
  it('does nothing outside the configured push hour', () => {
    const store = new AgentStateStore();
    const notifyDigest = vi.fn();
    const result = runMorningPushTick(store, Date.parse('2026-07-13T10:00:00Z'), {
      env: { WAR_ROOM_MORNING_TZ: 'UTC', WAR_ROOM_MORNING_PUSH_HOUR: '6' },
      notifyDigest,
    });
    expect(result).toBeNull();
    expect(notifyDigest).not.toHaveBeenCalled();
  });

  it('fires once at the configured local hour and is a no-op on a second tick the same day', () => {
    const store = new AgentStateStore();
    const notifyDigest = vi.fn();
    const notifyBigMomentFn = vi.fn();
    const env = { WAR_ROOM_MORNING_TZ: 'UTC', WAR_ROOM_MORNING_PUSH_HOUR: '6' };

    const first = runMorningPushTick(store, Date.parse('2026-07-13T06:00:30Z'), {
      env,
      notifyDigest,
      notifyBigMomentFn,
    });
    expect(first).not.toBeNull();
    expect(notifyDigest).toHaveBeenCalledTimes(1);
    expect((notifyDigest.mock.calls[0][0] as string).startsWith('NEEDS YOU:')).toBe(true);

    const second = runMorningPushTick(store, Date.parse('2026-07-13T06:05:00Z'), {
      env,
      notifyDigest,
      notifyBigMomentFn,
    });
    expect(second).toBeNull();
    expect(notifyDigest).toHaveBeenCalledTimes(1);
  });

  it('does not double-send when the server restarts during the push hour (persisted dedupe)', () => {
    const tmpPath = path.join(
      os.tmpdir(),
      `morning-push-test-${String(process.pid)}-${String(Date.now())}.json`,
    );
    try {
      const store = new AgentStateStore();
      const notifyDigest = vi.fn();
      const env = { WAR_ROOM_MORNING_TZ: 'UTC', WAR_ROOM_MORNING_PUSH_HOUR: '6' };

      const beforeRestart = new MorningPushStateStore(tmpPath);
      const first = runMorningPushTick(store, Date.parse('2026-07-13T06:00:30Z'), {
        env,
        notifyDigest,
        pushStateStore: beforeRestart,
      });
      expect(first).not.toBeNull();
      expect(notifyDigest).toHaveBeenCalledTimes(1);

      // Restart = a brand-new store instance reading the same sidecar file.
      const afterRestart = new MorningPushStateStore(tmpPath);
      const second = runMorningPushTick(store, Date.parse('2026-07-13T06:20:00Z'), {
        env,
        notifyDigest,
        pushStateStore: afterRestart,
      });
      expect(second).toBeNull();
      expect(notifyDigest).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(tmpPath, { force: true });
    }
  });

  it('records a streak breach when the entire push window was missed, exactly once', () => {
    const store = new AgentStateStore();
    const notifyDigest = vi.fn();
    const env = { WAR_ROOM_MORNING_TZ: 'UTC', WAR_ROOM_MORNING_PUSH_HOUR: '6' };
    const pushStateStore = new MorningPushStateStore(
      path.join(os.tmpdir(), `morning-push-missed-${String(Date.now())}.json`),
    );
    // Temp-path streak store too: the singleton's default path READS the
    // real ~/.pixel-agents/morning-streak.json when one exists (the
    // VITEST persistence guard covers writes only).
    const streakStore = new MorningStreakStore(
      path.join(os.tmpdir(), `morning-streak-missed-${String(Date.now())}.json`),
    );

    // Parallel-run already started: yesterday was recorded clean.
    streakStore.recordOutcome(true, '2026-07-12', undefined, Date.parse('2026-07-12T06:00:00Z'));
    expect(streakStore.getSnapshot().count).toBeGreaterThan(0);

    // First tick AFTER the window (server was down 06:00-06:59): breach.
    const result = runMorningPushTick(store, Date.parse('2026-07-13T07:12:00Z'), {
      env,
      notifyDigest,
      pushStateStore,
      streakStore,
    });
    expect(result).toBeNull();
    expect(notifyDigest).not.toHaveBeenCalled();
    const snap = streakStore.getSnapshot();
    expect(snap.count).toBe(0);
    expect(snap.lastRecordedDate).toBe('2026-07-13');
    expect(snap.lastBreachReason).toContain('push-window-missed');

    // Later ticks the same day stay a no-op (recordOutcome idempotent).
    runMorningPushTick(store, Date.parse('2026-07-13T08:00:00Z'), {
      env,
      notifyDigest,
      pushStateStore,
      streakStore,
    });
    expect(streakStore.getSnapshot().count).toBe(0);
    expect(notifyDigest).not.toHaveBeenCalled();
  });

  it('does not breach a fresh install with no streak history (missed-window guard)', () => {
    const store = new AgentStateStore();
    const notifyDigest = vi.fn();
    const pushStateStore = new MorningPushStateStore(
      path.join(os.tmpdir(), `morning-push-fresh-${String(Date.now())}.json`),
    );
    const streakStore = new MorningStreakStore(
      path.join(os.tmpdir(), `morning-streak-fresh-${String(Date.now())}.json`),
    );

    expect(streakStore.getSnapshot().lastRecordedDate).toBeNull();
    runMorningPushTick(store, Date.parse('2026-07-13T09:00:00Z'), {
      env: { WAR_ROOM_MORNING_TZ: 'UTC', WAR_ROOM_MORNING_PUSH_HOUR: '6' },
      notifyDigest,
      pushStateStore,
      streakStore,
    });
    const snap = streakStore.getSnapshot();
    expect(snap.lastRecordedDate).toBeNull();
    expect(snap.lastBreachReason).toBeNull();
  });

  it('escalates via morning-degraded when the surface cannot compose honestly', () => {
    const store = new AgentStateStore();
    const notifyDigest = vi.fn();
    const notifyBigMomentFn = vi.fn();
    // No WAR_ROOM_MORNING_JSON configured -> morningJson unavailable -> degraded.
    runMorningPushTick(store, Date.parse('2026-07-13T06:00:00Z'), {
      env: { WAR_ROOM_MORNING_TZ: 'UTC', WAR_ROOM_MORNING_PUSH_HOUR: '6' },
      notifyDigest,
      notifyBigMomentFn,
    });
    expect(notifyBigMomentFn).toHaveBeenCalledTimes(1);
    expect(notifyBigMomentFn.mock.calls[0][0]).toBe('morning-degraded');
  });
});
