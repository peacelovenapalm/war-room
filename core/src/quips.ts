/**
 * Deterministic template one-liners for employee personality (GAME-DESIGN
 * §4.5 / interrogation delta #8). Pure functions, no LLM, no tokens —
 * unit-testable like crisis.ts. Seeded by hash(id|date|event) so the same
 * moment always renders the same line (consumed by webview speech bubbles
 * and the digest's flavor lines, GAME-DESIGN §6.5).
 *
 * Plain text only — no glyph prefixes here, so this pool can never collide
 * with the real/SIM glyph-disjointness rule (GAME-DESIGN §6.1) that governs
 * crisis.ts/dispatch.ts/worldEventStore.ts.
 */

import { hashString, mulberry32 } from './deterministicRandom.js';

export type MoodBand = 'low' | 'neutral' | 'high';

export function moodBand(mood: number): MoodBand {
  if (mood < 35) return 'low';
  if (mood >= 70) return 'high';
  return 'neutral';
}

export type QuipEventType =
  | 'turn'
  | 'crisis-resolved'
  | 'promote'
  | 'train'
  | 'break'
  | 'quit'
  | 'retired'
  | 'idle';

/** Badge-specific pools checked before the generic event/mood pool — badges
 *  are the "trait" axis of the (badge, mood band, event) key. Only badges
 *  with a genuinely distinct flavor get an entry; everything else falls
 *  through to the generic pool for that event/mood. */
const BADGE_POOLS: Partial<Record<string, string[]>> = {
  FAST: ['Already three tabs ahead.', 'Barely broke stride on that one.'],
  METICULOUS: ['Triple-checked before calling it done.', 'Not a loose end in sight.'],
  SLOPPY: ['Good enough, probably.', 'Ship it and see.'],
  NIGHT_OWL: ['Still at it past midnight.', 'The office is quiet except for this desk.'],
  EFFICIENT: ['Said what needed saying, nothing more.', 'Lean output, as usual.'],
  BURNS_TOKENS: ['That took a lot of thinking out loud.', 'Long way around, but it got there.'],
};

const EVENT_POOLS: Record<QuipEventType, Record<MoodBand, string[]>> = {
  turn: {
    low: ['Pushed through that one.', 'Getting it done, but it shows.'],
    neutral: ['Wrapped up the turn.', 'Task closed out.'],
    high: ['Cruised through that.', 'Enjoying the work today.'],
  },
  'crisis-resolved': {
    low: ['Fire out. Needed that win.', 'Barely, but it is handled.'],
    neutral: ['Crisis resolved.', 'Back to green.'],
    high: ['Nailed it.', 'That one felt good.'],
  },
  promote: {
    low: ['Promotion, but the timing feels off.', 'Earned it, even on a rough week.'],
    neutral: ['Promoted. Onward.', 'New title, same desk.'],
    high: ['Promotion day. Feeling great about it.', 'Earned this one and it shows.'],
  },
  train: {
    low: ['Training helped, a little.', 'Trying to sharpen up.'],
    neutral: ['Finished a training session.', 'Picked up a new habit.'],
    high: ['Loving the growth lately.', 'Training session went great.'],
  },
  break: {
    low: ['Needed this break badly.', 'Stepping away before it gets worse.'],
    neutral: ['Taking a short break.', 'Grabbing a breather.'],
    high: ['Quick break, back soon.', 'Just stretching the legs.'],
  },
  quit: {
    low: ['This is not sustainable. Stepping back.', 'Burned out. Time away.'],
    neutral: ['Taking an indefinite break from this one.', 'Stepping away for now.'],
    high: ['Taking an indefinite break from this one.', 'Stepping away for now.'],
  },
  retired: {
    low: ['A long run, and it is over now.', 'Retiring — mixed feelings.'],
    neutral: ['Retiring after a solid run.', 'Hanging it up. Good run.'],
    high: ['Retiring on a high note.', 'What a way to close it out.'],
  },
  idle: {
    low: ['Sitting quietly.', 'Not much going on right now.'],
    neutral: ['Idle for the moment.', 'Waiting on the next thing.'],
    high: ['Enjoying the lull.', 'Recharging between tasks.'],
  },
};

export interface PickQuipInput {
  id: string;
  /** Local-calendar date (YYYY-MM-DD) — the seed's day component, so the
   *  same employee/event/day always renders the same line. */
  date: string;
  event: QuipEventType;
  mood: MoodBand;
  badge?: string;
}

/** Deterministic quip pick — same inputs always yield the same line. */
export function pickQuip(input: PickQuipInput): string {
  const badgePool = input.badge ? BADGE_POOLS[input.badge] : undefined;
  const pool = badgePool ?? EVENT_POOLS[input.event][input.mood];
  const roll = mulberry32(hashString(`${input.id}|${input.date}|${input.event}`))();
  const index = Math.floor(roll * pool.length);
  return pool[Math.min(pool.length - 1, index)];
}
