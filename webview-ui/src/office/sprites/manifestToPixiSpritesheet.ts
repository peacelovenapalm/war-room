/**
 * SpriteData → Pixi texture adapter (G0 engine swap).
 *
 * The existing sprite pipeline resolves every visual (characters, furniture,
 * bubbles, crisis frames) down to `SpriteData` — a 2D grid of hex color
 * strings, already colorized/hue-shifted at the JS level (see colorize.ts).
 * This module rasterizes a SpriteData grid onto an offscreen canvas ONCE at
 * native (1 world-pixel-per-cell) resolution and uploads it as a Pixi
 * Texture with nearest-neighbor sampling — Pixi/GPU scaling (via the
 * worldContainer's zoom transform) then keeps it crisp at any zoom level,
 * replacing the old per-zoom-level HTMLCanvasElement cache in spriteCache.ts.
 *
 * This IS the Pixi-native recolor strategy required before the old
 * pngDecoder/colorize canvas path can ever be retired (GAME-DESIGN §8.1/
 * §9.14): each distinct hue-shifted SpriteData object already gets its own
 * cached texture here — a one-time render-to-texture per variant.
 */
import { Texture } from 'pixi.js';

import type { SpriteData } from '../types.js';

const textureCache = new WeakMap<SpriteData, Texture>();
/** Side registry so hygiene calls can explicitly release GPU memory —
 *  WeakMap alone never fires when a SpriteData source array is replaced. */
const liveTextures = new Set<Texture>();

function rasterize(sprite: SpriteData): HTMLCanvasElement {
  const rows = sprite.length;
  const cols = rows > 0 ? sprite[0].length : 0;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, cols);
  canvas.height = Math.max(1, rows);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const color = sprite[r][c];
      if (color === '') continue;
      ctx.fillStyle = color;
      ctx.fillRect(c, r, 1, 1);
    }
  }
  return canvas;
}

/** Get (or lazily create) a cached Pixi Texture for a SpriteData grid. */
export function getSpriteTexture(sprite: SpriteData): Texture {
  const cached = textureCache.get(sprite);
  if (cached && !cached.destroyed) return cached;

  const canvas = rasterize(sprite);
  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'nearest';
  textureCache.set(sprite, texture);
  liveTextures.add(texture);
  return texture;
}

/** Release every cached GPU texture (call when a template set is replaced —
 *  character/floor/wall/pet reload — so old variants don't leak VRAM). */
export function disposeSpriteTextureCache(): void {
  for (const texture of liveTextures) {
    if (!texture.destroyed) texture.destroy(true);
  }
  liveTextures.clear();
  // textureCache (WeakMap) entries pointing at destroyed textures are
  // harmless — getSpriteTexture's `!cached.destroyed` guard rebuilds them.
}
