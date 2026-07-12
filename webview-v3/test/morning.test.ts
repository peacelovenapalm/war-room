import { describe, expect, it } from 'vitest';

import { daysStale, isMorningSourceStale, todayDateString } from '../src/state/morning';

const NOW = new Date('2026-07-12T09:00:00').getTime();

describe('todayDateString', () => {
  it('formats YYYY-MM-DD in local time, zero-padded', () => {
    expect(todayDateString(NOW)).toBe('2026-07-12');
  });
});

describe('daysStale', () => {
  it('returns 0 for a source dated today', () => {
    expect(daysStale('2026-07-12', NOW)).toBe(0);
  });

  it('returns a positive day count for an older source', () => {
    expect(daysStale('2026-07-10', NOW)).toBe(2);
  });

  it('never throws on a malformed date string', () => {
    expect(daysStale('not-a-date', NOW)).toBeNull();
    expect(daysStale('', NOW)).toBeNull();
  });
});

describe('isMorningSourceStale (colorblind rule: shape+word, checked separately in the panel)', () => {
  it('is false for a source dated today', () => {
    expect(isMorningSourceStale('2026-07-12', NOW)).toBe(false);
  });

  it('is true for a source dated in the past', () => {
    expect(isMorningSourceStale('2026-07-11', NOW)).toBe(true);
    expect(isMorningSourceStale('2026-07-10', NOW)).toBe(true);
  });

  it('is false (never stale) for an unparseable date rather than throwing', () => {
    expect(isMorningSourceStale('garbage', NOW)).toBe(false);
  });
});
