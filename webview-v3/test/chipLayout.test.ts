import { describe, expect, it } from 'vitest';

import { type ChipAnchor, declutterChips } from '../src/engine/chipLayout';

function chip(id: number, x: number, y: number, width = 100, height = 22): ChipAnchor {
  return { id, x, y, width, height };
}

describe('declutterChips', () => {
  it('leaves non-overlapping chips exactly where they asked to be', () => {
    const placed = declutterChips([chip(1, 0, 0), chip(2, 200, 0), chip(3, 0, 100)]);
    expect(placed.every((p) => p.shifted === 0)).toBe(true);
    expect(placed.map((p) => ({ x: p.x, y: p.y }))).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 0, y: 100 },
    ]);
  });

  it('pushes an overlapping chip DOWN into the next free row (phone-zoom fix)', () => {
    const placed = declutterChips([chip(1, 0, 0), chip(2, 40, 4)]);
    const second = placed.find((p) => p.id === 2)!;
    expect(second.shifted).toBeGreaterThan(0);
    expect(second.x).toBe(40); // never sideways — the desk association holds
    expect(second.y).toBeGreaterThanOrEqual(placed.find((p) => p.id === 1)!.y + 22);
  });

  it('stacks a dense cluster without any residual overlap', () => {
    const cluster = [chip(1, 0, 0), chip(2, 10, 2), chip(3, 20, 4), chip(4, 30, 6)];
    const placed = declutterChips(cluster);
    for (const a of placed) {
      for (const b of placed) {
        if (a.id >= b.id) continue;
        const xOverlap = Math.abs(a.x - b.x) * 2 < a.width + b.width;
        const yOverlap = Math.abs(a.y - b.y) < Math.min(a.height, b.height);
        expect(xOverlap && yOverlap).toBe(false);
      }
    }
  });

  it('is deterministic for a given anchor set regardless of input order', () => {
    const anchors = [chip(3, 20, 4), chip(1, 0, 0), chip(2, 10, 2)];
    const a = declutterChips(anchors);
    const b = declutterChips([...anchors].reverse());
    expect(a.map((p) => [p.id, p.x, p.y])).toEqual(b.map((p) => [p.id, p.x, p.y]));
  });
});
