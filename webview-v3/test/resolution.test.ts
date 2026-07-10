import { describe, expect, it } from 'vitest';

import { getCanvasResolution, MAX_CANVAS_RESOLUTION } from '../src/engine/resolution';

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
});
