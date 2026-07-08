/**
 * PixiJS rendering for the Matrix-style spawn/despawn digital-rain effect —
 * G0 port. Temporarily a separate file from `matrixEffect.ts` (the old
 * canvas version) so both engines compile side by side while the
 * `WAR_ROOM_ENGINE` flag is being bisected — task 10 deletes the canvas
 * original and renames this file to `matrixEffect.ts` once the flip is
 * verified clean in both directions twice.
 *
 * Per-pixel algorithm is unchanged from the canvas version; only
 * the render TARGET changes: instead of drawing straight into the shared
 * canvas 2D context, each frame is rasterized onto a small reused offscreen
 * canvas and uploaded as a one-off Pixi Texture (the effect only runs for
 * MATRIX_EFFECT_DURATION_SEC ≈ 0.3s, so a fresh texture upload per animated
 * frame is cheap and avoids reimplementing per-pixel dissolve as a Pixi
 * shader/particle system for a rare, short-lived transition).
 *
 * NOTE (preserved from the original): the sweep only ever draws
 * `MATRIX_SPRITE_ROWS` (24) of a character sprite's `CHAR_FRAME_H` (32)
 * rows — the bottom 8 rows render blank during the effect. That's an
 * existing quirk of the pre-Pixi renderer, not something this port
 * introduces; callers must anchor the resulting texture at the sprite's
 * TOP (not bottom) using `fullSpriteHeight` to keep the visible rows in
 * the same screen position the old canvas version drew them.
 */
import type { Texture as PixiTexture } from 'pixi.js';
import { Texture } from 'pixi.js';

import {
  MATRIX_COLUMN_STAGGER_RANGE,
  MATRIX_FLICKER_FPS,
  MATRIX_FLICKER_VISIBILITY_THRESHOLD,
  MATRIX_HEAD_COLOR,
  MATRIX_SPRITE_COLS,
  MATRIX_SPRITE_ROWS,
  MATRIX_TRAIL_DIM_THRESHOLD,
  MATRIX_TRAIL_EMPTY_ALPHA,
  MATRIX_TRAIL_LENGTH,
  MATRIX_TRAIL_MID_THRESHOLD,
  MATRIX_TRAIL_OVERLAY_ALPHA,
  matrixGreenBright,
  matrixGreenDim,
  matrixGreenMid,
} from '../../constants.js';
import type { Character, SpriteData } from '../types.js';
import { MATRIX_EFFECT_DURATION } from '../types.js';

/** Hash-based flicker: ~70% visible for shimmer effect */
function flickerVisible(col: number, row: number, time: number): boolean {
  const t = Math.floor(time * MATRIX_FLICKER_FPS);
  const hash = (col * 7 + row * 13 + t * 31) & 0xff;
  return hash < MATRIX_FLICKER_VISIBILITY_THRESHOLD;
}

function generateSeeds(): number[] {
  const seeds: number[] = [];
  for (let i = 0; i < MATRIX_SPRITE_COLS; i++) {
    seeds.push(Math.random());
  }
  return seeds;
}

export { generateSeeds as matrixEffectSeeds };

let scratchCanvas: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;

function getScratch(): CanvasRenderingContext2D {
  if (!scratchCtx || !scratchCanvas) {
    scratchCanvas = document.createElement('canvas');
    scratchCanvas.width = MATRIX_SPRITE_COLS;
    scratchCanvas.height = MATRIX_SPRITE_ROWS;
    scratchCtx = scratchCanvas.getContext('2d')!;
  }
  scratchCtx.clearRect(0, 0, MATRIX_SPRITE_COLS, MATRIX_SPRITE_ROWS);
  return scratchCtx;
}

export interface MatrixEffectResult {
  texture: PixiTexture;
  /** Full (un-truncated) sprite height in world pixels — anchor the result
   *  at the sprite's TOP using this, not the texture's own (shorter)
   *  height, to keep the visible rows aligned with the normal sprite. */
  fullSpriteHeight: number;
}

/**
 * Render one frame of the Matrix spawn/despawn sweep for `ch` and upload it
 * as a Pixi Texture. Returns null if `ch` isn't mid-effect.
 */
