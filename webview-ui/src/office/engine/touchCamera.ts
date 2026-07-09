// webview-ui/src/office/engine/touchCamera.ts
//
// Pure two-finger pinch/pan gesture math for the office canvas — extracted
// from OfficeCanvas.tsx's touch handlers (G0 task 9 pre-built the gesture
// recognizer itself; G6 pulls the math out so it's independently
// unit-testable, mirroring officeCanvasCursor.ts's pure-logic split).

export interface TouchPoint {
  x: number;
  y: number;
}

export interface TwoFingerGesture {
  midX: number;
  midY: number;
  dist: number;
}

/** Midpoint + spread of two active touch pointers. */
export function computeTwoFingerGesture([a, b]: [TouchPoint, TouchPoint]): TwoFingerGesture {
  return {
    midX: (a.x + b.x) / 2,
    midY: (a.y + b.y) / 2,
    dist: Math.hypot(a.x - b.x, a.y - b.y),
  };
}

/** Pan delta (device pixels) from two-finger midpoint movement between frames. */
export function computePinchPanDelta(
  prev: TwoFingerGesture,
  next: TwoFingerGesture,
  dpr: number,
): { dx: number; dy: number } {
  return { dx: (next.midX - prev.midX) * dpr, dy: (next.midY - prev.midY) * dpr };
}

/** Pinch distance ratio → discrete stepped zoom level, clamped to [min, max].
 *  Returns currentZoom unchanged if prevDist is non-positive (no gesture yet). */
export function computePinchZoomStep(
  prevDist: number,
  nextDist: number,
  currentZoom: number,
  min: number,
  max: number,
): number {
  if (prevDist <= 0) return currentZoom;
  const rawZoom = currentZoom * (nextDist / prevDist);
  return Math.round(Math.max(min, Math.min(max, rawZoom)));
}
