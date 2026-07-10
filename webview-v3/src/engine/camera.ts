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
