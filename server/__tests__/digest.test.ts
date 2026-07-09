/**
 * Unit tests for the digest assembler (G4, GAME-DESIGN.md §6.5).
 *
 * Covers: deterministic output for fixed inputs, and the narrator seam
 * (a custom narrator fully replaces the template output — the future LLM
 * slot-in point).
 */

import { describe, expect, it } from 'vitest';

import { renderDigest, templateNarrator } from '../src/digest.js';

describe('renderDigest / templateNarrator', () => {
  const summary = {
    cashDelta: 42,
    reputationDelta: -3,
    topEvents: [
      { glyph: '✧', summary: 'A couple of people made a coffee run.' },
      { glyph: '▣', summary: 'Surprise inspection — the office passed with flying colors.' },
    ],
    warnings: ['Office grime is above 70 — consider a clean-up.'],
  };

  it('is deterministic for fixed inputs', () => {
    expect(renderDigest(summary)).toBe(renderDigest(summary));
  });

  it('renders signed Cash/Rep deltas, event lines, and warnings', () => {
    const text = renderDigest(summary);
    expect(text).toContain('+42 Cash');
    expect(text).toContain('-3 Rep');
    expect(text).toContain('✧ A couple of people made a coffee run.');
    expect(text).toContain('⚠ Office grime is above 70 — consider a clean-up.');
  });

  it('caps rendered events at 5 even if more are passed', () => {
    const many = {
      ...summary,
      topEvents: Array.from({ length: 8 }, (_, i) => ({ glyph: '✧', summary: `event ${i}` })),
    };
    const text = renderDigest(many);
    for (let i = 0; i < 5; i++) expect(text).toContain(`event ${i}`);
    for (let i = 5; i < 8; i++) expect(text).not.toContain(`event ${i}`);
  });

  it('omits the events/warnings sections when empty', () => {
    const text = renderDigest({ cashDelta: 0, reputationDelta: 0, topEvents: [], warnings: [] });
    expect(text).not.toContain('Around the office');
    expect(text).not.toContain('⚠');
  });

  it('the narrator parameter is the LLM seam — a custom narrator fully replaces the output', () => {
    const custom = renderDigest(summary, () => 'a totally different story');
    expect(custom).toBe('a totally different story');
  });

  it('templateNarrator is directly usable as the default narrator', () => {
    expect(renderDigest(summary)).toBe(templateNarrator(summary));
  });
});
