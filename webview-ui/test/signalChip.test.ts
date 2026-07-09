/**
 * SignalChip disjointness enforcement (GAME-DESIGN.md §6.1) — the
 * MECHANICAL guard, not a lint rule. REAL_GLYPHS is derived from crisis.ts
 * + dispatch.ts (never hand-typed); SIM_GLYPHS is core/'s single source of
 * truth for the world-event table (worldEventStore.ts sources its own
 * glyphs from the same constant, so this test's pool always matches what
 * the server actually rolls). This suite MUST fail the build if either
 * pool grows a collision, including glyphs added after this milestone.
 */

import { describe, expect, it } from 'vitest';

import { SIM_GLYPHS } from '../../core/src/worldEventGlyphs.js';
import { REAL_GLYPHS } from '../src/office/realGlyphs.js';

describe('SignalChip real/SIM glyph disjointness (GAME-DESIGN §6.1)', () => {
  it('REAL_GLYPHS and SIM_GLYPHS share no glyph', () => {
    const collisions = [...SIM_GLYPHS].filter((g) => REAL_GLYPHS.has(g));
    expect(collisions, `colliding glyphs: ${collisions.join(', ')}`).toEqual([]);
  });

  it('REAL_GLYPHS is non-empty and mechanically derived (sanity)', () => {
    // Sanity floor, not a hand-typed enumeration: crisis.ts contributes 3
    // stage glyphs + 1 debris glyph, dispatch.ts contributes 5 status
    // glyphs -- 9 total, deduplicated.
    expect(REAL_GLYPHS.size).toBeGreaterThanOrEqual(9);
  });

  it('SIM_GLYPHS is non-empty', () => {
    expect(SIM_GLYPHS.size).toBeGreaterThan(0);
  });
});
