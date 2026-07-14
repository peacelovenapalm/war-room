import { describe, expect, it } from 'vitest';

import {
  canvasBackingSize,
  getCanvasResolution,
  MAX_CANVAS_RESOLUTION,
} from '../src/engine/resolution';

describe('canvas resolution cap (MOBILE-FORENSICS constraint 2)', () => {
  it('caps at 2', () => {
    expect(MAX_CANVAS_RESOLUTION).toBe(2);
    expect(getCanvasResolution(3)).toBe(2);
    expect(getCanvasResolution(2.5)).toBe(2);
    expect(getCanvasResolution(10)).toBe(2);
  });

  it('passes through densities at or below the cap', () => {
    expect(getCanvasResolution(1)).toBe(1);
    expect(getCanvasResolution(1.5)).toBe(1.5);
    expect(getCanvasResolution(2)).toBe(2);
  });

  it('degrades to 1 for degenerate input (no window in node)', () => {
    expect(getCanvasResolution(0)).toBe(1);
    expect(getCanvasResolution(-2)).toBe(1);
    expect(getCanvasResolution(Number.NaN)).toBe(1);
    // In this node test env there is no window: the default read is 1.
    expect(getCanvasResolution()).toBe(1);
  });

  it('derives stable integer backing dimensions from CSS size and resolution', () => {
    const first = canvasBackingSize({ width: 390.25, height: 664.25 }, 2);
    const repeated = canvasBackingSize({ width: 390.25, height: 664.25 }, 2);
    expect(first).toEqual({ width: 781, height: 1329 });
    expect(repeated).toEqual(first);
  });
});
