import { describe, expect, it } from 'vitest';

import {
  computeBadges,
  isKnownPersonaBadge,
  MIN_SAMPLES,
  PERSONA_BADGES,
  PersonaBadge,
} from '../src/office/personaBadges.js';

describe('computeBadges (mirrors server/src/employeeStore.ts exactly)', () => {
  it('ROOKIE suppresses everything below MIN_SAMPLES', () => {
    const badges = computeBadges(
      { speed: 100, accuracy: 100, nightOwl: 100, tokenEfficiency: 100 },
      MIN_SAMPLES - 1,
    );
    expect(badges).toEqual([PersonaBadge.ROOKIE]);
  });

  it('assigns FAST/METICULOUS/NIGHT_OWL/EFFICIENT at threshold', () => {
    const badges = computeBadges(
      { speed: 70, accuracy: 85, nightOwl: 40, tokenEfficiency: 70 },
      MIN_SAMPLES,
    );
    expect(badges).toContain(PersonaBadge.FAST);
    expect(badges).toContain(PersonaBadge.METICULOUS);
    expect(badges).toContain(PersonaBadge.NIGHT_OWL);
    expect(badges).toContain(PersonaBadge.EFFICIENT);
    expect(badges).not.toContain(PersonaBadge.ROOKIE);
  });

  it('assigns SLOPPY/BURNS_TOKENS below their thresholds', () => {
    const badges = computeBadges(
      { speed: 0, accuracy: 49, nightOwl: 0, tokenEfficiency: 29 },
      MIN_SAMPLES,
    );
    expect(badges).toContain(PersonaBadge.SLOPPY);
    expect(badges).toContain(PersonaBadge.BURNS_TOKENS);
  });
});

describe('PERSONA_BADGES', () => {
  it('every badge has a distinct glyph (shape is the primary signal, not color)', () => {
    const glyphs = Object.values(PERSONA_BADGES).map((spec) => spec.glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it('isKnownPersonaBadge accepts every real key and rejects garbage', () => {
    for (const key of Object.values(PersonaBadge)) {
      expect(isKnownPersonaBadge(key)).toBe(true);
    }
    expect(isKnownPersonaBadge('NOT_A_REAL_BADGE')).toBe(false);
  });
});
