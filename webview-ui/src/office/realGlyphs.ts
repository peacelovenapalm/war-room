/**
 * The real glyph set (GAME-DESIGN.md §6.1) — mechanically derived from
 * crisis.ts's CRISIS_STAGE_SPECS + DEBRIS_GLYPH and dispatch.ts's
 * DISPATCH_STATUS_CHIPS, unioned. Never hand-typed: importing the real
 * source-of-truth tables means a future glyph added to either file is
 * automatically part of the real set, and signalChip.test.ts's disjointness
 * assertion catches a SIM-pool collision the moment it's introduced.
 */

import { DISPATCH_STATUS_CHIPS } from '../dispatch.js';
import { CRISIS_STAGE_SPECS, DEBRIS_GLYPH } from './crisis.js';

export const REAL_GLYPHS: ReadonlySet<string> = new Set([
  ...Object.values(CRISIS_STAGE_SPECS).map((spec) => spec.glyph),
  DEBRIS_GLYPH,
  ...Object.values(DISPATCH_STATUS_CHIPS).map((spec) => spec.glyph),
]);
