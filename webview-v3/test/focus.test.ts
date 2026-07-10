import { describe, expect, it } from 'vitest';

import { fitToView, worldToCanvas } from '../src/engine/camera';
import {
  easeInOut,
  FOCUS_ANIM_MS,
  FOCUS_MAX_ZOOM,
  focusCamera,
  mixCamera,
  walkProgress,
} from '../src/engine/focus';
import { mapWorldBounds } from '../src/engine/iso';

const CSS = { width: 390, height: 280 };
const BOUNDS = mapWorldBounds(14, 10, 0);

describe('bounded theater (hard rule 6, WRITTEN INVARIANT)', () => {
  it('the camera walk is ≤ 2 seconds', () => {
    expect(FOCUS_ANIM_MS).toBeLessThanOrEqual(2_000);
  });
});

describe('focusCamera', () => {
  it('centers the desk in the canvas', () => {
    const fit = fitToView(CSS, BOUNDS);
    const target = { worldX: 64, worldY: 96 };
    const camera = focusCamera(CSS, target, fit);
    const projected = worldToCanvas(camera, target.worldX, target.worldY);
    expect(projected.x).toBeCloseTo(CSS.width / 2, 6);
    expect(projected.y).toBeCloseTo(CSS.height / 2, 6);
  });

  it('zooms in over the fit baseline but never past FOCUS_MAX_ZOOM', () => {
    const fit = fitToView(CSS, BOUNDS);
    const camera = focusCamera(CSS, { worldX: 0, worldY: 0 }, fit);
    expect(camera.zoom).toBeGreaterThan(fit.zoom);
    expect(camera.zoom).toBeLessThanOrEqual(FOCUS_MAX_ZOOM);

    const alreadyDeep = focusCamera(CSS, { worldX: 0, worldY: 0 }, { ...fit, zoom: 3 });
    expect(alreadyDeep.zoom).toBeLessThanOrEqual(3); // never zooms OUT past clamp order
  });
});

describe('mixCamera / easeInOut / walkProgress', () => {
  const from = { zoom: 1, offsetX: 0, offsetY: 0 };
  const to = { zoom: 2, offsetX: 100, offsetY: -50 };

  it('endpoints are exact', () => {
    expect(mixCamera(from, to, 0)).toEqual(from);
    expect(mixCamera(from, to, 1)).toEqual(to);
  });

  it('t is clamped — an overshooting RAF frame cannot fling the camera', () => {
    expect(mixCamera(from, to, 1.5)).toEqual(to);
    expect(mixCamera(from, to, -1)).toEqual(from);
  });

  it('easeInOut is monotonic with fixed endpoints', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    let previous = 0;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const value = easeInOut(t);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('walkProgress reaches 1 exactly at FOCUS_ANIM_MS and stays there', () => {
    expect(walkProgress(0, 0)).toBe(0);
    expect(walkProgress(0, FOCUS_ANIM_MS)).toBe(1);
    expect(walkProgress(0, FOCUS_ANIM_MS * 5)).toBe(1);
  });
});
