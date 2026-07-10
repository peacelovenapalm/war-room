/**
 * Camera — KICKOFF-v3.1 WS-A item (c).
 *
 * INVARIANT (MOBILE-FORENSICS constraint 1, binding; grep-guarded by
 * test/camera.test.ts and test/dprGuard.test.ts): default zoom and framing
 * are computed ONLY from canvas-CSS-size vs. map-world-size fit-to-view
 * math. The display-density global (DPR) must NEVER appear in this module,
 * not even in a comment — density is a GPU sampling concern
 * (engine/resolution.ts), zoom is a layout concern. The v2 mobile bug was
 * exactly this conflation, twice.
 *
 * All sizes here are CSS pixels; all world values are world pixels.
 * canvasPoint = worldPoint * zoom + offset.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CameraState {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 4;
/** CSS pixels of breathing room kept around the map at default framing. */
export const FIT_PADDING = 24;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Default framing: the whole world bounds fit inside the canvas with
 * FIT_PADDING, centered. Pure function of the two sizes — nothing else.
 */
export function fitToView(canvasCssSize: Size, world: Bounds, padding = FIT_PADDING): CameraState {
  const worldWidth = Math.max(1, world.maxX - world.minX);
  const worldHeight = Math.max(1, world.maxY - world.minY);
  const availWidth = Math.max(1, canvasCssSize.width - padding * 2);
  const availHeight = Math.max(1, canvasCssSize.height - padding * 2);
  const zoom = clampZoom(Math.min(availWidth / worldWidth, availHeight / worldHeight));
  const centerX = (world.minX + world.maxX) / 2;
  const centerY = (world.minY + world.maxY) / 2;
  return {
    zoom,
    offsetX: canvasCssSize.width / 2 - centerX * zoom,
    offsetY: canvasCssSize.height / 2 - centerY * zoom,
  };
}

export function worldToCanvas(
  camera: CameraState,
  worldX: number,
  worldY: number,
): { x: number; y: number } {
  return { x: worldX * camera.zoom + camera.offsetX, y: worldY * camera.zoom + camera.offsetY };
}

export function canvasToWorld(
  camera: CameraState,
  canvasX: number,
  canvasY: number,
): { x: number; y: number } {
  return {
    x: (canvasX - camera.offsetX) / camera.zoom,
    y: (canvasY - camera.offsetY) / camera.zoom,
  };
}

/** Pan by a CSS-pixel delta (drag). */
export function panBy(camera: CameraState, deltaX: number, deltaY: number): CameraState {
  return { ...camera, offsetX: camera.offsetX + deltaX, offsetY: camera.offsetY + deltaY };
}

/**
 * Zoom by `factor` keeping the world point under (canvasX, canvasY) fixed
 * (wheel / pinch anchor). Zoom stays clamped to [MIN_ZOOM, MAX_ZOOM].
 */
export function zoomAt(
  camera: CameraState,
  canvasX: number,
  canvasY: number,
  factor: number,
): CameraState {
  const zoom = clampZoom(camera.zoom * factor);
  const applied = zoom / camera.zoom;
  return {
    zoom,
    offsetX: canvasX - (canvasX - camera.offsetX) * applied,
    offsetY: canvasY - (canvasY - camera.offsetY) * applied,
  };
}

// ── Stage-4 pinch/pan bounds (WS-A item 4) ─────────────────────────
//
// KICKOFF-v3.1 mobile decision: "Restored pinch/pan — fit-to-view camera,
// zoom NEVER derived from DPR". Both functions below take ONLY
// canvasCssSize + world (the exact fitToView inputs) — never DPR, never a
// bare unrelated constant — so the interactive gesture range always tracks
// the actual map/canvas relationship instead of an arbitrary absolute
// number. camera.test.ts's GREP GUARD covers this whole file already.

/** How far past "whole map fits" a pinch may zoom OUT, and how far past
 *  the desk-focus zoom (focus.ts FOCUS_ZOOM_BOOST) it may zoom IN — both
 *  expressed as multiples of fit zoom, never as raw pixel/DPR numbers. */
const INTERACTIVE_ZOOM_OUT_MULTIPLE = 0.6;
const INTERACTIVE_ZOOM_IN_MULTIPLE = 4;

/**
 * Pinch zoom range for the current canvas/map pairing — derived from
 * fit-to-view math, not a fixed constant. Callers clamp `zoomAt` results
 * into this range (still inside the absolute [MIN_ZOOM, MAX_ZOOM] safety
 * net via clampZoom).
 */
export function interactiveZoomBounds(
  canvasCssSize: Size,
  world: Bounds,
): { min: number; max: number } {
  const fit = fitToView(canvasCssSize, world).zoom;
  return {
    min: clampZoom(fit * INTERACTIVE_ZOOM_OUT_MULTIPLE),
    max: clampZoom(fit * INTERACTIVE_ZOOM_IN_MULTIPLE),
  };
}

/** CSS px of world guaranteed to stay on-canvas at any pan extreme — a drag
 *  can never scroll the whole map off-screen with nothing to grab back. */
const PAN_KEEP_VISIBLE_PX = 48;

/**
 * Clamp a camera's pan offset to "fit-to-view bounds": when the world is
 * narrower/shorter than the canvas on an axis (fully visible already), that
 * axis is LOCKED to the centered fit framing — panning it would just be
 * dead space, so it isn't allowed to wander. Otherwise the offset is
 * clamped so at least PAN_KEEP_VISIBLE_PX of the map stays on-canvas.
 * Pure function of camera + canvas size + world bounds — never DPR.
 */
export function clampPanToFit(
  camera: CameraState,
  canvasCssSize: Size,
  world: Bounds,
): CameraState {
  const { zoom } = camera;
  const worldPxWidth = (world.maxX - world.minX) * zoom;
  const worldPxHeight = (world.maxY - world.minY) * zoom;
  const centerX = (world.minX + world.maxX) / 2;
  const centerY = (world.minY + world.maxY) / 2;

  let offsetX: number;
  if (worldPxWidth <= canvasCssSize.width) {
    offsetX = canvasCssSize.width / 2 - centerX * zoom;
  } else {
    const maxOffsetX = canvasCssSize.width - PAN_KEEP_VISIBLE_PX - world.minX * zoom;
    const minOffsetX = PAN_KEEP_VISIBLE_PX - world.maxX * zoom;
    offsetX = Math.min(maxOffsetX, Math.max(minOffsetX, camera.offsetX));
  }

  let offsetY: number;
  if (worldPxHeight <= canvasCssSize.height) {
    offsetY = canvasCssSize.height / 2 - centerY * zoom;
  } else {
    const maxOffsetY = canvasCssSize.height - PAN_KEEP_VISIBLE_PX - world.minY * zoom;
    const minOffsetY = PAN_KEEP_VISIBLE_PX - world.maxY * zoom;
    offsetY = Math.min(maxOffsetY, Math.max(minOffsetY, camera.offsetY));
  }

  return { zoom, offsetX, offsetY };
}
