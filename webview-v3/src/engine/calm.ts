/**
 * Calm-channel ambient lighting — KICKOFF-v3.1 WS-A item 4(c): "calm
 * channels (lighting lerp toward warm when board clears...) — all
 * bounded-theater compliant". Bounded theater (hard rule 6): the lerp is
 * capped at CALM_TRANSITION_MS (< the ~2s ceiling) and is PURE reinforcement
 * — the mood chip's shape+text ("✓ OFFICE: CALM" / "⚠ OFFICE: STRAINED (n)")
 * is the actual signal (state/hud.ts officeMood); this only tints the
 * canvas wash, never gates or delays anything real.
 */

import { easeInOut } from './focus';

/** Bounded-theater transition duration (hard rule 6: ≤ ~2s). */
export const CALM_TRANSITION_MS = 1_800;

export interface CalmTransition {
  /** Target warmth as of the last observed crisis count: 1 = calm/warm,
   *  0 = strained/cool. */
  target: number;
  /** Displayed warmth AT the moment `target` last changed — the eased
   *  transition's start point, so re-triggering mid-lerp never jumps. */
  from: number;
  changedAt: number;
}

/** Office starts calm (no crises observed yet) — matches officeMood's own
 *  "0 open crises = CALM" default. */
export const INITIAL_CALM: CalmTransition = { target: 1, from: 1, changedAt: 0 };

export function targetWarmth(openCrises: number): number {
  return openCrises === 0 ? 1 : 0;
}

/** Advance the transition when the observed crisis count changes the
 *  target — captures the CURRENTLY DISPLAYED value as the new start point.
 *  Same-target calls are a no-op (same reference back). */
export function updateCalmTransition(
  state: CalmTransition,
  openCrises: number,
  now: number,
): CalmTransition {
  const target = targetWarmth(openCrises);
  if (target === state.target) return state;
  return { target, from: displayedWarmth(state, now), changedAt: now };
}

/** Eased warmth in [0, 1] for display right now. */
export function displayedWarmth(state: CalmTransition, now: number): number {
  const t = Math.min(1, Math.max(0, (now - state.changedAt) / CALM_TRANSITION_MS));
  return state.from + (state.target - state.from) * easeInOut(t);
}
