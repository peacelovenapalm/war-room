/**
 * Canvas backing-store resolution — KICKOFF-v3.1 WS-A item (d).
 *
 * THE ONLY PERMITTED devicePixelRatio READ IN webview-v3 (grep-guarded by
 * test/dprGuard.test.ts). Resolution is a GPU sampling density, capped at
 * 2 per MOBILE-FORENSICS constraint 2 (DPR-3 phones pay 9x fill rate for
 * no legible gain). It scales canvas.width/height ONLY — it must never
 * feed camera zoom, framing, or any layout value (constraint 1).
 */

export const MAX_CANVAS_RESOLUTION = 2;

/**
 * @param devicePixelRatioValue test seam; defaults to the live DPR.
 * @returns min(DPR, 2), with non-finite/non-positive input degrading to 1.
 */
export function getCanvasResolution(devicePixelRatioValue?: number): number {
  const raw =
    devicePixelRatioValue ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1);
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(raw, MAX_CANVAS_RESOLUTION);
}

export interface CanvasBackingSize {
  width: number;
  height: number;
}

export function canvasBackingSize(
  cssSize: CanvasBackingSize,
  resolution: number,
): CanvasBackingSize {
  return {
    width: Math.round(cssSize.width * resolution),
    height: Math.round(cssSize.height * resolution),
  };
}

/** Rebind a resolution media query whenever the display density changes.
 * Keeping the one live density read in this module preserves the camera's
 * strict separation from backing-store sampling. */
export function watchCanvasResolution(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  let media = window.matchMedia(`(resolution: ${String(window.devicePixelRatio)}dppx)`);
  const handleChange = () => {
    media.removeEventListener('change', handleChange);
    media = window.matchMedia(`(resolution: ${String(window.devicePixelRatio)}dppx)`);
    media.addEventListener('change', handleChange);
    onChange();
  };
  media.addEventListener('change', handleChange);
  return () => media.removeEventListener('change', handleChange);
}
