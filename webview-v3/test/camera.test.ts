import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  canvasToWorld,
  clampZoom,
  fitToView,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  worldToCanvas,
  zoomAt,
} from '../src/engine/camera';
import { mapWorldBounds } from '../src/engine/iso';

const PHONE = { width: 390, height: 664 };
const DESKTOP = { width: 1280, height: 800 };

describe('fit-to-view camera', () => {
  it('GREP GUARD: camera module source never references devicePixelRatio', () => {
    // MOBILE-FORENSICS constraint 1 (binding): zoom/framing must never be
    // derived from DPR. The v2 mobile blank-canvas bug was this conflation.
    const source = readFileSync(
      fileURLToPath(new URL('../src/engine/camera.ts', import.meta.url)),
      'utf8',
    );
    expect(source.includes('devicePixelRatio')).toBe(false);
  });

  it('frames the whole default map inside a 390x664 phone canvas', () => {
    const bounds = mapWorldBounds(14, 10);
    const camera = fitToView(PHONE, bounds);
    for (const [x, y] of [
      [bounds.minX, bounds.minY],
      [bounds.maxX, bounds.minY],
      [bounds.minX, bounds.maxY],
      [bounds.maxX, bounds.maxY],
    ]) {
      const point = worldToCanvas(camera, x, y);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(PHONE.width);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(PHONE.height);
    }
  });

  it('centers the map (symmetric slack on both axes)', () => {
    const bounds = mapWorldBounds(14, 10);
    const camera = fitToView(DESKTOP, bounds);
    const topLeft = worldToCanvas(camera, bounds.minX, bounds.minY);
    const bottomRight = worldToCanvas(camera, bounds.maxX, bounds.maxY);
    expect(topLeft.x).toBeCloseTo(DESKTOP.width - bottomRight.x, 6);
    expect(topLeft.y).toBeCloseTo(DESKTOP.height - bottomRight.y, 6);
  });

  it('is a pure function of canvas size vs map size — same inputs, same camera', () => {
    const bounds = mapWorldBounds(14, 10);
    expect(fitToView(PHONE, bounds)).toEqual(fitToView(PHONE, bounds));
  });

  it('scales zoom with canvas size, never with anything else', () => {
    const bounds = mapWorldBounds(14, 10);
    const small = fitToView(PHONE, bounds);
    const large = fitToView({ width: PHONE.width * 2, height: PHONE.height * 2 }, bounds);
    // Padding is absolute, so doubling the canvas slightly MORE than
    // doubles the available area; zoom must grow at least proportionally.
    expect(large.zoom).toBeGreaterThanOrEqual(small.zoom * 2);
  });

  it('clamps zoom into [MIN_ZOOM, MAX_ZOOM] and rejects degenerate values', () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(-3)).toBe(MIN_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(MIN_ZOOM);
    expect(clampZoom(999)).toBe(MAX_ZOOM);
    expect(clampZoom(1)).toBe(1);
    // Tiny map on a huge canvas: fit zoom is clamped, not infinite.
    const camera = fitToView({ width: 4000, height: 4000 }, mapWorldBounds(1, 1));
    expect(camera.zoom).toBeLessThanOrEqual(MAX_ZOOM);
  });

  it('worldToCanvas and canvasToWorld are inverse', () => {
    const camera = fitToView(PHONE, mapWorldBounds(14, 10));
    const point = worldToCanvas(camera, 123.5, -47.25);
    const back = canvasToWorld(camera, point.x, point.y);
    expect(back.x).toBeCloseTo(123.5, 8);
    expect(back.y).toBeCloseTo(-47.25, 8);
  });

  it('panBy shifts framing without touching zoom', () => {
    const camera = fitToView(PHONE, mapWorldBounds(14, 10));
    const panned = panBy(camera, 10, -20);
    expect(panned.zoom).toBe(camera.zoom);
    expect(panned.offsetX).toBe(camera.offsetX + 10);
    expect(panned.offsetY).toBe(camera.offsetY - 20);
  });

  it('zoomAt keeps the anchor point fixed and clamps', () => {
    const camera = fitToView(PHONE, mapWorldBounds(14, 10));
    const anchor = { x: 100, y: 200 };
    const anchorWorld = canvasToWorld(camera, anchor.x, anchor.y);
    const zoomed = zoomAt(camera, anchor.x, anchor.y, 1.5);
    expect(zoomed.zoom).toBeCloseTo(clampZoom(camera.zoom * 1.5), 10);
    const anchorAfter = worldToCanvas(zoomed, anchorWorld.x, anchorWorld.y);
    expect(anchorAfter.x).toBeCloseTo(anchor.x, 6);
    expect(anchorAfter.y).toBeCloseTo(anchor.y, 6);
    // Clamped at the ceiling: factor beyond MAX_ZOOM is a no-op past the cap.
    const maxed = zoomAt({ ...camera, zoom: MAX_ZOOM }, anchor.x, anchor.y, 10);
    expect(maxed.zoom).toBe(MAX_ZOOM);
  });
});
