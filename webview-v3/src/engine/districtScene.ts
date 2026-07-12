/**
 * DISTRICTS scene layout + drawing (Phase 5 Lane C, T7/D-35 "districts =
 * projects"). v4 is a PROOF SLICE — exactly 2 hardcoded district plots
 * (war-room, TWE); a data-driven layout is v5 scope (KICKOFF-v4 T7).
 *
 * Reuses the office scene's own iso math (engine/iso.ts) and placeholder
 * box renderer (engine/placeholder.ts) rather than inventing a second
 * rendering system — same graceful-degradation posture as the office's
 * `door` prop with no sprite: no building sprites exist yet, so every
 * district renders as a procedural iso box, its floor count (height) the
 * real signal (net/districtFacts.ts progressToFloors).
 */

import {
  COLOR_DISTRICT_LEFT,
  COLOR_DISTRICT_RIGHT,
  COLOR_DISTRICT_TOP,
  COLOR_DISTRICT_UNKNOWN_LEFT,
  COLOR_DISTRICT_UNKNOWN_RIGHT,
  COLOR_DISTRICT_UNKNOWN_TOP,
  COLOR_FLOOR_A,
  COLOR_FLOOR_EDGE,
} from '../constants';
import type { DistrictProject } from '../net/districtFacts';
import { isDistrictUnknown, progressToFloors } from '../net/districtFacts';
import { mapWorldBounds, tileToWorld, type WorldBounds } from './iso';
import { type BoxPalette, drawDiamondTile, drawIsoBox } from './placeholder';

/** Fixed 2-plot layout (v4 proof slice) — one tile apart on a tiny 5x3
 *  grid, plenty of margin for the plaque + info-card hit area around each. */
export const DISTRICT_COLS = 5;
export const DISTRICT_ROWS = 3;

export interface DistrictPlot {
  key: string;
  tileX: number;
  tileY: number;
}

/** war-room's own plot sits west, TWE east — stable order matches the
 *  server's DISTRICT_SEEDS (districtsProvider.ts) so a project's plot
 *  never jumps around between polls. */
export const DISTRICT_PLOTS: readonly DistrictPlot[] = [
  { key: 'war-room', tileX: 1, tileY: 1 },
  { key: 'twe', tileX: 3, tileY: 1 },
];

export function districtSceneBounds(): WorldBounds {
  return mapWorldBounds(DISTRICT_COLS, DISTRICT_ROWS, MAX_BUILDING_ELEVATION);
}

/** World-px per floor — matches iso.ts's own ELEVATION_STEP scale so a
 *  4-floor building doesn't dwarf the 5x3 plot grid. */
const FLOOR_HEIGHT_PX = 14;
const MAX_BUILDING_ELEVATION = 4; // progressToFloors' MAX_FLOORS, kept in sync by hand

function paletteFor(project: DistrictProject): BoxPalette {
  if (isDistrictUnknown(project)) {
    return {
      top: COLOR_DISTRICT_UNKNOWN_TOP,
      left: COLOR_DISTRICT_UNKNOWN_LEFT,
      right: COLOR_DISTRICT_UNKNOWN_RIGHT,
    };
  }
  return { top: COLOR_DISTRICT_TOP, left: COLOR_DISTRICT_LEFT, right: COLOR_DISTRICT_RIGHT };
}

/** Ground-tile + building world-center for a plot (renderer and hit-test
 *  share this so a tap always targets exactly what got drawn). */
export function plotWorldCenter(plot: DistrictPlot): { worldX: number; worldY: number } {
  return tileToWorld(plot.tileX, plot.tileY);
}

/** Draws the ground tile + building for every plot with a matching project
 *  (a plot whose key has no project entry — shouldn't happen with the
 *  fixed v4 seed list, but drawing nothing is the safe degradation). */
export function drawDistrictScene(
  ctx: CanvasRenderingContext2D,
  projects: readonly DistrictProject[],
): void {
  for (const plot of DISTRICT_PLOTS) {
    const project = projects.find((p) => p.key === plot.key);
    const { worldX, worldY } = plotWorldCenter(plot);
    drawDiamondTile(ctx, worldX, worldY, COLOR_FLOOR_A, COLOR_FLOOR_EDGE);
    if (!project) continue;
    const floors = progressToFloors(project.progress);
    drawIsoBox(ctx, worldX, worldY, floors * FLOOR_HEIGHT_PX, 0.7, paletteFor(project));
  }
}

/** Nearest plot to a world-space point within `radius` world px of its
 *  center (a generous fixed radius over the small footprint — precise
 *  polygon hit-testing is unnecessary at this scale/zoom). Returns the
 *  plot's key, or null when the point is outside every plot's radius. */
export function hitTestDistrict(worldX: number, worldY: number, radius = 40): string | null {
  for (const plot of DISTRICT_PLOTS) {
    const center = plotWorldCenter(plot);
    const dx = worldX - center.worldX;
    const dy = worldY - center.worldY;
    if (Math.sqrt(dx * dx + dy * dy) <= radius) return plot.key;
  }
  return null;
}
