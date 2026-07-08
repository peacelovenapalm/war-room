/**
 * Small shared helpers for the per-entity-id Pixi sprite pools used across
 * pixiRenderer.ts, crisisEffects.ts, and matrixEffect.ts. Every pool is a
 * plain `Map<key, DisplayObject>` — get-or-create, mutate in place, then
 * sweep anything not touched this frame. No pool object owns its Map;
 * callers keep the Map in `PixiSpritePools` so it survives across frames.
 */
import type { Container, Sprite } from 'pixi.js';
import { Sprite as PixiSprite } from 'pixi.js';

/** Get the pooled sprite for `key`, creating (and adding to `layer`) one on
 *  first use. `init` runs once, only on creation (e.g. to set an anchor). */
export function pooledSprite<K>(
  pool: Map<K, Sprite>,
  layer: Container,
  key: K,
  init?: (sprite: Sprite) => void,
): Sprite {
  let sprite = pool.get(key);
  if (!sprite) {
    sprite = new PixiSprite();
    init?.(sprite);
    pool.set(key, sprite);
    layer.addChild(sprite);
  }
  return sprite;
}

/** Remove+drop any pooled entry whose key wasn't touched this frame. Pooled
 *  display objects are never `.destroy()`-ed here — most reference a
 *  SHARED, cached Texture (from getSpriteTexture), and destroying the
 *  local wrapper would destroy that shared GPU resource too — just detach
 *  it from the layer and let it be GC'd. */
export function sweepSpritePool<K, T extends Container>(
  pool: Map<K, T>,
  activeKeys: Set<K>,
  layer: Container,
): void {
  for (const [key, obj] of pool) {
    if (activeKeys.has(key)) continue;
    layer.removeChild(obj);
    pool.delete(key);
  }
}
