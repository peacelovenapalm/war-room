/**
 * WorldEventBanner's testable core (v2 mechanic G5, BUILD-PLAN §G5 task 2) —
 * plain-.ts sibling to the .tsx component, same split
 * standingOrders.ts/StandingOrdersPanel.tsx already use in this repo (no
 * jsdom/testing-library component-render tests here — pure logic lives
 * outside the component and JSX stays untested-by-name).
 */

/** One live-broadcast world event (mirrors core/src/messages.ts's
 *  WorldEventFired — the "client-facing mirror type" convention
 *  EconomySnapshotClient/EmployeeSnapshotClient use in useExtensionMessages.ts,
 *  kept in its OWN file here rather than that hook so importing it doesn't
 *  drag the whole hook (and its transitive imports) into unrelated
 *  compilation units, e.g. webview-ui/test's tsconfig). */
export interface WorldEventEntryClient {
  id: string;
  glyph: string;
  ts: number;
  summary: string;
}

/** How long an undismissed event stays up before auto-hiding — ambient
 *  flavor should never linger like a real alert (worldEventStore.ts's own
 *  doc: "rare, ambient, not spammy"). Not specified numerically by
 *  GAME-DESIGN/BUILD-PLAN — a documented judgment call, short enough to
 *  never compete with the TRIAGE board for attention. */
export const WORLD_EVENT_BANNER_AUTO_HIDE_MS = 15_000;

/** The latest event that is neither manually dismissed nor past its
 *  auto-hide window, or null when there's nothing to show. */
export function latestVisibleWorldEvent(
  events: readonly WorldEventEntryClient[],
  dismissedTs: ReadonlySet<number>,
  now: number,
): WorldEventEntryClient | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (dismissedTs.has(e.ts)) continue;
    if (now - e.ts >= WORLD_EVENT_BANNER_AUTO_HIDE_MS) return null;
    return e;
  }
  return null;
}
