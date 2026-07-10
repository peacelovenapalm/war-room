import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { canvasToWorld, fitToView, interactiveZoomBounds, MAX_ZOOM } from '../src/engine/camera';
import {
  EMPTY_GESTURE,
  gesturePointerDown,
  gesturePointerMove,
  gesturePointerUp,
  type GestureState,
} from '../src/engine/gesture';
import { mapWorldBounds } from '../src/engine/iso';

const PHONE = { width: 390, height: 664 };

describe('pinch/pan gesture reducer', () => {
  it('GREP GUARD: gesture module source never references devicePixelRatio', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/engine/gesture.ts', import.meta.url)),
      'utf8',
    );
    expect(source.includes('devicePixelRatio')).toBe(false);
  });

  it('one pointer pans by the raw drag delta (clamped)', () => {
    const bounds = mapWorldBounds(14, 10);
    // A small square canvas at MAX_ZOOM: the map vastly exceeds the canvas
    // on BOTH axes, so a small drag centered on the map stays well inside
    // the pan clamp on both axes (unlike a phone-shaped canvas, where the
    // map's short axis can still fit fully even at high zoom).
    const CANVAS = { width: 200, height: 200 };
    const zoom = MAX_ZOOM;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const zoomedIn = {
      zoom,
      offsetX: CANVAS.width / 2 - centerX * zoom,
      offsetY: CANVAS.height / 2 - centerY * zoom,
    };
    let gesture = gesturePointerDown(EMPTY_GESTURE, { id: 1, x: 100, y: 100 });
    const result = gesturePointerMove(gesture, { id: 1, x: 130, y: 90 }, zoomedIn, CANVAS, bounds);
    expect(result.camera).not.toBeNull();
    // Small drag, well inside the clamp: exact delta applied.
    expect(result.camera!.offsetX).toBeCloseTo(zoomedIn.offsetX + 30, 6);
    expect(result.camera!.offsetY).toBeCloseTo(zoomedIn.offsetY - 10, 6);
    expect(result.camera!.zoom).toBe(zoomedIn.zoom);
    gesture = result.state;
    expect(gesture.pointers.size).toBe(1);
  });

  it('an untracked pointer id produces no camera change', () => {
    const bounds = mapWorldBounds(14, 10);
    const fit = fitToView(PHONE, bounds);
    const result = gesturePointerMove(EMPTY_GESTURE, { id: 9, x: 1, y: 1 }, fit, PHONE, bounds);
    expect(result.camera).toBeNull();
  });

  it('a zero-delta move after pointer-down reproduces the SAME camera — no synthetic jump', () => {
    const bounds = mapWorldBounds(14, 10);
    const fit = fitToView(PHONE, bounds);
    // Two fingers touch down; one "moves" back to its own down position —
    // distance and centroid are unchanged, so the result must equal `fit`
    // exactly, not drift from floating-point or a phantom initial delta.
    let gesture = gesturePointerDown(EMPTY_GESTURE, { id: 1, x: 100, y: 100 });
    gesture = gesturePointerDown(gesture, { id: 2, x: 200, y: 100 });
    const result = gesturePointerMove(gesture, { id: 1, x: 100, y: 100 }, fit, PHONE, bounds);
    expect(result.camera).toEqual(fit);
  });

  it('two pointers pinching apart zoom in, anchored near the centroid', () => {
    const bounds = mapWorldBounds(14, 10);
    const fit = fitToView(PHONE, bounds);
    let gesture: GestureState = gesturePointerDown(EMPTY_GESTURE, { id: 1, x: 150, y: 300 });
    gesture = gesturePointerDown(gesture, { id: 2, x: 250, y: 300 });
    // Distance was 100; spread to 200 -> factor 2x, clamped into bounds.
    const moved1 = gesturePointerMove(gesture, { id: 1, x: 100, y: 300 }, fit, PHONE, bounds);
    expect(moved1.camera).not.toBeNull();
    const moved2 = gesturePointerMove(
      moved1.state,
      { id: 2, x: 300, y: 300 },
      moved1.camera!,
      PHONE,
      bounds,
    );
    expect(moved2.camera).not.toBeNull();
    expect(moved2.camera!.zoom).toBeGreaterThan(fit.zoom);
  });

  it('two pointers pinching together zoom out, clamped to interactiveZoomBounds (never below it)', () => {
    const bounds = mapWorldBounds(14, 10);
    const zoomedIn = { zoom: fitToView(PHONE, bounds).zoom * 3, offsetX: 0, offsetY: 0 };
    let gesture: GestureState = gesturePointerDown(EMPTY_GESTURE, { id: 1, x: 100, y: 300 });
    gesture = gesturePointerDown(gesture, { id: 2, x: 300, y: 300 });
    // Distance 200 -> squeeze toward 1px repeatedly: factor keeps shrinking,
    // but the clamp inside gesturePointerMove must hold the floor.
    let camera = zoomedIn;
    let state = gesture;
    for (let i = 0; i < 6; i++) {
      const result = gesturePointerMove(
        state,
        { id: 1, x: 150 + i, y: 300 },
        camera,
        PHONE,
        bounds,
      );
      if (result.camera) camera = result.camera;
      state = result.state;
    }
    const bound = fitToView(PHONE, bounds).zoom * 0.6; // matches camera.ts multiple
    expect(camera.zoom).toBeGreaterThanOrEqual(bound - 1e-6);
  });

  it('a clamped pinch zoom keeps the world point under the centroid anchored (no jump when the bound fires)', () => {
    const bounds = mapWorldBounds(14, 10);
    const fit = fitToView(PHONE, bounds);
    const zoomBounds = interactiveZoomBounds(PHONE, bounds);
    // Start just under the interactive zoom-IN ceiling, framed like fitToView
    // so clampPanToFit's offset window is wide open (not the constraint under
    // test — see the "anchored" invariant below).
    const camera = { zoom: zoomBounds.max * 0.9, offsetX: fit.offsetX, offsetY: fit.offsetY };
    // Hand-built GestureState (a plain data type, legitimate to construct
    // directly) with lastCentroid pre-set to the centroid THIS move will
    // land on — isolates the zoom-clamp anchor math from panBy's separate,
    // orthogonal centroid-translation step (panBy(next, 0, 0) is a no-op),
    // matching the module's own "reproduces the SAME camera" zero-delta
    // pattern above.
    const anchorCentroid = { x: (10 + 240) / 2, y: 300 };
    const gesture: GestureState = {
      pointers: new Map([
        [1, { id: 1, x: 150, y: 300 }],
        [2, { id: 2, x: 240, y: 300 }],
      ]),
      lastDistance: 90,
      lastCentroid: anchorCentroid,
    };

    // Pointer 1 jumps far away: distance 90 -> 230, a factor that pushes the
    // RAW (unclamped) target zoom well past zoomBounds.max, guaranteeing the
    // clamp branch fires.
    const result = gesturePointerMove(gesture, { id: 1, x: 10, y: 300 }, camera, PHONE, bounds);
    expect(result.camera).not.toBeNull();
    expect(result.camera!.zoom).toBeCloseTo(zoomBounds.max, 6); // confirms the clamp fired

    // zoomAt's whole contract is "the world point under the anchor
    // (canvasX,canvasY) stays fixed" — that must still hold for whatever
    // zoom the clamp actually lands on, not just the raw unclamped one.
    const worldBefore = canvasToWorld(camera, anchorCentroid.x, anchorCentroid.y);
    const worldAfter = canvasToWorld(result.camera!, anchorCentroid.x, anchorCentroid.y);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 3);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 3);
  });

  it('lifting one finger of a pinch drops back to single-pointer pan without a jump', () => {
    const bounds = mapWorldBounds(14, 10);
    const fit = fitToView(PHONE, bounds);
    let gesture: GestureState = gesturePointerDown(EMPTY_GESTURE, { id: 1, x: 100, y: 300 });
    gesture = gesturePointerDown(gesture, { id: 2, x: 300, y: 300 });
    gesture = gesturePointerUp(gesture, 2);
    expect(gesture.pointers.size).toBe(1);
    expect(gesture.lastDistance).toBeNull();
    const result = gesturePointerMove(gesture, { id: 1, x: 120, y: 300 }, fit, PHONE, bounds);
    expect(result.camera).not.toBeNull();
    expect(result.camera!.zoom).toBe(fit.zoom); // single-pointer move never changes zoom
  });

  it('pointerUp on an untracked id is a no-op (same state reference)', () => {
    const state = gesturePointerUp(EMPTY_GESTURE, 42);
    expect(state).toBe(EMPTY_GESTURE);
  });
});
