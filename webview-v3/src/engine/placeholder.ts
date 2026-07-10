/**
 * Procedural placeholder art — KICKOFF-v3.1 WS-A item (e), skeleton-first
 * hard rule: the world renders flat-shaded diamonds and boxes BEFORE any
 * real asset exists, so "still loading assets" is never visually identical
 * to "broken" (MOBILE-FORENSICS constraint 3).
 *
 * All drawing happens in WORLD space — the renderer owns the camera and
 * resolution transform. Colors come from ../constants.ts only.
 */

import { COLOR_BOX_OUTLINE } from '../constants';
import { TILE_H, TILE_W } from './iso';

export interface BoxPalette {
  top: string;
  left: string;
  right: string;
}

/** Flat-shaded 2:1 diamond floor tile centered on (centerX, centerY). */
export function drawDiamondTile(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  fill: string,
  edge: string,
): void {
  const halfW = TILE_W / 2;
  const halfH = TILE_H / 2;
  ctx.beginPath();
  ctx.moveTo(centerX, centerY - halfH);
  ctx.lineTo(centerX + halfW, centerY);
  ctx.lineTo(centerX, centerY + halfH);
  ctx.lineTo(centerX - halfW, centerY);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = edge;
  ctx.stroke();
}

/**
 * Simple iso box (placeholder furniture): a diamond top face at `height`
 * world px above the ground tile centered on (centerX, centerY), plus two
 * shaded side faces. `footprint` scales the diamond within the tile
 * (1 = full tile).
 */
export function drawIsoBox(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  height: number,
  footprint: number,
  palette: BoxPalette,
): void {
  const halfW = (TILE_W / 2) * footprint;
  const halfH = (TILE_H / 2) * footprint;
  const topY = centerY - height;

  // Left face (screen lower-left).
  ctx.beginPath();
  ctx.moveTo(centerX - halfW, topY);
  ctx.lineTo(centerX, topY + halfH);
  ctx.lineTo(centerX, centerY + halfH);
  ctx.lineTo(centerX - halfW, centerY);
  ctx.closePath();
  ctx.fillStyle = palette.left;
  ctx.fill();

  // Right face (screen lower-right).
  ctx.beginPath();
  ctx.moveTo(centerX + halfW, topY);
  ctx.lineTo(centerX, topY + halfH);
  ctx.lineTo(centerX, centerY + halfH);
  ctx.lineTo(centerX + halfW, centerY);
  ctx.closePath();
  ctx.fillStyle = palette.right;
  ctx.fill();

  // Top face.
  ctx.beginPath();
  ctx.moveTo(centerX, topY - halfH);
  ctx.lineTo(centerX + halfW, topY);
  ctx.lineTo(centerX, topY + halfH);
  ctx.lineTo(centerX - halfW, topY);
  ctx.closePath();
  ctx.fillStyle = palette.top;
  ctx.fill();

  // Outline the silhouette so the shape survives grayscale.
  ctx.beginPath();
  ctx.moveTo(centerX, topY - halfH);
  ctx.lineTo(centerX + halfW, topY);
  ctx.lineTo(centerX + halfW, centerY);
  ctx.lineTo(centerX, centerY + halfH);
  ctx.lineTo(centerX - halfW, centerY);
  ctx.lineTo(centerX - halfW, topY);
  ctx.closePath();
  ctx.lineWidth = 1;
  ctx.strokeStyle = COLOR_BOX_OUTLINE;
  ctx.stroke();
}

// NOTE: stage 2 moved all text to the DOM chip layer (KICKOFF-v3.1 "tails
// and text are DOM ALWAYS") — the canvas-space drawLabel that lived here in
// stage 1 was deleted with its call site in renderer.ts.
