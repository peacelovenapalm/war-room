/**
 * Tests for editorActions.ts's client-side validation helpers (G2,
 * GAME-DESIGN §5.7). The async server-round-trip actions
 * (commitRoomTag/commitSell/commitExpandOffice/commitBuyFurniture) are
 * thin fetch wrappers exercised end-to-end by the server's
 * buildingRoutes.test.ts; this file covers the pure, synchronous
 * client-side pre-validation (`isValidRoomRect`) — instant UX feedback
 * only, never the trust boundary (the server re-validates authoritatively).
 */

import { describe, expect, it } from 'vitest';

import { isValidRoomRect } from '../src/office/editor/editorActions.js';
import type { OfficeLayout } from '../src/office/types.js';
import { TileType } from '../src/office/types.js';

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
