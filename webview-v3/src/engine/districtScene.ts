/**
 * DISTRICTS scene layout + drawing (Phase 5 Lane C, T7/D-35 "districts =
 * projects"; v5 C1 "N-project build-out"). v4 was a PROOF SLICE — exactly
 * 2 hardcoded district plots (war-room, TWE). v5 C1 grows the layout to
 * whatever project list GET /api/districts returns (4-10 projects in
 * practice), arranged in a grid that stays phone-viewport friendly: a
 * capped column count so the grid grows in ROWS (taller, not wider) as
 * projects are added — narrow-portrait screens read better that way than
 * an ever-widening single row.
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

/** Grid margin (tiles from the plot grid's edge to the map edge). */
const GRID_MARGIN = 1;
/** Tile spacing between adjacent plot centers (row and column) — enough
 *  room for the plaque + info-card hit area around each building. */
const PLOT_SPACING = 2;
/** Column cap: beyond this many projects per row, wrap into a new row
 *  instead of widening — keeps the scene tall-and-narrow, matching a
 *  phone's portrait viewport rather than an ever-widening single strip. */
const MAX_PLOTS_PER_ROW = 3;

export interface DistrictPlot {
  key: string;
  tileX: number;
  tileY: number;
}

/** Computes one grid plot per project, in the SAME order the server
 *  returned them — stable as long as the server's own order is stable, so
 *  a project's plot never jumps around between polls. Wraps into
 *  additional rows past MAX_PLOTS_PER_ROW rather than growing the row
 *  width unbounded (KICKOFF v5 C1: "must handle 4-10 projects gracefully
 *  on a phone viewport"). */
export function computeDistrictPlots(
  projects: readonly DistrictProject[],
): readonly DistrictPlot[] {
  const cols = Math.max(1, Math.min(projects.length, MAX_PLOTS_PER_ROW));
  return projects.map((project, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      key: project.key,
      tileX: GRID_MARGIN + col * PLOT_SPACING,
      tileY: GRID_MARGIN + row * PLOT_SPACING,
    };
  });
}

/** World-px per floor — matches iso.ts's own ELEVATION_STEP scale so a
 *  4-floor building doesn't dwarf its plot. */
const FLOOR_HEIGHT_PX = 14;
const MAX_BUILDING_ELEVATION = 4; // progressToFloors' MAX_FLOORS, kept in sync by hand

/** Scene bounds sized to the ACTUAL plot grid — grows with N projects
 *  (both directions, capped in width by MAX_PLOTS_PER_ROW) rather than a
 *  fixed 5x3. An empty plot list still yields a positive-area box (single
 *  cell) so the camera never divides by zero. */
export function districtSceneBounds(plots: readonly DistrictPlot[]): WorldBounds {
  const maxTileX = plots.reduce((m, p) => Math.max(m, p.tileX), 0);
  const maxTileY = plots.reduce((m, p) => Math.max(m, p.tileY), 0);
  const cols = maxTileX + GRID_MARGIN + 1;
  const rows = maxTileY + GRID_MARGIN + 1;
  return mapWorldBounds(cols, rows, MAX_BUILDING_ELEVATION);
}

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

/** Draws the ground tile + building for every project against its
 *  computed plot (a project with no matching plot — shouldn't happen,
 *  `plots` is always derived from the same `projects` array — but drawing
 *  nothing is the safe degradation). */
export function drawDistrictScene(
  ctx: CanvasRenderingContext2D,
  projects: readonly DistrictProject[],
  plots: readonly DistrictPlot[],
): void {
  for (const project of projects) {
    const plot = plots.find((p) => p.key === project.key);
    if (!plot) continue;
    const { worldX, worldY } = plotWorldCenter(plot);
    drawDiamondTile(ctx, worldX, worldY, COLOR_FLOOR_A, COLOR_FLOOR_EDGE);
    const floors = progressToFloors(project.progress);
    drawIsoBox(ctx, worldX, worldY, floors * FLOOR_HEIGHT_PX, 0.7, paletteFor(project));
  }
}

/** Nearest plot to a world-space point within `radius` world px of its
 *  center (a generous fixed radius over the small footprint — precise
 *  polygon hit-testing is unnecessary at this scale/zoom). Returns the
 *  plot's key, or null when the point is outside every plot's radius. */
export function hitTestDistrict(
  worldX: number,
  worldY: number,
  plots: readonly DistrictPlot[],
  radius = 40,
): string | null {
  for (const plot of plots) {
    const center = plotWorldCenter(plot);
    const dx = worldX - center.worldX;
    const dy = worldY - center.worldY;
    if (Math.sqrt(dx * dx + dy * dy) <= radius) return plot.key;
  }
  return null;
}
