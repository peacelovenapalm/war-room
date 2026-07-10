import { describe, expect, it } from 'vitest';

import type { SpriteDef } from '../src/assets/manifest';
import {
  animationFrameIndex,
  frameCount,
  resolveFrame,
  spriteScaleFor,
} from '../src/engine/sprites';

const STATIC_SPRITE: SpriteDef = {
  name: 'desk_monitor',
  size: [206, 145],
  anchor: [65, 106.4],
  rotations: ['N', 'E', 'S', 'W'],
  footprint: [1, 1],
  sheet: 0,
  frames: {
    N: { x: 267, y: 532, anchor: [332, 638.4] },
    S: { x: 683, y: 532, anchor: [748, 638.4] },
  },
};

const ANIMATED_SPRITE: SpriteDef = {
  name: 'worker_teal.walk',
  size: [32, 48],
  anchor: [16, 44],
  rotations: ['S'],
  footprint: [1, 1],
  sheet: 1,
  fps: 8,
  frames: {
    S: [
      { x: 0, y: 0, anchor: [16, 44] },
      { x: 32, y: 0, anchor: [48, 44] },
      { x: 64, y: 0, anchor: [80, 44] },
      { x: 96, y: 0, anchor: [112, 44] },
    ],
  },
};

describe('resolveFrame', () => {
  it('returns the static frame rect for a given rotation', () => {
    expect(resolveFrame(STATIC_SPRITE, 'N')).toEqual({ x: 267, y: 532, anchor: [332, 638.4] });
  });

  it('indexes into an animated rotation array', () => {
    expect(resolveFrame(ANIMATED_SPRITE, 'S', 2)).toEqual({ x: 64, y: 0, anchor: [80, 44] });
  });

  it('falls back to frame 0 when frameIndex is out of range', () => {
    expect(resolveFrame(ANIMATED_SPRITE, 'S', 99)).toEqual({ x: 0, y: 0, anchor: [16, 44] });
  });

  it('falls back to the S rotation, then any rotation, when the requested one is missing', () => {
    expect(resolveFrame(STATIC_SPRITE, 'E')).toEqual({ x: 683, y: 532, anchor: [748, 638.4] });
    const noS: SpriteDef = { ...STATIC_SPRITE, frames: { W: STATIC_SPRITE.frames.N! } };
    expect(resolveFrame(noS, 'E')).toEqual(STATIC_SPRITE.frames.N);
  });

  it('returns null when the sprite has no frames at all', () => {
    expect(resolveFrame({ ...STATIC_SPRITE, frames: {} }, 'N')).toBeNull();
  });
});

describe('frameCount', () => {
  it('is 1 for a static rotation', () => {
    expect(frameCount(STATIC_SPRITE, 'N')).toBe(1);
  });
  it('is the array length for an animated rotation', () => {
    expect(frameCount(ANIMATED_SPRITE, 'S')).toBe(4);
  });
  it('is 0 for a rotation the sprite does not have', () => {
    expect(frameCount(STATIC_SPRITE, 'W')).toBe(0);
  });
});

describe('animationFrameIndex', () => {
  it('is always 0 for a static (no-fps) sprite', () => {
    expect(animationFrameIndex(STATIC_SPRITE, 'N', 123_456)).toBe(0);
  });

  it('cycles at the authored fps, looping over the frame count', () => {
    // 8fps -> 125ms/frame; frame 4 wraps back to 0 (4 frames authored).
    expect(animationFrameIndex(ANIMATED_SPRITE, 'S', 0)).toBe(0);
    expect(animationFrameIndex(ANIMATED_SPRITE, 'S', 125)).toBe(1);
    expect(animationFrameIndex(ANIMATED_SPRITE, 'S', 250)).toBe(2);
    expect(animationFrameIndex(ANIMATED_SPRITE, 'S', 500)).toBe(0);
  });
});

describe('spriteScaleFor', () => {
  it('is 0.5 for the real pipeline tilePx (128) against the engine tile grid (64)', () => {
    expect(spriteScaleFor(128, 64)).toBe(0.5);
  });
  it('degrades to 1 for a non-positive tilePx (defensive, never divide by zero)', () => {
    expect(spriteScaleFor(0, 64)).toBe(1);
    expect(spriteScaleFor(-4, 64)).toBe(1);
  });
});
