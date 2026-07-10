import { describe, expect, it } from 'vitest';

import {
  ELEVATION_STEP,
  mapWorldBounds,
  TILE_H,
  TILE_W,
  tileToWorld,
  worldToTile,
} from '../src/engine/iso';

describe('2:1 dimetric grid math', () => {
  it('uses a 2:1 tile ratio', () => {
    expect(TILE_W).toBe(TILE_H * 2);
  });

  it('projects the origin tile to the world origin (center convention)', () => {
    expect(tileToWorld(0, 0)).toEqual({ worldX: 0, worldY: 0 });
  });

  it('projects +tileX to lower-right and +tileY to lower-left', () => {
    const east = tileToWorld(1, 0);
    expect(east.worldX).toBeGreaterThan(0);
    expect(east.worldY).toBeGreaterThan(0);
    const south = tileToWorld(0, 1);
    expect(south.worldX).toBeLessThan(0);
    expect(south.worldY).toBeGreaterThan(0);
    // Same screen row depth (x + y equal).
    expect(east.worldY).toBe(south.worldY);
  });

  it('shifts up by ELEVATION_STEP per elevation level, x unchanged', () => {
    const flat = tileToWorld(4, 7);
    const raised = tileToWorld(4, 7, 2);
    expect(raised.worldX).toBe(flat.worldX);
    expect(raised.worldY).toBe(flat.worldY - 2 * ELEVATION_STEP);
  });

  it('round-trips tile -> world -> tile exactly, including elevation', () => {
    for (const [tileX, tileY, elevation] of [
      [0, 0, 0],
      [5, 3, 0],
      [3, 5, 1],
      [13, 9, 3],
      [-2, 4, 0],
    ] as const) {
      const world = tileToWorld(tileX, tileY, elevation);
      const back = worldToTile(world.worldX, world.worldY, elevation);
      expect(back.tileX).toBeCloseTo(tileX, 10);
      expect(back.tileY).toBeCloseTo(tileY, 10);
    }
  });

  it('returns fractional tiles for off-center world points', () => {
    const center = tileToWorld(2, 2);
    const nudged = worldToTile(center.worldX + TILE_W / 4, center.worldY);
    expect(nudged.tileX).toBeCloseTo(2.25, 10);
    expect(nudged.tileY).toBeCloseTo(1.75, 10);
  });

  describe('mapWorldBounds', () => {
    it('contains every tile center of the map', () => {
      const cols = 14;
      const rows = 10;
      const bounds = mapWorldBounds(cols, rows);
      for (let tileY = 0; tileY < rows; tileY++) {
        for (let tileX = 0; tileX < cols; tileX++) {
          const { worldX, worldY } = tileToWorld(tileX, tileY);
          expect(worldX).toBeGreaterThanOrEqual(bounds.minX);
          expect(worldX).toBeLessThanOrEqual(bounds.maxX);
          expect(worldY).toBeGreaterThanOrEqual(bounds.minY);
          expect(worldY).toBeLessThanOrEqual(bounds.maxY);
        }
      }
    });

    it('is exactly the diamond hull for a flat map', () => {
      const bounds = mapWorldBounds(2, 2);
      // Corner tile centers ± half a tile.
      expect(bounds.minX).toBe(tileToWorld(0, 1).worldX - TILE_W / 2);
      expect(bounds.maxX).toBe(tileToWorld(1, 0).worldX + TILE_W / 2);
      expect(bounds.minY).toBe(tileToWorld(0, 0).worldY - TILE_H / 2);
      expect(bounds.maxY).toBe(tileToWorld(1, 1).worldY + TILE_H / 2);
      expect(bounds.width).toBe(bounds.maxX - bounds.minX);
      expect(bounds.height).toBe(bounds.maxY - bounds.minY);
    });

    it('grows upward with maxElevation', () => {
      const flat = mapWorldBounds(4, 4, 0);
      const tall = mapWorldBounds(4, 4, 2);
      expect(tall.minY).toBe(flat.minY - 2 * ELEVATION_STEP);
      expect(tall.maxY).toBe(flat.maxY);
    });
  });
});
