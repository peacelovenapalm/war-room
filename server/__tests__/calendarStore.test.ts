/**
 * Unit tests for calendarStore.ts (G5, BUILD-PLAN §G5 task 3) — mirrors
 * webview-ui/test/dayNight.test.ts's cases for the season/holiday-week
 * math both sides independently implement.
 */

import { describe, expect, it } from 'vitest';

import { getSeason, isHolidayWeek } from '../src/calendarStore.js';

function at(y: number, m: number, d: number, h: number): number {
  return new Date(y, m, d, h).getTime();
}

describe('calendarStore', () => {
  it('getSeason covers all four meteorological quarters', () => {
    expect(getSeason(at(2026, 0, 15, 12))).toBe('winter');
    expect(getSeason(at(2026, 3, 15, 12))).toBe('spring');
    expect(getSeason(at(2026, 6, 15, 12))).toBe('summer');
    expect(getSeason(at(2026, 9, 15, 12))).toBe('autumn');
    expect(getSeason(at(2026, 11, 15, 12))).toBe('winter');
  });

  it('getSeason defaults to Date.now() when no timestamp is given', () => {
    expect(['winter', 'spring', 'summer', 'autumn']).toContain(getSeason());
  });

  it('isHolidayWeek is true only Dec 20-31', () => {
    expect(isHolidayWeek(at(2026, 11, 20, 12))).toBe(true);
    expect(isHolidayWeek(at(2026, 11, 31, 12))).toBe(true);
    expect(isHolidayWeek(at(2026, 11, 19, 12))).toBe(false);
    expect(isHolidayWeek(at(2027, 0, 1, 12))).toBe(false);
  });
});
