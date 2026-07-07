/**
 * Canvas rendering for the crisis & triage layer (v1 mechanic #1).
 *
 * Draws the aging fire silhouettes (smoke → fire → alarm), debris piles and
 * extinguish steam at the affected desks. Pixel frames live in
 * sprites/crisisSprites.ts; animation is deterministic from wall-clock time
 * + agent id (no RNG — screenshots and tests stay reproducible).
 */

import type { DebrisRecord, ExtinguishEffect } from '../crisis.js';
import { EXTINGUISH_DURATION_MS, stageForAge } from '../crisis.js';
import {
  BEACON_OFF,
  BEACON_ON,
  DEBRIS_SPRITE,
  FIRE_FRAMES,
  SMOKE_FRAMES,
  STEAM_FRAMES,
} from '../sprites/crisisSprites.js';
import { getCachedSprite } from '../sprites/index.js';
import type { Character, SpriteData } from '../types.js';

const SMOKE_FRAME_MS = 320;
const FIRE_FRAME_MS = 160;
const BEACON_FLASH_MS = 450;
/** Horizontal offset from the character anchor — the fire burns AT the desk
 *  beside the sprite, so both stay readable. */
const CRISIS_OFFSET_X = -12;

function frameAt(frames: SpriteData[], now: number, periodMs: number, phase = 0): SpriteData {
  return frames[(Math.floor(now / periodMs) + phase) % frames.length];
}

/** Blit a pixel frame anchored bottom-center at world (wx, wy). */
function blit(
  ctx: CanvasRenderingContext2D,
  frame: SpriteData,
  wx: number,
  wy: number,
  offsetX: number,
  offsetY: number,
  zoom: number,
  alpha = 1,
): void {
  const cached = getCachedSprite(frame, zoom);
  const x = Math.round(offsetX + wx * zoom - cached.width / 2);
  const y = Math.round(offsetY + wy * zoom - cached.height);
  if (alpha < 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(cached, x, y);
    ctx.restore();
  } else {
    ctx.drawImage(cached, x, y);
  }
}

/**
 * Draw fires (aged per stage), debris piles, and extinguish steam.
 * Called from renderFrame after bubbles so crises sit above characters.
 */
export function renderCrisisEffects(
  ctx: CanvasRenderingContext2D,
  characters: Iterable<Character>,
  debris: Iterable<DebrisRecord>,
  effects: Iterable<ExtinguishEffect>,
  offsetX: number,
  offsetY: number,
  zoom: number,
  now: number = Date.now(),
): void {
  for (const ch of characters) {
    if (!ch.crisis || ch.matrixEffect === 'despawn') continue;
    const stage = stageForAge(now - ch.crisis.since);
    const fx = ch.x + CRISIS_OFFSET_X;
    if (stage === 'smoke') {
      blit(
        ctx,
        frameAt(SMOKE_FRAMES, now, SMOKE_FRAME_MS, ch.id),
        fx,
        ch.y + 2,
        offsetX,
        offsetY,
        zoom,
      );
    } else {
      // fire and alarm both burn; alarm adds the white flashing beacon above.
      blit(
        ctx,
        frameAt(FIRE_FRAMES, now, FIRE_FRAME_MS, ch.id),
        fx,
        ch.y + 2,
        offsetX,
        offsetY,
        zoom,
      );
      blit(
        ctx,
        frameAt(SMOKE_FRAMES, now, SMOKE_FRAME_MS, ch.id),
        fx,
        ch.y - 10,
        offsetX,
        offsetY,
        zoom,
        0.75,
      );
      if (stage === 'alarm') {
        const beacon = frameAt([BEACON_ON, BEACON_OFF], now, BEACON_FLASH_MS, ch.id);
        blit(ctx, beacon, fx, ch.y - 22, offsetX, offsetY, zoom);
      }
    }
  }

  for (const d of debris) {
    blit(ctx, DEBRIS_SPRITE, d.x + CRISIS_OFFSET_X, d.y + 2, offsetX, offsetY, zoom);
  }

  for (const e of effects) {
    const t = (now - e.startedAt) / EXTINGUISH_DURATION_MS;
    if (t < 0 || t >= 1) continue;
    const frame =
      STEAM_FRAMES[Math.min(STEAM_FRAMES.length - 1, Math.floor(t * STEAM_FRAMES.length))];
    // Steam rises as it fades.
    blit(ctx, frame, e.x + CRISIS_OFFSET_X, e.y + 2 - t * 8, offsetX, offsetY, zoom, 1 - t * t);
  }
}
