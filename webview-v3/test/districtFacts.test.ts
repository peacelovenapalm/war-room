/**
 * districtFacts tests (Phase 5 Lane C, T7/D-35 districts) — pure mapping
 * logic only (progress -> floors/glyph/labels + the unknown-state
 * sentinel); fetchDistricts' network path is exercised via a stubbed
 * global fetch.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DISTRICT_STALE_MS,
  type DistrictProject,
  districtStatusGlyph,
  fetchDistricts,
  formatDistrictActivity,
  formatDistrictAge,
  formatDistrictPhase,
  formatDistrictProgress,
  isDistrictStale,
  isDistrictUnknown,
  MAX_FLOORS,
  MIN_FLOORS,
  progressToFloors,
} from '../src/net/districtFacts';

function project(overrides: Partial<DistrictProject> = {}): DistrictProject {
  return {
    key: 'war-room',
    label: 'WAR ROOM',
    phase: 'RUN COMPLETE',
    progress: 0.5,
    lastActivity: '2026-07-12T07:15:00Z',
    source: 'file:/some/path/STATE.md',
    ...overrides,
  };
}

describe('progressToFloors', () => {
  it('null (unknown) -> the minimum floor count', () => {
    expect(progressToFloors(null)).toBe(MIN_FLOORS);
  });

  it('0 -> the minimum floor count', () => {
    expect(progressToFloors(0)).toBe(MIN_FLOORS);
  });

  it('1 -> the maximum floor count', () => {
    expect(progressToFloors(1)).toBe(MAX_FLOORS);
  });

  it('0.5 -> a middle floor count, monotonic with progress', () => {
    const half = progressToFloors(0.5);
    expect(half).toBeGreaterThan(MIN_FLOORS);
    expect(half).toBeLessThan(MAX_FLOORS);
    expect(progressToFloors(0.9)).toBeGreaterThanOrEqual(half);
  });

  it('clamps out-of-range values into [MIN_FLOORS, MAX_FLOORS]', () => {
    expect(progressToFloors(-5)).toBe(MIN_FLOORS);
    expect(progressToFloors(5)).toBe(MAX_FLOORS);
  });
});

describe('districtStatusGlyph', () => {
  it('null -> "?" (unknown)', () => {
    expect(districtStatusGlyph(null)).toBe('?');
  });

  it('0 -> "○" (not started)', () => {
    expect(districtStatusGlyph(0)).toBe('○');
  });

  it('1 -> "✓" (complete)', () => {
    expect(districtStatusGlyph(1)).toBe('✓');
  });

  it('in between -> "◷" (in progress)', () => {
    expect(districtStatusGlyph(0.4)).toBe('◷');
  });
});

describe('formatDistrictProgress', () => {
  it('null -> "UNKNOWN", never a fabricated percentage', () => {
    expect(formatDistrictProgress(null)).toBe('UNKNOWN');
  });

  it('formats a fraction as a rounded percentage', () => {
    expect(formatDistrictProgress(0.44)).toBe('44%');
  });

  it('clamps out-of-range fractions before formatting', () => {
    expect(formatDistrictProgress(1.5)).toBe('100%');
    expect(formatDistrictProgress(-0.5)).toBe('0%');
  });
});

describe('formatDistrictPhase / formatDistrictActivity', () => {
  it('null phase -> honest placeholder, not a blank line', () => {
    expect(formatDistrictPhase(null)).toBe('no phase data');
    expect(formatDistrictPhase('Sale Readiness')).toBe('Sale Readiness');
  });

  it('null lastActivity -> honest placeholder', () => {
    expect(formatDistrictActivity(null)).toBe('no recorded activity');
    expect(formatDistrictActivity('2026-07-08')).toBe('2026-07-08');
  });
});

describe('isDistrictStale (minor finding: a 2-month-old timestamp read as fresh)', () => {
  const NOW = Date.parse('2026-07-13T00:00:00Z');

  it('flags a timestamp older than the stale window', () => {
    const old = new Date(NOW - DISTRICT_STALE_MS - 1000).toISOString();
    expect(isDistrictStale(old, NOW)).toBe(true);
  });

  it('does not flag a timestamp within the stale window', () => {
    const recent = new Date(NOW - 1000).toISOString();
    expect(isDistrictStale(recent, NOW)).toBe(false);
  });

  it('never flags an absent or unparseable timestamp as stale — that is the separate "no recorded activity" case', () => {
    expect(isDistrictStale(null, NOW)).toBe(false);
    expect(isDistrictStale('not-a-date', NOW)).toBe(false);
  });
});

describe('formatDistrictAge', () => {
  const NOW = Date.parse('2026-07-13T00:00:00Z');

  it('formats sub-day ages in hours', () => {
    const threeHoursAgo = new Date(NOW - 3 * 60 * 60 * 1000).toISOString();
    expect(formatDistrictAge(threeHoursAgo, NOW)).toBe('3h ago');
  });

  it('formats multi-day ages in days', () => {
    const sixteenDaysAgo = new Date(NOW - 16 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatDistrictAge(sixteenDaysAgo, NOW)).toBe('16d ago');
  });

  it('formats 60+ day ages in months', () => {
    const twoMonthsAgo = new Date(NOW - 61 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatDistrictAge(twoMonthsAgo, NOW)).toBe('2mo ago');
  });

  it('is honest ("—") for missing or unparseable timestamps, never a fabricated age', () => {
    expect(formatDistrictAge(null, NOW)).toBe('—');
    expect(formatDistrictAge('garbage', NOW)).toBe('—');
  });
});

describe('isDistrictUnknown', () => {
  it('true only when source is the "unknown" sentinel', () => {
    expect(isDistrictUnknown(project({ source: 'unknown' }))).toBe(true);
    expect(isDistrictUnknown(project({ source: 'file:/x/STATE.md' }))).toBe(false);
  });
});

describe('fetchDistricts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses a successful JSON response', async () => {
    const snapshot = { projects: [project()] };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(snapshot) }),
    );
    await expect(fetchDistricts()).resolves.toEqual(snapshot);
  });

  it('a non-ok response -> null, never a throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(fetchDistricts()).resolves.toBeNull();
  });

  it('a network failure -> null, never a throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(fetchDistricts()).resolves.toBeNull();
  });
});
