/**
 * Real-sprite canvas drawing — KICKOFF-v3.1 WS-A "wire real sprites in".
 * Implements the WS-B pipeline's documented drawing rule verbatim
 * (tools/asset-pipeline/README.md "Drawing rule for WS-A" — the same rule
 * tools/asset-pipeline/viewer.html's drawSpriteFrame independently
 * re-implements as its own QA check):
 *
 *   draw the frame at screenOf(tile) - anchor
 *
 * `anchor` and `size` are frame-relative sheet px, uniform across a
 * sprite's rotations/animation frames (union-trim, pack.py). The pipeline's
 * native tile size (`manifest.tilePx`, a 128px-wide diamond) is 2x the
 * engine's own tile grid (engine/iso.ts TILE_W=64) — both 2:1 dimetric, so
 * `sprites.ts#spriteScaleFor` gives one uniform scale that keeps the rule
 * exact at the engine's world scale.
 */

import type { Rotation, SpriteDef } from '../assets/manifest';
import { resolveFrame } from './sprites';

/**
 * Draw one frame of `sprite` so its floor-contact point lands on
 * (worldX, worldY) — the caller's `iso.ts#tileToWorld` output. Returns
 * false (draws nothing) when the sprite has no frame for `rotation` at all
 * — callers fall back to placeholder art in that case, never a blank spot.
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  sprite: SpriteDef,
  rotation: Rotation,
  frameIndex: number,
  worldX: number,
  worldY: number,
  scale: number,
): boolean {
  const frame = resolveFrame(sprite, rotation, frameIndex);
  if (!frame) return false;
  const [w, h] = sprite.size;
  const [ax, ay] = sprite.anchor;
  const drawWidth = w * scale;
  const drawHeight = h * scale;
  const dx = worldX - ax * scale;
  const dy = worldY - ay * scale;
  ctx.drawImage(image, frame.x, frame.y, w, h, dx, dy, drawWidth, drawHeight);
  return true;
}
