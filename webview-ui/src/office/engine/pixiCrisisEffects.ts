/**
 * PixiJS rendering for the crisis & triage layer (v1 mechanic #1) — G0 port.
 * A separate file from `crisisEffects.ts`: the `WAR_ROOM_ENGINE` bisection
 * flag and the canvas `renderer.ts`/`gameLoop.ts` engine (task 10) are gone.
 * `crisisEffects.ts`'s `renderCrisisEffects` export is now dead code (zero
 * importers — superseded by this file's own `renderCrisisEffects`), left in
 * place because BUILD-PLAN.md §G0's task 10 file list names only
 * `renderer.ts`/`gameLoop.ts` for deletion.
 *
 * Draws the aging fire silhouettes (smoke → fire → alarm), debris piles and
 * extinguish steam at the affected desks as pooled Pixi Sprites in the
 * crisis layer, keyed by a stable per-effect string (mirrors how
 * characters/pets are keyed elsewhere) so sprites are reused frame to frame
 * instead of recreated. Pixel frames live in sprites/crisisSprites.ts;
 * animation is deterministic from wall-clock time + agent id (no RNG —
 * screenshots and tests stay reproducible). Same trigger API as the old
 * canvas version: called once per frame with the current crisis state.
 */
import type { Container, Sprite, Texture } from 'pixi.js';

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
import type { Character, SpriteData } from '../types.js';
import { pooledSprite, sweepSpritePool } from './spritePool.js';

const SMOKE_FRAME_MS = 320;
const FIRE_FRAME_MS = 160;
const BEACON_FLASH_MS = 450;
/** Horizontal offset from the character anchor — the fire burns AT the desk
 *  beside the sprite, so both stay readable. */
const CRISIS_OFFSET_X = -12;

function frameAt(frames: SpriteData[], now: number, periodMs: number, phase = 0): SpriteData {
  return frames[(Math.floor(now / periodMs) + phase) % frames.length];
}

function place(
  pool: Map<string, Sprite>,
  layer: Container,
  active: Set<string>,
  key: string,
  frame: SpriteData,
  wx: number,
  wy: number,
  alpha: number,
  resolveTexture: (sprite: SpriteData) => Texture,
): void {
  active.add(key);
  const sprite = pooledSprite(pool, layer, key, (s) => s.anchor.set(0.5, 1));
  sprite.texture = resolveTexture(frame);
  sprite.position.set(wx, wy);
  sprite.alpha = alpha;
  sprite.visible = true;
}

/**
 * Draw fires (aged per stage), debris piles, and extinguish steam into the
 * crisis layer. Called from renderFrame after bubbles so crises sit above
 * characters — same ordering the canvas version used.
 */
export function renderCrisisEffects(
  crisisLayer: Container,
  pool: Map<string, Sprite>,
  characters: Iterable<Character>,
  debris: Iterable<DebrisRecord>,
  effects: Iterable<ExtinguishEffect>,
  resolveTexture: (sprite: SpriteData) => Texture,
  now: number = Date.now(),
): void {
  const active = new Set<string>();

  for (const ch of characters) {
    if (!ch.crisis || ch.matrixEffect === 'despawn') continue;
    const stage = stageForAge(now - ch.crisis.since);
    const fx = ch.x + CRISIS_OFFSET_X;
    if (stage === 'smoke') {
      place(
        pool,
        crisisLayer,
        active,
        `smoke-${ch.id}`,
        frameAt(SMOKE_FRAMES, now, SMOKE_FRAME_MS, ch.id),
        fx,
        ch.y + 2,
        1,
        resolveTexture,
      );
    } else {
      // fire and alarm both burn; alarm adds the white flashing beacon above.
      place(
        pool,
        crisisLayer,
        active,
        `fire-${ch.id}`,
        frameAt(FIRE_FRAMES, now, FIRE_FRAME_MS, ch.id),
        fx,
        ch.y + 2,
        1,
        resolveTexture,
      );
      place(
        pool,
        crisisLayer,
        active,
        `smoke-${ch.id}`,
        frameAt(SMOKE_FRAMES, now, SMOKE_FRAME_MS, ch.id),
        fx,
        ch.y - 10,
        0.75,
        resolveTexture,
      );
      if (stage === 'alarm') {
        const beacon = frameAt([BEACON_ON, BEACON_OFF], now, BEACON_FLASH_MS, ch.id);
        place(
          pool,
          crisisLayer,
          active,
          `beacon-${ch.id}`,
          beacon,
          fx,
          ch.y - 22,
          1,
          resolveTexture,
        );
      }
    }
  }

  for (const d of debris) {
    place(
      pool,
      crisisLayer,
      active,
      `debris-${d.key}`,
      DEBRIS_SPRITE,
      d.x + CRISIS_OFFSET_X,
      d.y + 2,
      1,
      resolveTexture,
    );
  }

  let effectIdx = 0;
  for (const e of effects) {
    const t = (now - e.startedAt) / EXTINGUISH_DURATION_MS;
    effectIdx++;
    if (t < 0 || t >= 1) continue;
    const frame =
      STEAM_FRAMES[Math.min(STEAM_FRAMES.length - 1, Math.floor(t * STEAM_FRAMES.length))];
    // Steam rises as it fades.
    place(
      pool,
      crisisLayer,
      active,
      `steam-${effectIdx}`,
      frame,
      e.x + CRISIS_OFFSET_X,
      e.y + 2 - t * 8,
      1 - t * t,
      resolveTexture,
    );
  }

  sweepSpritePool(pool, active, crisisLayer);
}
