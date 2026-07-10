/**
 * Canvas 2D world renderer. Owns the transform stack:
 *
 *   backing store = CSS size x resolution   (resolution.ts — capped DPR)
 *   world pass    = setTransform(resolution * zoom, ..., resolution * offset)
 *
 * Stage-2 contract: the canvas draws ONLY world geometry + glow. ALL text
 * (desk chips, board, tails, HUD) is DOM, positioned by the caller via
 * worldToCanvas — crisp, selectable, decluttered (engine/chipLayout.ts).
 *
 * The camera is computed by the caller from CSS size only; this module
 * never reads display density (it receives `resolution` as a plain number
 * from engine/resolution.ts, the one permitted DPR read).
 */

import {
  ambientWashColor,
  COLOR_DESK_GLOW,
  COLOR_DESK_LEFT,
  COLOR_DESK_RIGHT,
  COLOR_DESK_TOP,
  COLOR_FLOOR_A,
  COLOR_FLOOR_B,
  COLOR_FLOOR_EDGE,
  COLOR_OCCUPANT_LEFT,
  COLOR_OCCUPANT_RIGHT,
  COLOR_OCCUPANT_TOP,
  COLOR_PROP_LEFT,
  COLOR_PROP_RIGHT,
  COLOR_PROP_TOP,
  COLOR_WALKER_LEFT,
  COLOR_WALKER_RIGHT,
  COLOR_WALKER_TOP,
  COLOR_WORLD_BG,
} from '../constants';
import type { CameraState, Size } from './camera';
import { sortByDepth } from './depthSort';
import { TILE_H, TILE_W, tileToWorld } from './iso';
import { type BoxPalette, drawDiamondTile, drawIsoBox } from './placeholder';
import type { WorldProp } from './world';

export interface RenderInput {
  cssSize: Size;
  /** Capped backing-store density from engine/resolution.ts. */
  resolution: number;
  camera: CameraState;
  cols: number;
  rows: number;
  props: readonly WorldProp[];
  /** Calm-channel ambient wash in [0, 1] (engine/calm.ts's displayedWarmth).
   *  Omitted/undefined = no wash drawn (e.g. tests that don't care). */
  warmth?: number;
}

const DESK_PALETTE: BoxPalette = {
  top: COLOR_DESK_TOP,
  left: COLOR_DESK_LEFT,
  right: COLOR_DESK_RIGHT,
};
const OCCUPANT_PALETTE: BoxPalette = {
  top: COLOR_OCCUPANT_TOP,
  left: COLOR_OCCUPANT_LEFT,
  right: COLOR_OCCUPANT_RIGHT,
};
const PROP_PALETTE: BoxPalette = {
  top: COLOR_PROP_TOP,
  left: COLOR_PROP_LEFT,
  right: COLOR_PROP_RIGHT,
};
const WALKER_PALETTE: BoxPalette = {
  top: COLOR_WALKER_TOP,
  left: COLOR_WALKER_LEFT,
  right: COLOR_WALKER_RIGHT,
};

const PROP_PALETTES: Record<WorldProp['kind'], BoxPalette> = {
  desk: DESK_PALETTE,
  plant: PROP_PALETTE,
  coffee: PROP_PALETTE,
  door: PROP_PALETTE,
  walker: WALKER_PALETTE,
};

export const PROP_SHAPES: Record<WorldProp['kind'], { height: number; footprint: number }> = {
  desk: { height: 18, footprint: 0.8 },
  plant: { height: 22, footprint: 0.35 },
  coffee: { height: 26, footprint: 0.5 },
  door: { height: 30, footprint: 0.6 },
  // Deliberately smaller/rounder than any real prop — a shape difference
  // (not color-only) so ambient walkers read as "a small moving figure"
  // even in grayscale.
  walker: { height: 10, footprint: 0.22 },
};

/** Monitor-glow ellipse half-extents (world px) under an occupied desk. */
const GLOW_HALF_W = TILE_W * 0.9;
const GLOW_HALF_H = TILE_H * 0.9;

export function renderWorld(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  const { cssSize, resolution, camera, cols, rows, props } = input;

  // Background (canvas space).
  ctx.setTransform(resolution, 0, 0, resolution, 0, 0);
  ctx.fillStyle = COLOR_WORLD_BG;
  ctx.fillRect(0, 0, cssSize.width, cssSize.height);

  // World pass.
  const scale = resolution * camera.zoom;
  ctx.setTransform(scale, 0, 0, scale, camera.offsetX * resolution, camera.offsetY * resolution);

  // Floor: row-major is already painter's order for flat tiles, but go
  // through sortByDepth so floor and props share one code path.
  const tiles: { tileX: number; tileY: number; layer: number }[] = [];
  for (let tileY = 0; tileY < rows; tileY++) {
    for (let tileX = 0; tileX < cols; tileX++) {
      tiles.push({ tileX, tileY, layer: 0 });
    }
  }
  for (const tile of sortByDepth(tiles)) {
    const { worldX, worldY } = tileToWorld(tile.tileX, tile.tileY);
    const checker = (tile.tileX + tile.tileY) % 2 === 0 ? COLOR_FLOOR_A : COLOR_FLOOR_B;
    drawDiamondTile(ctx, worldX, worldY, checker, COLOR_FLOOR_EDGE);
  }

  // Monitor glow under occupied desks (color is REINFORCEMENT only — the
  // occupancy signal itself is the occupant block + the DOM chip's text).
  for (const prop of props) {
    if (prop.kind !== 'desk' || !prop.occupant) continue;
    const { worldX, worldY } = tileToWorld(prop.tileX, prop.tileY, prop.elevation ?? 0);
    ctx.beginPath();
    ctx.ellipse(worldX, worldY, GLOW_HALF_W, GLOW_HALF_H, 0, 0, Math.PI * 2);
    ctx.fillStyle = COLOR_DESK_GLOW;
    ctx.fill();
  }

  // Props (painter's order).
  const sortedProps = sortByDepth(props.map((prop) => ({ ...prop, layer: 1 })));
  for (const prop of sortedProps) {
    const { worldX, worldY } = tileToWorld(prop.tileX, prop.tileY, prop.elevation ?? 0);
    const shape = PROP_SHAPES[prop.kind];
    const palette = PROP_PALETTES[prop.kind];
    drawIsoBox(ctx, worldX, worldY, shape.height, shape.footprint, palette);
    if (prop.kind === 'desk' && prop.occupant) {
      // Occupant block sits on the desk top.
      drawIsoBox(ctx, worldX, worldY - shape.height, 14, 0.4, OCCUPANT_PALETTE);
    }
  }

  // Calm-channel ambient wash (engine/calm.ts) — screen-space, drawn LAST so
  // it tints the whole painted frame uniformly regardless of zoom/pan.
  // REINFORCEMENT only: state/hud.ts's mood chip (shape + text) is the
  // actual signal; this never gates or gets checked for anything.
  if (input.warmth !== undefined) {
    ctx.setTransform(resolution, 0, 0, resolution, 0, 0);
    ctx.fillStyle = ambientWashColor(input.warmth);
    ctx.fillRect(0, 0, cssSize.width, cssSize.height);
  }
}
