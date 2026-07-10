import { describe, expect, it, vi } from 'vitest';

import type { SpriteDef } from '../src/assets/manifest';
import { drawSprite } from '../src/engine/spriteRenderer';

const SPRITE: SpriteDef = {
  name: 'desk_monitor',
  size: [200, 140],
  anchor: [60, 100],
  rotations: ['S'],
  footprint: [1, 1],
  sheet: 0,
  frames: {
    S: { x: 683, y: 532, anchor: [748, 638.4] },
  },
};

function fakeCtx(): CanvasRenderingContext2D {
  return { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
}

describe('drawSprite', () => {
  it('draws at screenOf(tile) - anchor*scale, sized by size*scale', () => {
    const ctx = fakeCtx();
    const image = {} as CanvasImageSource;
    const ok = drawSprite(ctx, image, SPRITE, 'S', 0, 1000, 500, 0.5);
    expect(ok).toBe(true);
    expect(ctx.drawImage).toHaveBeenCalledWith(
      image,
      683,
      532, // source frame x,y
      200,
      140, // source frame w,h (unscaled — sheet px)
      1000 - 60 * 0.5, // dest x = worldX - anchor.x*scale
      500 - 100 * 0.5, // dest y = worldY - anchor.y*scale
      100, // dest w = size.w*scale
      70, // dest h = size.h*scale
    );
  });

  it('at scale 1, reduces to the reference drawSpriteFrame(worldX - anchor, worldY - anchor)', () => {
    const ctx = fakeCtx();
    const image = {} as CanvasImageSource;
    drawSprite(ctx, image, SPRITE, 'S', 0, 0, 0, 1);
    expect(ctx.drawImage).toHaveBeenCalledWith(image, 683, 532, 200, 140, -60, -100, 200, 140);
  });

  it('returns false and draws nothing when the sprite has no frame for the rotation', () => {
    const ctx = fakeCtx();
    const image = {} as CanvasImageSource;
    const result = drawSprite(ctx, image, { ...SPRITE, frames: {} }, 'S', 0, 0, 0, 1);
    expect(result).toBe(false);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
});
