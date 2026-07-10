/**
 * 2:1 dimetric ("isometric") grid math — KICKOFF-v3.1 WS-A item (a).
 *
 * Conventions:
 * - Tile coordinates (tileX, tileY) are integers on the floor grid; +tileX
 *   runs toward screen lower-right, +tileY toward screen lower-left.
 * - World coordinates are the pre-camera 2D plane the renderer draws in
 *   (units are "world pixels" at zoom 1). tileToWorld returns the CENTER of
 *   the tile's top face, so tile (0,0) is centered on the world origin.
 * - Elevation lifts a tile straight up on screen (negative worldY) by
 *   ELEVATION_STEP per level.
 *
 * Pure math: no DOM, no display-density (DPR) reads — MOBILE-FORENSICS
 * constraint 1, density never leaks into layout.
 */

/** Tile footprint on screen: 2:1 dimetric diamond. */
export const TILE_W = 64;
export const TILE_H = 32;

/** Vertical world-pixel offset per elevation level. */
export const ELEVATION_STEP = 16;

export interface TilePoint {
  tileX: number;
  tileY: number;
}

export interface WorldPoint {
  worldX: number;
  worldY: number;
}

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/** Project a tile coordinate (optionally elevated) to world space. */
export function tileToWorld(tileX: number, tileY: number, elevation = 0): WorldPoint {
  return {
    worldX: (tileX - tileY) * (TILE_W / 2),
    worldY: (tileX + tileY) * (TILE_H / 2) - elevation * ELEVATION_STEP,
  };
}

/**
 * Invert tileToWorld at a known elevation. Returns FRACTIONAL tile
 * coordinates; callers round/floor as appropriate for hit-testing.
 */
export function worldToTile(worldX: number, worldY: number, elevation = 0): TilePoint {
  const flatY = worldY + elevation * ELEVATION_STEP;
  const xHalf = worldX / (TILE_W / 2);
  const yHalf = flatY / (TILE_H / 2);
  return {
    tileX: (xHalf + yHalf) / 2,
    tileY: (yHalf - xHalf) / 2,
  };
}

/**
 * World-space bounding box of a cols x rows floor (diamond footprint),
 * including headroom for maxElevation. This is the ONLY input the camera
 * needs about the map — fit-to-view is canvas-size vs. THIS, never DPR.
 */
export function mapWorldBounds(cols: number, rows: number, maxElevation = 0): WorldBounds {
  const left = tileToWorld(0, rows - 1);
  const right = tileToWorld(cols - 1, 0);
  const top = tileToWorld(0, 0, maxElevation);
  const bottom = tileToWorld(cols - 1, rows - 1);
  const minX = left.worldX - TILE_W / 2;
  const maxX = right.worldX + TILE_W / 2;
  const minY = top.worldY - TILE_H / 2;
  const maxY = bottom.worldY + TILE_H / 2;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
