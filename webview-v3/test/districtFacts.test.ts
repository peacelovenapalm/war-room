/**
 * districtFacts tests (Phase 5 Lane C, T7/D-35 districts) — pure mapping
 * logic only (progress -> floors/glyph/labels + the unknown-state
 * sentinel); fetchDistricts' network path is exercised via a stubbed
 * global fetch.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type DistrictProject,
  districtStatusGlyph,
  fetchDistricts,
  formatDistrictActivity,
  formatDistrictPhase,
  formatDistrictProgress,
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
