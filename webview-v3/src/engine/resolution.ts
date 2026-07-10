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
