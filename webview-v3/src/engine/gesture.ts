/**
 * Touch pinch/pan gesture reducer — KICKOFF-v3.1 WS-A item 4 ("Restored
 * pinch/pan — fit-to-view camera, zoom NEVER derived from DPR").
 *
 * Pure pointer-event bookkeeping: no DOM here, so the whole gesture math is
 * unit-testable with plain point objects. The caller (App.tsx) wires native
 * pointer events to pointerDown/pointerMove/pointerUp and applies the
 * returned CameraState. Momentum/inertia after release is explicitly OUT
 * of scope this stage (KICKOFF-v3.1 item (a): "momentum optional") — a
 * release just stops updating the camera, which is a legitimate, honest
 * "no theater" choice, not a missing feature silently swallowed.
 *
 * One pointer = pan (centroid delta). Two-or-more pointers = pinch zoom
 * (distance ratio between the first two, anchored at the centroid) PLUS
 * pan (centroid delta), matching standard touch-map gesture grammar. Both
 * are clamped every frame via camera.ts's interactiveZoomBounds +
 * clampPanToFit — never DPR (this file never reads it; dprGuard.test.ts
 * covers the whole src tree, including this one).
 */

import {
  type Bounds,
  type CameraState,
  clampPanToFit,
  interactiveZoomBounds,
  panBy,
  type Size,
  zoomAt,
} from './camera';

export interface GesturePoint {
  id: number;
  x: number;
  y: number;
}

export interface GestureState {
  pointers: ReadonlyMap<number, GesturePoint>;
  /** Distance between the first two active pointers, or null (<2 active). */
  lastDistance: number | null;
  /** Centroid of all active pointers, or null (0 active). */
  lastCentroid: { x: number; y: number } | null;
}

export const EMPTY_GESTURE: GestureState = {
  pointers: new Map(),
  lastDistance: null,
  lastCentroid: null,
};

function centroid(points: readonly GesturePoint[]): { x: number; y: number } {
  const x = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const y = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  return { x, y };
}

function distance(a: GesturePoint, b: GesturePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function deriveFromPointers(pointers: ReadonlyMap<number, GesturePoint>): {
  lastDistance: number | null;
  lastCentroid: { x: number; y: number } | null;
} {
  const points = [...pointers.values()];
  if (points.length === 0) return { lastDistance: null, lastCentroid: null };
  return {
    lastDistance: points.length >= 2 ? distance(points[0], points[1]) : null,
    lastCentroid: centroid(points),
  };
}

/** A finger/pointer touched down. Re-baselines centroid/distance so the
 *  NEXT move computes a delta from this instant (never a jump from stale
 *  history). */
export function gesturePointerDown(state: GestureState, point: GesturePoint): GestureState {
  const pointers = new Map(state.pointers);
  pointers.set(point.id, point);
  return { pointers, ...deriveFromPointers(pointers) };
}

/** A finger/pointer lifted or was cancelled. */
export function gesturePointerUp(state: GestureState, id: number): GestureState {
  if (!state.pointers.has(id)) return state;
  const pointers = new Map(state.pointers);
  pointers.delete(id);
  return { pointers, ...deriveFromPointers(pointers) };
}

export interface GestureMoveResult {
  state: GestureState;
  /** Updated camera, or null when this move can't produce a delta yet
   *  (e.g. the pointer wasn't tracked, or this is the first sample after a
   *  pointer count change and there's no prior centroid to diff against). */
  camera: CameraState | null;
}

/**
 * Apply one pointermove sample. `camera` is the CURRENT camera (already
 * clamped from the previous call); `canvasCssSize`/`world` are the same
 * fit-to-view inputs used everywhere else (never DPR).
 */
export function gesturePointerMove(
  state: GestureState,
  point: GesturePoint,
  camera: CameraState,
  canvasCssSize: Size,
  world: Bounds,
): GestureMoveResult {
  if (!state.pointers.has(point.id)) return { state, camera: null };

  const pointers = new Map(state.pointers);
  pointers.set(point.id, point);
  const points = [...pointers.values()];
  const nextCentroid = centroid(points);

  let next = camera;
  let moved = false;

  if (points.length >= 2) {
    const dist = distance(points[0], points[1]);
    if (state.lastDistance !== null && state.lastDistance > 0) {
      const bounds = interactiveZoomBounds(canvasCssSize, world);
      // Clamp the TARGET zoom first, then re-derive the factor that lands
      // exactly on it, so zoomAt computes offsets anchored for the zoom we
      // actually end up at — not offsets anchored for the raw (unclamped)
      // zoom with only the `.zoom` number swapped out after the fact (that
      // left the anchor point jumping the instant a pinch crossed a bound).
      const rawFactor = dist / state.lastDistance;
      const targetZoom = Math.min(bounds.max, Math.max(bounds.min, camera.zoom * rawFactor));
      const clampedFactor = camera.zoom > 0 ? targetZoom / camera.zoom : 1;
      next = zoomAt(camera, nextCentroid.x, nextCentroid.y, clampedFactor);
      moved = true;
    }
    if (state.lastCentroid) {
      next = panBy(
        next,
        nextCentroid.x - state.lastCentroid.x,
        nextCentroid.y - state.lastCentroid.y,
      );
      moved = true;
    }
    if (moved) next = clampPanToFit(next, canvasCssSize, world);
    return {
      state: { pointers, lastDistance: dist, lastCentroid: nextCentroid },
      camera: moved ? next : null,
    };
  }

  if (state.lastCentroid) {
    next = clampPanToFit(
      panBy(camera, nextCentroid.x - state.lastCentroid.x, nextCentroid.y - state.lastCentroid.y),
      canvasCssSize,
      world,
    );
    moved = true;
  }
  return {
    state: { pointers, lastDistance: null, lastCentroid: nextCentroid },
    camera: moved ? next : null,
  };
}
