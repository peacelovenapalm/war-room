/**
 * FLOOR FEED — GAME-DESIGN-V3 §3.2 item 4: "all desks' tails merged into
 * one live `[agent-name]`-prefixed stream", phone-only, below the triage
 * board. This is a SEPARATE reduction from state/tailStore.ts's per-stream
 * map (needed for the drawer/pin dock's focused view) — the feed instead
 * needs one globally-ordered, agent-labeled log, which per-stream state
 * can't give you after the fact (each stream's `seq` is only comparable to
 * itself). The caller (App.tsx) only appends here when the SAME chunk was
 * a genuine new entry in tailStore too (dedupe stays in one place).
 */

import type { OutputChunk } from '../../../core/src/messages.js';

export const MAX_FLOOR_FEED_ENTRIES = 300;

export interface FloorFeedEntry {
  /** `${source}:${id}:${seq}` — stable React key, also the dedupe identity. */
  key: string;
  /** "[turffinder]" style prefix — verbatim agent identity, never invented. */
  label: string;
  text: string;
  receivedAt: number;
}

export const EMPTY_FLOOR_FEED: readonly FloorFeedEntry[] = [];

/** Real display name for a chunk's source, or an honest fallback when the
 *  agent isn't (or is no longer) in the live roster — never blank. */
export function floorFeedLabel(source: string, id: string, agentName: string | undefined): string {
  if (agentName) return `[${agentName}]`;
  return source === 'dispatch' ? `[dispatch:${id}]` : `[#${id}]`;
}

/** Append one wire chunk. Caller supplies the resolved label (agent-name
 *  lookups belong to the net/state layer, not this pure reducer). */
export function appendFloorFeedEntry(
  entries: readonly FloorFeedEntry[],
  chunk: OutputChunk,
  label: string,
  now: number,
): readonly FloorFeedEntry[] {
  const key = `${chunk.source}:${chunk.id}:${String(chunk.seq)}`;
  const next = [...entries, { key, label, text: chunk.chunk, receivedAt: now }];
  return next.length > MAX_FLOOR_FEED_ENTRIES
    ? next.slice(next.length - MAX_FLOOR_FEED_ENTRIES)
    : next;
}

/** Append an arbitrary telemetry line not sourced from an OutputChunk
 *  (e.g. T1c tool-activity start lines) — same cap/append convention as
 *  appendFloorFeedEntry, generalized for other real-telemetry sources.
 *  Caller supplies a caller-unique `key` (this reducer has no chunk `seq`
 *  to dedupe against for non-chunk lines). */
export function appendFloorFeedLine(
  entries: readonly FloorFeedEntry[],
  key: string,
  label: string,
  text: string,
  now: number,
): readonly FloorFeedEntry[] {
  const next = [...entries, { key, label, text, receivedAt: now }];
  return next.length > MAX_FLOOR_FEED_ENTRIES
    ? next.slice(next.length - MAX_FLOOR_FEED_ENTRIES)
    : next;
}
