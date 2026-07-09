/**
 * Tests for editorActions.ts's client-side validation helpers (G2,
 * GAME-DESIGN §5.7). The async server-round-trip actions
 * (commitRoomTag/commitSell/commitExpandOffice/commitBuyFurniture) are
 * thin fetch wrappers exercised end-to-end by the server's
 * buildingRoutes.test.ts; this file covers the pure, synchronous
 * client-side pre-validation (`isValidRoomRect`) — instant UX feedback
 * only, never the trust boundary (the server re-validates authoritatively).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isValidRoomRect, PRICED_FURNITURE_TYPES } from '../src/office/editor/editorActions.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function borderedLayout(cols = 20, rows = 11): OfficeLayout {
  const tiles: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push(
        r === 0 || r === rows - 1 || c === 0 || c === cols - 1 ? TileType.WALL : TileType.FLOOR_1,
      );
    }
  }
  return {
    version: 1,
    cols,
    rows,
    tiles: tiles as OfficeLayout['tiles'],
    furniture: [],
    rooms: [],
  };
}

describe('isValidRoomRect', () => {
  it('accepts a rectangle fully within owned interior floor', () => {
    const layout = borderedLayout();
    expect(isValidRoomRect(layout, 1, 1, 5, 4)).toBe(true);
  });

  it('rejects a rectangle overlapping the WALL border', () => {
    const layout = borderedLayout();
    expect(isValidRoomRect(layout, 0, 0, 4, 3)).toBe(false);
  });

  it('rejects an inverted or zero-size rectangle', () => {
    const layout = borderedLayout();
    expect(isValidRoomRect(layout, 5, 5, 5, 5)).toBe(false);
    expect(isValidRoomRect(layout, 5, 5, 3, 8)).toBe(false);
  });

  it('rejects a rectangle extending beyond the owned layout bounds', () => {
    const layout = borderedLayout();
    expect(isValidRoomRect(layout, 15, 1, 25, 5)).toBe(false);
  });

  it('rejects a rectangle overlapping VOID tiles', () => {
    const layout = borderedLayout();
    layout.tiles[3 * layout.cols + 3] = TileType.VOID;
    expect(isValidRoomRect(layout, 1, 1, 5, 5)).toBe(false);
  });
});

// KICKOFF v1.1 item F4: buffed furniture was placeable for free through the
// ordinary edit tool because PRICED_FURNITURE_TYPES-gated priced types
// never routed through commitBuyFurniture()/the paid API — only the free
// client-side placeFurniture()+saveLayout() path existed. This guards the
// fix's most likely regression: PRICED_FURNITURE_TYPES silently drifting
// out of sync with the server's authoritative FURNITURE_COST (the source
// of truth for which types actually cost Cash), which would let a newly
// priced type slip back through the free path.
describe('PRICED_FURNITURE_TYPES (F4 regression)', () => {
  it('matches server/src/economyConstants.ts FURNITURE_COST exactly', () => {
    const economyConstantsSrc = readFileSync(
      path.join(__dirname, '../../server/src/economyConstants.ts'),
      'utf-8',
    );
    const match = economyConstantsSrc.match(/FURNITURE_COST[^{]*\{([^}]*)\}/);
    expect(match).not.toBeNull();
    const serverKeys = [...(match?.[1].matchAll(/^\s*([A-Z0-9_]+):/gm) ?? [])].map((m) => m[1]);
    expect(serverKeys.length).toBeGreaterThan(0);
    expect([...PRICED_FURNITURE_TYPES].sort()).toEqual([...serverKeys].sort());
  });

  it('is non-empty and contains the known buffed items', () => {
    expect(PRICED_FURNITURE_TYPES.has('WHITEBOARD')).toBe(true);
    expect(PRICED_FURNITURE_TYPES.has('PC_FRONT_ON_1')).toBe(true);
    expect(PRICED_FURNITURE_TYPES.has('COFFEE_TABLE')).toBe(true);
  });
});
