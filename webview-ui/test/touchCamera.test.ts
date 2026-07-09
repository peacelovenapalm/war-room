/**
 * Unit tests for the pure two-finger pinch/pan gesture math (touchCamera.ts).
 *
 * Run with: npm test
 */

import assert from 'node:assert/strict';

import { test } from 'vitest';

import {
  computePinchPanDelta,
  computePinchZoomStep,
  computeTwoFingerGesture,
} from '../src/office/engine/touchCamera.js';

// ── computeTwoFingerGesture ──────────────────────────────────────

test('computeTwoFingerGesture: midpoint and distance of two points', () => {
  const g = computeTwoFingerGesture([
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ]);
  assert.equal(g.midX, 50);
  assert.equal(g.midY, 0);
  assert.equal(g.dist, 100);
});

test('computeTwoFingerGesture: order-independent (a,b vs b,a give the same result)', () => {
  const g1 = computeTwoFingerGesture([
    { x: 10, y: 20 },
    { x: 40, y: 60 },
  ]);
  const g2 = computeTwoFingerGesture([
    { x: 40, y: 60 },
    { x: 10, y: 20 },
  ]);
  assert.deepEqual(g1, g2);
});

// ── computePinchPanDelta ─────────────────────────────────────────

test('computePinchPanDelta: midpoint movement scaled by dpr', () => {
  const prev = { midX: 100, midY: 100, dist: 50 };
  const next = { midX: 110, midY: 90, dist: 50 };
  const { dx, dy } = computePinchPanDelta(prev, next, 2);
  assert.equal(dx, 20); // (110-100) * 2
  assert.equal(dy, -20); // (90-100) * 2
});

test('computePinchPanDelta: no movement yields zero delta', () => {
  const g = { midX: 5, midY: 5, dist: 10 };
  const { dx, dy } = computePinchPanDelta(g, g, 1);
  assert.equal(dx, 0);
  assert.equal(dy, 0);
});

// ── computePinchZoomStep ──────────────────────────────────────────

test('computePinchZoomStep: fingers spreading apart zooms in, rounded to an integer step', () => {
  const z = computePinchZoomStep(100, 150, 4, 1, 10);
  assert.equal(z, 6); // round(4 * 1.5)
});

test('computePinchZoomStep: fingers pinching together zooms out', () => {
  const z = computePinchZoomStep(100, 50, 4, 1, 10);
  assert.equal(z, 2); // round(4 * 0.5)
});

test('computePinchZoomStep: clamps to max', () => {
  const z = computePinchZoomStep(10, 1000, 4, 1, 10);
  assert.equal(z, 10);
});

test('computePinchZoomStep: clamps to min', () => {
  const z = computePinchZoomStep(1000, 10, 4, 1, 10);
  assert.equal(z, 1);
});

test('computePinchZoomStep: non-positive prevDist (gesture not yet established) returns currentZoom unchanged', () => {
  assert.equal(computePinchZoomStep(0, 50, 4, 1, 10), 4);
  assert.equal(computePinchZoomStep(-5, 50, 4, 1, 10), 4);
});
