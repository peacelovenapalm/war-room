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
import { mapWorldBounds, TILE_H, TILE_W, tileToWorld, type WorldBounds } from './iso';
import { type BoxPalette, drawDiamondTile, drawIsoBox } from './placeholder';

/**
 * Plot spacing (v5R districts overlap fix, RUN-MAP-v5-v7 §2). The old
 * uniform PLOT_SPACING=2 tile grid gave every step — column AND row —
 * only 32 world-px of vertical separation ((tileX+tileY) both grow), while
 * a 4-floor building is 56px tall plus an ~11px roof diamond: front rows
 * occluded the row behind and plaques collided (Greg's phone report
 * 2026-07-12). The fix separates the axes IN SCREEN SPACE:
 *
 * - Column step = tiles (+1, -1) → exactly (+64, 0) world px: columns run
 *   straight across the screen, zero vertical creep.
 * - Row step = tiles (+4, +4) → exactly (0, +128) world px: rows run
 *   straight down the screen with clearance for the tallest building
 *   (56 + 11 roof + 16 ground-diamond half + margin < 128).
 *
 * Both steps stay integer tile coordinates so plotWorldCenter/tileToWorld
 * are untouched; tileY may go negative, which is fine because
 * districtSceneBounds derives from actual plot world positions (below),
 * not from a 0-origin tile rectangle.
 */
const COL_STEP_TILE_X = 1;
const COL_STEP_TILE_Y = -1;
const ROW_STEP_TILE = 4;
/** Column cap: beyond this many projects per row, wrap into a new row
 *  instead of widening — keeps the scene tall-and-narrow, matching a
 *  phone's portrait viewport rather than an ever-widening single strip. */
const MAX_PLOTS_PER_ROW = 3;

export interface DistrictPlot {
  key: string;
  tileX: number;
  tileY: number;
  /** Odd columns hang their DOM plaque one step lower than even columns
   *  (v5R overlap fix): adjacent-column plaques are only 64 world px
   *  apart, so two long (width-capped) labels on the same baseline could
   *  still touch at low zoom — alternating baselines makes label
   *  collision geometrically impossible regardless of zoom. */
  staggerPlaque: boolean;
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
      tileX: col * COL_STEP_TILE_X + row * ROW_STEP_TILE,
      tileY: col * COL_STEP_TILE_Y + row * ROW_STEP_TILE,
      staggerPlaque: col % 2 === 1,
    };
  });
}

/** World-px per floor — matches iso.ts's own ELEVATION_STEP scale so a
 *  4-floor building doesn't dwarf its plot. */
const FLOOR_HEIGHT_PX = 14;
const MAX_BUILDING_ELEVATION = 4; // progressToFloors' MAX_FLOORS, kept in sync by hand

/** Scene bounds derived from the ACTUAL plot world positions (v5R fix:
 *  the old tile-rectangle derivation both over-padded — the enclosing
 *  0-origin diamond is much larger than the plot area — and broke once
 *  column steps made tileY negative). Pads each side for the ground
 *  diamond, the tallest possible building + roof above, and plaque room
 *  below. An empty plot list still yields a positive-area box (single
 *  cell) so the camera never divides by zero. */
export function districtSceneBounds(plots: readonly DistrictPlot[]): WorldBounds {
  if (plots.length === 0) {
    return mapWorldBounds(1, 1, MAX_BUILDING_ELEVATION);
  }
  const centers = plots.map((p) => plotWorldCenter(p));
  const minCX = Math.min(...centers.map((c) => c.worldX));
  const maxCX = Math.max(...centers.map((c) => c.worldX));
  const minCY = Math.min(...centers.map((c) => c.worldY));
  const maxCY = Math.max(...centers.map((c) => c.worldY));
  // Tallest building (4 floors) + its roof half-diamond above the ground
  // center; ground diamond + plaque room below.
  const headroom = MAX_BUILDING_ELEVATION * FLOOR_HEIGHT_PX + TILE_H;
  const minX = minCX - TILE_W / 2;
  const maxX = maxCX + TILE_W / 2;
  const minY = minCY - headroom;
  const maxY = maxCY + TILE_H;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
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
  // Painter's order: back-to-front by worldY so a nearer (lower-on-screen)
  // building is never overpainted by a farther one — the old code drew in
  // server order, which interleaves rows (v5R overlap fix).
  const ordered = [...projects].sort((a, b) => {
    const pa = plots.find((p) => p.key === a.key);
    const pb = plots.find((p) => p.key === b.key);
    return (pa ? plotWorldCenter(pa).worldY : 0) - (pb ? plotWorldCenter(pb).worldY : 0);
  });
  for (const project of ordered) {
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
 *  polygon hit-testing is unnecessary at this scale/zoom). Adjacent
 *  same-row plot centers sit exactly 64 world px apart (COL step) —
 *  narrower than 2x radius, so neighboring hit circles DO overlap at the
 *  boundary between two plots. Resolving to the NEAREST center (not
 *  first-in-array) keeps a boundary tap deterministic and visually
 *  correct instead of order-dependent. Returns the plot's key, or null
 *  when the point is outside every plot's radius. */
export function hitTestDistrict(
  worldX: number,
  worldY: number,
  plots: readonly DistrictPlot[],
  radius = 40,
): string | null {
  let bestKey: string | null = null;
  let bestDist = Infinity;
  for (const plot of plots) {
    const center = plotWorldCenter(plot);
    const dx = worldX - center.worldX;
    const dy = worldY - center.worldY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= radius && dist < bestDist) {
      bestDist = dist;
      bestKey = plot.key;
    }
  }
  return bestKey;
}
