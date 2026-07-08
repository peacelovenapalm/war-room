/**
 * Employee mood -> office-sprite visuals (G1 task 12, GAME-DESIGN §4.5).
 *
 * Pure functions only — no rendering, no state mutation beyond what
 * characters.ts already owns. `moodBand` mirrors core/src/quips.ts's
 * mood-band thresholds so the same mood value always reads the same way
 * across the quip system and the office sprite. A low-mood employee's
 * character walks slower (multiplies the existing per-frame walk-speed
 * constant) and, while idle, holds a droop pose — reusing an existing
 * walk-cycle frame (no new art exists yet; that's G5 territory) rather
 * than inventing a sprite.
 */

import type { Character } from './types.js';
import { CharacterState } from './types.js';

export type MoodBand = 'low' | 'neutral' | 'high';

export function moodBand(mood: number): MoodBand {
  if (mood < 35) return 'low';
  if (mood >= 70) return 'high';
  return 'neutral';
}

/** Not specified numerically by GAME-DESIGN — a documented judgment call:
 *  noticeably slower without feeling broken. */
export const MOOD_SPEED_MULTIPLIER_BURNED_OUT = 0.6;

/** Walk-speed multiplier for a character's CURRENT mood band. 1 = no effect
 *  (also the default for characters with no mood data, e.g. non-employee
 *  or pre-G1 sessions — absence of mood data must never slow anyone down). */
export function moodSpeedMultiplier(moodBandValue: MoodBand | undefined): number {
  return moodBandValue === 'low' ? MOOD_SPEED_MULTIPLIER_BURNED_OUT : 1;
}

/** The idle-transition state a character should enter, given its current
 *  mood band — CharacterState.BURNED_OUT for low mood, CharacterState.IDLE
 *  otherwise. Callers substitute this for a hardcoded `CharacterState.IDLE`
 *  assignment at every idle-transition site; behavior (pathing, seat logic)
 *  stays identical between the two states in the main update switch — this
 *  is a rendering tag on top of the existing idle transition, not a
 *  parallel state machine. */
export function idleStateFor(ch: Pick<Character, 'moodBand'>): CharacterState {
  return ch.moodBand === 'low' ? CharacterState.BURNED_OUT : CharacterState.IDLE;
}

/** Roster-row mood glyph (EmployeeRoster.tsx) — shape + number is the
 *  primary signal (colorblind rule), never a bare color fill. */
export function moodGlyph(effectiveMood: number): string {
  if (effectiveMood < 20) return '☹';
  if (effectiveMood < 50) return '◑';
  return '☺';
}