export function renderMatrixEffect(
  ch: Character,
  spriteData: SpriteData,
): MatrixEffectResult | null {
  if (!ch.matrixEffect) return null;
  const ctx = getScratch();

  const progress = ch.matrixEffectTimer / MATRIX_EFFECT_DURATION;
  const isSpawn = ch.matrixEffect === 'spawn';
  const time = ch.matrixEffectTimer;
  const totalSweep = MATRIX_SPRITE_ROWS + MATRIX_TRAIL_LENGTH;

  for (let col = 0; col < MATRIX_SPRITE_COLS; col++) {
    const stagger = (ch.matrixEffectSeeds[col] ?? 0) * MATRIX_COLUMN_STAGGER_RANGE;
    const colProgress = Math.max(
      0,
      Math.min(1, (progress - stagger) / (1 - MATRIX_COLUMN_STAGGER_RANGE)),
    );
    const headRow = colProgress * totalSweep;

    for (let row = 0; row < MATRIX_SPRITE_ROWS; row++) {
      const pixel = spriteData[row]?.[col];
      const hasPixel = pixel && pixel !== '';
      const distFromHead = headRow - row;

      if (isSpawn) {
        if (distFromHead < 0) {
          continue;
        } else if (distFromHead < 1) {
          ctx.fillStyle = MATRIX_HEAD_COLOR;
          ctx.fillRect(col, row, 1, 1);
        } else if (distFromHead < MATRIX_TRAIL_LENGTH) {
          const trailPos = distFromHead / MATRIX_TRAIL_LENGTH;
          if (hasPixel) {
            ctx.fillStyle = pixel;
            ctx.fillRect(col, row, 1, 1);
            const greenAlpha = (1 - trailPos) * MATRIX_TRAIL_OVERLAY_ALPHA;
            if (flickerVisible(col, row, time)) {
              ctx.fillStyle = matrixGreenBright(greenAlpha);
              ctx.fillRect(col, row, 1, 1);
            }
          } else if (flickerVisible(col, row, time)) {
            const alpha = (1 - trailPos) * MATRIX_TRAIL_EMPTY_ALPHA;
            ctx.fillStyle =
              trailPos < MATRIX_TRAIL_MID_THRESHOLD
                ? matrixGreenBright(alpha)
                : trailPos < MATRIX_TRAIL_DIM_THRESHOLD
                  ? matrixGreenMid(alpha)
                  : matrixGreenDim(alpha);
            ctx.fillRect(col, row, 1, 1);
          }
        } else if (hasPixel) {
          ctx.fillStyle = pixel;
          ctx.fillRect(col, row, 1, 1);
        }
      } else {
        if (distFromHead < 0) {
          if (hasPixel) {
            ctx.fillStyle = pixel;
            ctx.fillRect(col, row, 1, 1);
          }
        } else if (distFromHead < 1) {
          ctx.fillStyle = MATRIX_HEAD_COLOR;
          ctx.fillRect(col, row, 1, 1);
        } else if (distFromHead < MATRIX_TRAIL_LENGTH && flickerVisible(col, row, time)) {
          const trailPos = distFromHead / MATRIX_TRAIL_LENGTH;
          const alpha = (1 - trailPos) * MATRIX_TRAIL_EMPTY_ALPHA;
          ctx.fillStyle =
            trailPos < MATRIX_TRAIL_MID_THRESHOLD
              ? matrixGreenBright(alpha)
              : trailPos < MATRIX_TRAIL_DIM_THRESHOLD
                ? matrixGreenMid(alpha)
                : matrixGreenDim(alpha);
          ctx.fillRect(col, row, 1, 1);
        }
        // Below trail: nothing (consumed)
      }
    }
  }

  // Texture.from() caches by canvas-resource identity — since the scratch
  // canvas is reused frame to frame, this may return the SAME Texture
  // instance repeatedly. `.source.update()` forces a GPU re-upload either
  // way (harmless no-op on a texture that's already current).
  const texture = Texture.from(scratchCanvas!);
  texture.source.scaleMode = 'nearest';
  texture.source.update();
  return { texture, fullSpriteHeight: spriteData.length };
}
