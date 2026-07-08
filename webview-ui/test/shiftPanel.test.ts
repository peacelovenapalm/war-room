/**
 * Unit tests for ShiftPanel's pure helpers (no component-rendering harness
 * exists in this workspace yet — vitest here runs with `environment: 'node'`
 * and no jsdom/testing-library, so these cover the testable logic directly:
 * token formatting, clock formatting, and the staleness-marker rule).
 */

import { describe, expect, it } from 'vitest';

import { compactTokens, formatClock, isShiftReportStale } from '../src/shiftReport.js';

describe('compactTokens', () => {
  it('formats small counts as-is', () => {
    expect(compactTokens(42)).toBe('42');
  });

  it('formats thousands with one decimal + k', () => {
    expect(compactTokens(12_345)).toBe('12.3k');
  });

  it('formats millions with one decimal + M', () => {
    expect(compactTokens(2_500_000)).toBe('2.5M');
  });
});

describe('formatClock', () => {
  it('zero-pads HH:MM in local time', () => {
    const ts = new Date(2026, 6, 7, 6, 5, 0).getTime();
    expect(formatClock(ts)).toBe('06:05');
  });
});

describe('isShiftReportStale (staleness-marker rule)', () => {
  it('is stale when a refresh fails AND a report is already on screen', () => {
    expect(isShiftReportStale(true, true)).toBe(true);
  });

  it('is NOT stale when there is no report yet (shows the unreachable banner instead)', () => {
    expect(isShiftReportStale(false, true)).toBe(false);
  });

  it('is NOT stale on a healthy refresh', () => {
    expect(isShiftReportStale(true, false)).toBe(false);
  });

  it('is NOT stale with no report and no error (initial load)', () => {
    expect(isShiftReportStale(false, false)).toBe(false);
  });
});
