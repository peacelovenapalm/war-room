/**
 * Camera desk-walk (board ▸ DESK verb) — a bounded-theater camera move
 * (KICKOFF-v3.1 hard rule 6, WRITTEN INVARIANT: ≤ ~2s, never delays real
 * state). The walk is pure view interpolation between two fit-to-view-
 * derived cameras; the drawer and board update from live state the moment
 * the verb fires, regardless of where the camera is mid-walk.
 *
 * Same containment as camera.ts: everything here is CSS-size / world-size
 * math. Display density NEVER appears (test/dprGuard.test.ts).
 */

import { type CameraState, clampZoom, type Size } from './camera';
import type { WorldPoint } from './iso';

/** Walk duration — hard-rule-6 bound asserted by test/focus.test.ts. */
export const FOCUS_ANIM_MS = 600;

/** Zoom-in factor over the fit-to-view baseline when walking to a desk. */
export const FOCUS_ZOOM_BOOST = 2.5;
/** Never zoom past this while focusing (desk legibility, not microscopy). */
export const FOCUS_MAX_ZOOM = 2;

/** Camera centered on `target` at a boosted (still clamped) zoom. */
export function focusCamera(
  canvasCssSize: Size,
  target: WorldPoint,
  fit: CameraState,
): CameraState {
  const zoom = clampZoom(Math.min(FOCUS_MAX_ZOOM, Math.max(fit.zoom, fit.zoom * FOCUS_ZOOM_BOOST)));
  return {
    zoom,
    offsetX: canvasCssSize.width / 2 - target.worldX * zoom,
    offsetY: canvasCssSize.height / 2 - target.worldY * zoom,
  };
}

/** Quadratic ease-in-out. */
export function easeInOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5 ? 2 * clamped * clamped : 1 - (-2 * clamped + 2) ** 2 / 2;
}

/** Linear camera mix (short walks — a straight blend reads fine). */
export function mixCamera(from: CameraState, to: CameraState, t: number): CameraState {
  const clamped = Math.min(1, Math.max(0, t));
  return {
    zoom: from.zoom + (to.zoom - from.zoom) * clamped,
    offsetX: from.offsetX + (to.offsetX - from.offsetX) * clamped,
    offsetY: from.offsetY + (to.offsetY - from.offsetY) * clamped,
  };
}

/** Raw animation progress in [0, 1] for a walk started at `startTs`. */
export function walkProgress(startTs: number, now: number): number {
  return Math.min(1, Math.max(0, (now - startTs) / FOCUS_ANIM_MS));
}
