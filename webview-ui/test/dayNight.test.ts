import { describe, expect, it } from 'vitest';

import { getDayPhase, getSeason, isHolidayWeek } from '../src/office/dayNight.js';

function at(y: number, m: number, d: number, h: number): number {
  return new Date(y, m, d, h).getTime();
}

describe('dayNight', () => {
  it('getDayPhase covers all four boundaries', () => {
    expect(getDayPhase(at(2026, 6, 1, 6))).toBe('dawn');
    expect(getDayPhase(at(2026, 6, 1, 12))).toBe('day');
    expect(getDayPhase(at(2026, 6, 1, 18))).toBe('dusk');
    expect(getDayPhase(at(2026, 6, 1, 23))).toBe('night');
    expect(getDayPhase(at(2026, 6, 1, 2))).toBe('night');
  });

  it('getSeason covers all four meteorological quarters', () => {
    expect(getSeason(at(2026, 0, 15, 12))).toBe('winter');
    expect(getSeason(at(2026, 3, 15, 12))).toBe('spring');
    expect(getSeason(at(2026, 6, 15, 12))).toBe('summer');
    expect(getSeason(at(2026, 9, 15, 12))).toBe('autumn');
    expect(getSeason(at(2026, 11, 15, 12))).toBe('winter');
  });

  it('isHolidayWeek is true only Dec 20-31', () => {
    expect(isHolidayWeek(at(2026, 11, 20, 12))).toBe(true);
    expect(isHolidayWeek(at(2026, 11, 31, 12))).toBe(true);
    expect(isHolidayWeek(at(2026, 11, 19, 12))).toBe(false);
    expect(isHolidayWeek(at(2027, 0, 1, 12))).toBe(false);
  });
});
