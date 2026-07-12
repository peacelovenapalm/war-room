/**
 * T6 item 3 — SPEECH BUBBLES FROM REAL TELEMETRY (D-9): short-lived bubbles
 * over desks/guest slots. Sourced ONLY from real state already reduced
 * elsewhere in this app — never invented content:
 *
 *  - desk bubbles: the RISING EDGE of an occupant's existing `loud` flag
 *    (state/visualState.ts's NEEDS_INPUT/FAILED derivation — itself built
 *    from real hook/poll telemetry, hard rule 1's own vocabulary). The
 *    bubble text IS the occupant's real statusWord, nothing paraphrased.
 *  - dispatch-done bubbles: the RISING EDGE of a dispatch entry becoming
 *    terminal (net/dispatchFacts.ts's isTerminalDispatchStatus) — the
 *    bubble text is dispatchChipLabel's own real chip text.
 *
 * Bounded theater (D-9): at most MAX_CONCURRENT_BUBBLES visible at once,
 * each with a fixed TTL — a burst of real events never floods the screen.
 */

import type { Occupant } from '../engine/world';
import type { DispatchEntry, DispatchStatusValue } from '../net/dispatchFacts';
import { dispatchChipLabel, isTerminalDispatchStatus } from '../net/dispatchFacts';

export type SpeechBubbleAnchor =
  { kind: 'agent'; agentId: number } | { kind: 'dispatch'; dispatchId: string };

export interface SpeechBubbleEvent {
  /** One id per bubble INSTANCE — callers mint a fresh id per real
   *  transition (never reused for a later occurrence of the same agent). */
  id: string;
  anchor: SpeechBubbleAnchor;
  text: string;
  createdAt: number;
}

export const MAX_CONCURRENT_BUBBLES = 3;
export const SPEECH_BUBBLE_TTL_MS = 6_000;

/** Append one bubble, dropping the oldest once past MAX_CONCURRENT_BUBBLES. */
export function appendSpeechBubble(
  bubbles: readonly SpeechBubbleEvent[],
  next: SpeechBubbleEvent,
): readonly SpeechBubbleEvent[] {
  const appended = [...bubbles, next];
  return appended.length > MAX_CONCURRENT_BUBBLES
    ? appended.slice(appended.length - MAX_CONCURRENT_BUBBLES)
    : appended;
}

/** Drop bubbles past their TTL. */
export function pruneSpeechBubbles(
  bubbles: readonly SpeechBubbleEvent[],
  now: number,
): readonly SpeechBubbleEvent[] {
  return bubbles.filter((b) => now - b.createdAt < SPEECH_BUBBLE_TTL_MS);
}

/** Occupants that are `loud` NOW but were not in `prevLoudAgentIds` — the
 *  rising edge worth a bubble (a still-loud agent doesn't re-bubble every
 *  tick). Pure diff so it's unit-testable without a rendering harness. */
export function detectNewlyLoudAgents(
  prevLoudAgentIds: ReadonlySet<number>,
  occupants: readonly Occupant[],
): Occupant[] {
  return occupants.filter((o) => o.loud && !prevLoudAgentIds.has(o.agentId));
}

/** Current set of loud agent ids — callers carry this forward as next
 *  tick's `prevLoudAgentIds`. */
export function loudAgentIds(occupants: readonly Occupant[]): Set<number> {
  return new Set(occupants.filter((o) => o.loud).map((o) => o.agentId));
}

/** Dispatch entries that are terminal NOW whose PRIOR status (if any
 *  snapshot exists) was not terminal — the rising edge worth a bubble. An
 *  id absent from `prevStatuses` (first sighting already terminal, e.g. a
 *  page reload) still counts, since the transition genuinely just
 *  happened from this client's point of view. */
export function detectNewlyTerminalDispatches(
  prevStatuses: ReadonlyMap<string, DispatchStatusValue>,
  entries: readonly DispatchEntry[],
): DispatchEntry[] {
  return entries.filter((e) => {
    if (!isTerminalDispatchStatus(e.status)) return false;
    const prior = prevStatuses.get(e.id);
    return prior === undefined || !isTerminalDispatchStatus(prior);
  });
}

/** Current id→status snapshot — callers carry this forward as next tick's
 *  `prevStatuses` for detectNewlyTerminalDispatches. */
export function dispatchStatusSnapshot(
  entries: readonly DispatchEntry[],
): Map<string, DispatchStatusValue> {
  return new Map(entries.map((e) => [e.id, e.status]));
}

/** Bubble text for a dispatch's terminal transition — dispatchChipLabel's
 *  own real chip text (e.g. "■ EXITED (code 0)"), never paraphrased. */
export function dispatchDoneBubbleText(entry: Parameters<typeof dispatchChipLabel>[0]): string {
  return dispatchChipLabel(entry);
}
