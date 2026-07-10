/**
 * Canvas 2D world renderer. Owns the transform stack:
 *
 *   backing store = CSS size x resolution   (resolution.ts — capped DPR)
 *   world pass    = setTransform(resolution * zoom, ..., resolution * offset)
 *   label pass    = setTransform(resolution, ...) — canvas/CSS space, so
 *                   text stays a fixed on-screen size at any camera zoom.
 *
 * The camera is computed by the caller from CSS size only; this module
 * never reads display density (it receives `resolution` as a plain number
 * from engine/resolution.ts, the one permitted DPR read).
 */

import {
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
  COLOR_WORLD_BG,
} from '../constants';
import { type CameraState, type Size, worldToCanvas } from './camera';
import { sortByDepth } from './depthSort';
import { tileToWorld } from './iso';
import { type BoxPalette, drawDiamondTile, drawIsoBox, drawLabel } from './placeholder';
import type { WorldProp } from './world';

export interface RenderInput {
  cssSize: Size;
  /** Capped backing-store density from engine/resolution.ts. */
  resolution: number;
  camera: CameraState;
  cols: number;
  rows: number;
  props: readonly WorldProp[];
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

const PROP_SHAPES: Record<WorldProp['kind'], { height: number; footprint: number }> = {
  desk: { height: 18, footprint: 0.8 },
  plant: { height: 22, footprint: 0.35 },
  coffee: { height: 26, footprint: 0.5 },
  door: { height: 30, footprint: 0.6 },
};

const LABEL_FONT_PX = 11;

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

  // Props (painter's order).
  const sortedProps = sortByDepth(props.map((prop) => ({ ...prop, layer: 1 })));
  for (const prop of sortedProps) {
    const { worldX, worldY } = tileToWorld(prop.tileX, prop.tileY, prop.elevation ?? 0);
    const shape = PROP_SHAPES[prop.kind];
    const palette = prop.kind === 'desk' ? DESK_PALETTE : PROP_PALETTE;
    drawIsoBox(ctx, worldX, worldY, shape.height, shape.footprint, palette);
    if (prop.kind === 'desk' && prop.occupant) {
      // Occupant block sits on the desk top.
      drawIsoBox(ctx, worldX, worldY - shape.height, 14, 0.4, OCCUPANT_PALETTE);
    }
  }

  // Label pass (canvas space — fixed on-screen text size).
  ctx.setTransform(resolution, 0, 0, resolution, 0, 0);
  for (const prop of sortedProps) {
    if (prop.kind !== 'desk' || !prop.occupant) continue;
    const { worldX, worldY } = tileToWorld(prop.tileX, prop.tileY, prop.elevation ?? 0);
    const anchor = worldToCanvas(camera, worldX, worldY - PROP_SHAPES.desk.height - 22);
    drawLabel(
      ctx,
      anchor.x,
      anchor.y,
      `${prop.occupant.statusGlyph} ${prop.occupant.name} · ${prop.occupant.statusWord}`,
      LABEL_FONT_PX,
    );
  }
}
