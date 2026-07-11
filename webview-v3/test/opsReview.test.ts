import { describe, expect, it } from 'vitest';

import { SEVERITY_GLYPHS } from '../src/state/opsReview';

describe('SEVERITY_GLYPHS (colorblind hard rule)', () => {
  it('has a distinct glyph AND word for every severity — never color-only', () => {
    const severities: Array<keyof typeof SEVERITY_GLYPHS> = ['info', 'warn', 'alert'];
    const glyphs = new Set<string>();
    const words = new Set<string>();
    for (const severity of severities) {
      const entry = SEVERITY_GLYPHS[severity];
      expect(entry.glyph.length).toBeGreaterThan(0);
      expect(entry.word.length).toBeGreaterThan(0);
      glyphs.add(entry.glyph);
      words.add(entry.word);
    }
    expect(glyphs.size).toBe(severities.length);
    expect(words.size).toBe(severities.length);
  });

  it("alert renders as the loudest glyph (✗), matching the rest of the app's failure convention", () => {
    expect(SEVERITY_GLYPHS.alert.glyph).toBe('✗');
    expect(SEVERITY_GLYPHS.warn.glyph).toBe('⚠');
  });
});
