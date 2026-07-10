import { describe, expect, it } from 'vitest';

import { depthCompare, sortByDepth } from '../src/engine/depthSort';

describe("painter's-algorithm depth sort", () => {
  it('paints far rows (small x+y) before near rows (large x+y)', () => {
    const near = { tileX: 5, tileY: 5 };
    const far = { tileX: 1, tileY: 1 };
    expect(depthCompare(far, near)).toBeLessThan(0);
    expect(sortByDepth([near, far])).toEqual([far, near]);
  });

  it('paints floor (layer 0) before props (layer 1) regardless of row', () => {
    const nearFloor = { tileX: 9, tileY: 9, layer: 0 };
    const farProp = { tileX: 0, tileY: 0, layer: 1 };
    expect(sortByDepth([farProp, nearFloor])).toEqual([nearFloor, farProp]);
  });

  it('breaks row ties by elevation, lower first', () => {
    const ground = { tileX: 2, tileY: 3, elevation: 0 };
    const raised = { tileX: 3, tileY: 2, elevation: 1 };
    expect(sortByDepth([raised, ground])).toEqual([ground, raised]);
  });

  it('is stable for full ties (insertion order preserved)', () => {
    const a = { tileX: 2, tileY: 2, id: 'a' };
    const b = { tileX: 2, tileY: 2, id: 'b' };
    const c = { tileX: 2, tileY: 2, id: 'c' };
    expect(sortByDepth([a, b, c]).map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(sortByDepth([c, b, a]).map((item) => item.id)).toEqual(['c', 'b', 'a']);
  });

  it('does not mutate its input', () => {
    const items = [
      { tileX: 5, tileY: 5 },
      { tileX: 0, tileY: 0 },
    ];
    const snapshot = [...items];
    sortByDepth(items);
    expect(items).toEqual(snapshot);
  });

  it('sorts a full diagonal sweep monotonically by x+y', () => {
    const items = [
      { tileX: 3, tileY: 0 },
      { tileX: 0, tileY: 0 },
      { tileX: 1, tileY: 2 },
      { tileX: 0, tileY: 2 },
      { tileX: 2, tileY: 0 },
    ];
    const rows = sortByDepth(items).map((item) => item.tileX + item.tileY);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
  });
});
