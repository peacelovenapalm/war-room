/**
 * Painter's-algorithm depth sort — KICKOFF-v3.1 WS-A item (b).
 *
 * Draw order for a 2:1 dimetric world: lower layer first (floor under
 * props), then increasing (tileX + tileY) — the iso "depth row" — so
 * far tiles are painted before near tiles and near boxes overpaint far
 * ones. Ties break by elevation (lower first), then by input order
 * (Array.prototype.sort is stable per ES2019+).
 */

export interface DepthSortable {
  tileX: number;
  tileY: number;
  /** Elevation level (see iso.ts ELEVATION_STEP). Default 0. */
  elevation?: number;
  /** Coarse paint layer: 0 = floor, 1 = props/actors. Default 0. */
  layer?: number;
}

export function depthCompare(a: DepthSortable, b: DepthSortable): number {
  const layerDelta = (a.layer ?? 0) - (b.layer ?? 0);
  if (layerDelta !== 0) return layerDelta;
  const rowDelta = a.tileX + a.tileY - (b.tileX + b.tileY);
  if (rowDelta !== 0) return rowDelta;
  return (a.elevation ?? 0) - (b.elevation ?? 0);
}

/** Returns a NEW array in painter's order; never mutates the input. */
export function sortByDepth<T extends DepthSortable>(items: readonly T[]): T[] {
  return [...items].sort(depthCompare);
}
