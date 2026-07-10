import { describe, expect, it } from 'vitest';

import type { CameraState } from '../src/engine/camera';
import { HOTSPOTS, placeHotspots } from '../src/engine/hotspots';
import {
  DEFAULT_COLS,
  DEFAULT_MAX_ELEVATION,
  DEFAULT_ROWS,
  DESK_SLOTS,
  STATIC_PROPS,
} from '../src/engine/world';

const IDENTITY_CAMERA: CameraState = { zoom: 1, offsetX: 0, offsetY: 0 };

describe('HOTSPOTS', () => {
  it('one entry per panel with a physical analog, all distinct kinds', () => {
    const kinds = HOTSPOTS.map((h) => h.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds.sort()).toEqual(['automation', 'briefing', 'call', 'contracts', 'shift']);
  });

  it('sits on tiles clear of every desk slot and static prop (no overlap)', () => {
    const occupied = new Set(
      [...DESK_SLOTS, ...STATIC_PROPS].map((p) => `${String(p.tileX)},${String(p.tileY)}`),
    );
    for (const hotspot of HOTSPOTS) {
      expect(occupied.has(`${String(hotspot.tileX)},${String(hotspot.tileY)}`)).toBe(false);
    }
  });

  it('every tile is within the default floor bounds', () => {
    for (const hotspot of HOTSPOTS) {
      expect(hotspot.tileX).toBeGreaterThanOrEqual(0);
      expect(hotspot.tileX).toBeLessThan(DEFAULT_COLS);
      expect(hotspot.tileY).toBeGreaterThanOrEqual(0);
      expect(hotspot.tileY).toBeLessThan(DEFAULT_ROWS);
      expect(DEFAULT_MAX_ELEVATION).toBe(0); // sanity: one floor, no elevation math needed yet
    }
  });
});

describe('placeHotspots', () => {
  it('projects every hotspot through the given camera, same transform ChipLayer uses', () => {
    const placed = placeHotspots(IDENTITY_CAMERA);
    expect(placed).toHaveLength(HOTSPOTS.length);
    for (const p of placed) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('a zoomed/offset camera moves the projected point predictably', () => {
    const zoomed: CameraState = { zoom: 2, offsetX: 50, offsetY: 10 };
    const base = placeHotspots(IDENTITY_CAMERA)[0];
    const scaled = placeHotspots(zoomed)[0];
    expect(scaled.x).toBeCloseTo(base.x * 2 + 50);
    expect(scaled.y).toBeCloseTo(base.y * 2 + 10);
  });
});
