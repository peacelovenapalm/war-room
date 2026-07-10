/**
 * Unit tests for shift-report push delivery (server-side, day-rollover
 * feature). Covers: env parsing / feature-off default, text formatting,
 * per-URL retry-once-then-give-up, and fan-out tolerance (one URL failing
 * never affects another, never throws back to the caller).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatShiftPushText,
  getPushUrls,
  maskUrlForLog,
  pushShiftReport,
  pushToUrl,
} from '../src/shiftPush.js';
import type { ShiftReport } from '../src/shiftStats.js';

function makeReport(overrides: Partial<ShiftReport> = {}): ShiftReport {
  return {
    date: '2026-07-07',
    turnsCompleted: 3,
    tokensIn: 1000,
    tokensOut: 500,
    crisesIgnited: 2,
    crisesResolved: 2,
    crisesOpen: 0,
    meanTimeToUnblockMs: 60_000,
    longestBlockedMs: 90_000,
    todosClosed: 4,
    gatesAdvanced: 1,
    outputTokensPerTurn: 167,
    efficiency: 'LEAN',
    reworkDismissed: 0,
    generatedAt: '2026-07-07T23:59:59.000Z',
    ...overrides,
  };
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('getPushUrls', () => {
  it('is empty when unset (feature off, zero noise)', () => {
    expect(getPushUrls({})).toEqual([]);
  });

  it('splits and trims a comma-separated list', () => {
    expect(
      getPushUrls({ WAR_ROOM_PUSH_URLS: 'https://a.example/x, https://b.example/y ,' }),
    ).toEqual(['https://a.example/x', 'https://b.example/y']);
  });
});

describe('maskUrlForLog', () => {
  it('never prints path/query (may carry a device token)', () => {
    expect(maskUrlForLog('https://api.day.app/SECRET_KEY/push?foo=bar')).toBe(
      'https://api.day.app/…',
    );
  });

  it('tolerates garbage input', () => {
    expect(maskUrlForLog('not-a-url')).toBe('<invalid-url>');
  });
});

describe('formatShiftPushText', () => {
  it('is compact plain text carrying the WORD grade (never color)', () => {
    const text = formatShiftPushText(makeReport());
    expect(text).toContain('SHIFT REPORT — 2026-07-07');
    expect(text).toContain('Turns: 3 completed');
    expect(text).toContain('Efficiency: LEAN');
    expect(text).not.toMatch(/#[0-9a-f]{6}/i); // no color codes
  });

  it('never implies more spend is better', () => {
    const heavy = formatShiftPushText(
      makeReport({ efficiency: 'HEAVY', outputTokensPerTurn: 9000 }),
    );
    expect(heavy).toContain('Efficiency: HEAVY');
    expect(heavy).not.toMatch(/reward|bonus|great job.*spend/i);
  });
});

describe('pushToUrl', () => {
  it('succeeds on the first attempt', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;
    const result = await pushToUrl('https://x.example/hook', 'body', 10);
    expect(result.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries exactly once then gives up (no retry-storm)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    const result = await pushToUrl('https://x.example/hook', 'body', 10);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
    expect(global.fetch).toHaveBeenCalledTimes(2); // 1 try + 1 retry, never more
  });

  it('treats a non-2xx response as a failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    const result = await pushToUrl('https://x.example/hook', 'body', 10);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/500/);
  });
});

describe('pushShiftReport (fan-out)', () => {
  it('does nothing when no URLs are configured (feature off)', () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    pushShiftReport(makeReport(), { urls: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('tolerates one URL failing without affecting another, and never throws', async () => {
    const calls: string[] = [];
    global.fetch = vi.fn((url: string) => {
      calls.push(url);
      if (url.includes('bad')) return Promise.reject(new Error('down'));
      return Promise.resolve({ ok: true, status: 200 });
    }) as unknown as typeof fetch;

    const log = vi.fn();
    expect(() =>
      pushShiftReport(makeReport(), {
        urls: ['https://good.example/a', 'https://bad.example/b'],
        timeoutMs: 10,
        log,
      }),
    ).not.toThrow();

    // Let the fire-and-forget promises settle.
    await new Promise((r) => setTimeout(r, 50));

    expect(calls.some((u) => u.includes('good'))).toBe(true);
    expect(calls.some((u) => u.includes('bad'))).toBe(true);
    // Failure logged with a ⚠ line, success logged separately — good URL
    // unaffected by bad URL's failure.
    const logged = log.mock.calls.map((c) => String(c[0]));
    expect(logged.some((l) => l.includes('⚠') && l.includes('good') === false)).toBe(true);
    expect(logged.some((l) => l.startsWith('[Pixel Agents] shift push delivered'))).toBe(true);
  });

  it('is fire-and-forget — returns before the network call resolves', () => {
    let resolved = false;
    global.fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolved = true;
            resolve({ ok: true, status: 200 });
          }, 20);
        }),
    ) as unknown as typeof fetch;

    pushShiftReport(makeReport(), { urls: ['https://x.example/a'] });
    // Synchronous return — the fetch above hasn't resolved yet.
    expect(resolved).toBe(false);
  });
});
