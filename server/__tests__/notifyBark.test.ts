/**
 * Unit tests for the Bark push emitter (G4, GAME-DESIGN.md §6.5).
 *
 * Covers: unset WAR_ROOM_BARK_URL = zero fetch calls, the morning-digest
 * daily dedupe (a second call the same local day never pushes twice, a new
 * day allows another), and the runtime class filter on notifyBigMoment
 * (rejects anything outside BIG_MOMENT_CLASSES, even via a type-bypassing
 * cast — never per-turn/per-world-event noise).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BIG_MOMENT_CLASSES,
  type BigMomentClass,
  getBarkUrl,
  maskUrlForLog,
  notifyBigMoment,
  notifyMorningDigest,
  resetNotifyBarkStateForTests,
} from '../src/notifyBark.js';

const DAY1 = new Date(2026, 6, 7, 9, 0, 0).getTime();
const ONE_DAY_MS = 86_400_000;

beforeEach(() => {
  resetNotifyBarkStateForTests();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true }) as Response),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getBarkUrl', () => {
  it('is undefined when WAR_ROOM_BARK_URL is unset or blank', () => {
    expect(getBarkUrl({})).toBeUndefined();
    expect(getBarkUrl({ WAR_ROOM_BARK_URL: '' })).toBeUndefined();
    expect(getBarkUrl({ WAR_ROOM_BARK_URL: '   ' })).toBeUndefined();
  });

  it('returns the trimmed URL when set', () => {
    expect(getBarkUrl({ WAR_ROOM_BARK_URL: ' https://example.test/push ' })).toBe(
      'https://example.test/push',
    );
  });
});

describe('maskUrlForLog', () => {
  it('never includes the path/query (may carry a token)', () => {
    expect(maskUrlForLog('https://example.test/push?token=secret')).toBe('https://example.test/…');
  });
});

describe('feature-off posture: no URL configured', () => {
  it('notifyMorningDigest makes zero fetch calls when no url is provided', () => {
    notifyMorningDigest('hello', { now: DAY1 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('notifyBigMoment makes zero fetch calls when no url is provided', () => {
    notifyBigMoment('contract-completed', 'hello');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('notifyMorningDigest daily dedupe', () => {
  it('pushes once, then no-ops for a second call the same local day', () => {
    notifyMorningDigest('digest 1', { url: 'https://example.test/push', now: DAY1 });
    notifyMorningDigest('digest 2', { url: 'https://example.test/push', now: DAY1 + 1000 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh push on a new local day', () => {
    notifyMorningDigest('digest 1', { url: 'https://example.test/push', now: DAY1 });
    notifyMorningDigest('digest 2', { url: 'https://example.test/push', now: DAY1 + ONE_DAY_MS });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('notifyBigMoment class filter', () => {
  it('pushes for every legitimate BIG_MOMENT_CLASSES entry', () => {
    for (const kind of BIG_MOMENT_CLASSES) {
      notifyBigMoment(kind, `${kind} happened`, { url: 'https://example.test/push' });
    }
    expect(fetch).toHaveBeenCalledTimes(BIG_MOMENT_CLASSES.length);
  });

  it('rejects (silent no-op, never throws) a class outside the allowlist', () => {
    expect(() =>
      notifyBigMoment('per-turn' as BigMomentClass, 'should never push', {
        url: 'https://example.test/push',
      }),
    ).not.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});

// KICKOFF v1.1 item 7: the wrapper 422s on raw text/plain — every push must
// send JSON {task, status, message}. Assert the ACTUAL request shape, not
// just that fetch fired.
describe('Bark payload shape (KICKOFF v1.1 item 7)', () => {
  function lastRequestBody(): { task: string; status: string; message: string } {
    const mockFetch = fetch as unknown as { mock: { calls: unknown[][] } };
    const [, init] = mockFetch.mock.calls.at(-1) as [string, RequestInit];
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    return JSON.parse(init.body as string);
  }

  it('notifyMorningDigest sends task="War Room", status="info"', () => {
    notifyMorningDigest('good morning', { url: 'https://example.test/push', now: DAY1 });
    const body = lastRequestBody();
    expect(body).toEqual({ task: 'War Room', status: 'info', message: 'good morning' });
  });

  it('maps each BIG_MOMENT_CLASSES entry to a distinct, correct status', () => {
    const expected: Record<BigMomentClass, string> = {
      'contract-completed': 'info',
      'employee-quit': 'warning',
      'budget-paused': 'warning',
      'stop-all': 'warning',
      'chain-failed': 'failure',
    };
    for (const kind of BIG_MOMENT_CLASSES) {
      notifyBigMoment(kind, `${kind} happened`, { url: 'https://example.test/push' });
      const body = lastRequestBody();
      expect(body.status).toBe(expected[kind]);
      expect(body.task).toBe('War Room');
      expect(body.message).toBe(`${kind} happened`);
    }
  });
});
