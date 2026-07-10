/**
 * Frame resolution for the real WS-B sprite manifests — pure math, no
 * canvas/DOM (engine/spriteRenderer.ts does the drawing). Static sprites
 * carry one FrameRect per rotation; animated sprites carry an ordered
 * array — distinguished with Array.isArray per the documented contract
 * (tools/asset-pipeline/README.md "Animated sprites").
 */

import type { FrameRect, Rotation, SpriteDef } from '../assets/manifest';

/** The frame to draw for `sprite` at `rotation`, `frameIndex` (animated) or
 *  frame 0 (static). Falls back to a rotation the sprite DOES have if the
 *  requested one is missing (every authored sprite has all 4 in practice,
 *  but this keeps a partial/future manifest from going blank) — S is the
 *  authored-facing default (tools/asset-pipeline README "authored facing S"). */
export function resolveFrame(
  sprite: SpriteDef,
  rotation: Rotation,
  frameIndex = 0,
): FrameRect | null {
  const forRotation = sprite.frames[rotation] ?? sprite.frames.S ?? Object.values(sprite.frames)[0];
  if (!forRotation) return null;
  if (Array.isArray(forRotation)) {
    return forRotation[frameIndex] ?? forRotation[0] ?? null;
  }
  return forRotation as FrameRect;
}

export function frameCount(sprite: SpriteDef, rotation: Rotation): number {
  const forRotation = sprite.frames[rotation];
  if (!forRotation) return 0;
  return Array.isArray(forRotation) ? forRotation.length : 1;
}

/** Which animation frame is showing at time `nowMs`, looping at the
 *  sprite's authored `fps` (absent/0 = static, always frame 0). */
export function animationFrameIndex(sprite: SpriteDef, rotation: Rotation, nowMs: number): number {
  const count = frameCount(sprite, rotation);
  if (count <= 1 || !sprite.fps) return 0;
  const msPerFrame = 1000 / sprite.fps;
  return Math.floor(nowMs / msPerFrame) % count;
}

/** World-px scale from the pipeline's native tile size (`manifest.tilePx`,
 *  the diamond WIDTH — height is tilePx/2, same 2:1 ratio as engine/iso.ts)
 *  down to the engine's own tile grid (TILE_W). Both are 2:1 dimetric, so
 *  one uniform scale factor keeps `screenOf(tile) - anchor*scale` exact. */
export function spriteScaleFor(tilePx: number, tileW: number): number {
  return tilePx > 0 ? tileW / tilePx : 1;
}
