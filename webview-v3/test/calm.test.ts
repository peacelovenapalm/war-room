import { describe, expect, it } from 'vitest';

import {
  CALM_TRANSITION_MS,
  displayedWarmth,
  INITIAL_CALM,
  targetWarmth,
  updateCalmTransition,
} from '../src/engine/calm';

describe('targetWarmth', () => {
  it('0 open crises -> warm (1)', () => {
    expect(targetWarmth(0)).toBe(1);
  });

  it('any open crisis -> cool (0)', () => {
    expect(targetWarmth(1)).toBe(0);
    expect(targetWarmth(5)).toBe(0);
  });
});

describe('updateCalmTransition', () => {
  it('same-target calls are a no-op (identical reference back)', () => {
    const state = updateCalmTransition(INITIAL_CALM, 0, 1_000);
    expect(state).toBe(INITIAL_CALM);
  });

  it('a crisis opening starts a transition FROM the currently displayed value', () => {
    const state = updateCalmTransition(INITIAL_CALM, 1, 1_000);
    expect(state.target).toBe(0);
    expect(state.from).toBe(1); // was fully warm, displayed value at t=1000 is still 1
    expect(state.changedAt).toBe(1_000);
  });

  it('re-triggering mid-transition captures the CURRENT eased value, not a jump back to the old target', () => {
    const opened = updateCalmTransition(INITIAL_CALM, 1, 0); // target 0, from 1, changedAt 0
    const midway = CALM_TRANSITION_MS / 2;
    const partial = displayedWarmth(opened, midway);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(1);
    // Crisis clears again before the transition finished.
    const reopened = updateCalmTransition(opened, 0, midway);
    expect(reopened.target).toBe(1);
    expect(reopened.from).toBeCloseTo(partial, 6);
    expect(reopened.changedAt).toBe(midway);
  });
});

describe('displayedWarmth', () => {
  it('clamps to [from, target] and never overshoots', () => {
    const state = updateCalmTransition(INITIAL_CALM, 1, 0);
    const beforeStart = displayedWarmth(state, -100);
    const atEnd = displayedWarmth(state, CALM_TRANSITION_MS);
    const wellPast = displayedWarmth(state, CALM_TRANSITION_MS * 10);
    expect(beforeStart).toBe(1);
    expect(atEnd).toBe(0);
    expect(wellPast).toBe(0);
  });

  it('is bounded by the hard-rule-6 ceiling: fully settled by CALM_TRANSITION_MS (< ~2s)', () => {
    expect(CALM_TRANSITION_MS).toBeLessThanOrEqual(2_000);
    const state = updateCalmTransition(INITIAL_CALM, 1, 0);
    expect(displayedWarmth(state, CALM_TRANSITION_MS)).toBe(state.target);
  });

  it('monotonic across the transition window for a cooling change', () => {
    const state = updateCalmTransition(INITIAL_CALM, 1, 0);
    const samples = [0, 200, 400, 900, 1_400, 1_800].map((t) => displayedWarmth(state, t));
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeLessThanOrEqual(samples[i - 1] + 1e-9);
    }
  });
});
