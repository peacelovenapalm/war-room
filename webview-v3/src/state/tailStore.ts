/**
 * Client-side live-tail state over the Phase-2 streaming plane
 * (tailSubscribe / outputChunk in core/asyncapi.yaml).
 *
 * - Chunks are appended in server order; `seq` is monotonically increasing
 *   per stream, so replay-after-resubscribe dedupes on `seq <= lastSeq`.
 * - ⏸ PAUSE buffers arriving chunks instead of dropping them — the header
 *   shows "+N WHILE PAUSED" and resume flushes the buffer in order.
 * - MAX_TAIL_ENTRIES bounds memory (the server ring is the retention
 *   authority; this cap only protects the DOM).
 * - `truncated` mirrors the wire flag: earlier output was evicted from the
 *   server ring, and the panel says so instead of pretending the tail is
 *   complete (one-tap-real, hard rule 5).
 */

import type {
  OutputChunk,
  OutputSourceValue,
  OutputStreamValue,
} from '../../../core/src/messages.js';

export const MAX_TAIL_ENTRIES = 500;

export interface TailEntry {
  seq: number;
  stream: OutputStreamValue;
  text: string;
}

export interface TailStreamState {
  entries: readonly TailEntry[];
  lastSeq: number;
  /** The server ring evicted earlier chunks — the visible tail is partial. */
  truncated: boolean;
  paused: boolean;
  /** Chunks that arrived while paused (flushed, in order, on resume). */
  buffer: readonly TailEntry[];
}

export const EMPTY_TAIL_STREAM: TailStreamState = {
  entries: [],
  lastSeq: -1,
  truncated: false,
  paused: false,
  buffer: [],
};

/** streamKey('agent', '3') → 'agent:3' — matches the server's routing key. */
export function tailKey(source: OutputSourceValue, id: string): string {
  return `${source}:${id}`;
}

export type TailMap = ReadonlyMap<string, TailStreamState>;

export const EMPTY_TAILS: TailMap = new Map<string, TailStreamState>();

function capped(entries: readonly TailEntry[]): readonly TailEntry[] {
  return entries.length > MAX_TAIL_ENTRIES ? entries.slice(-MAX_TAIL_ENTRIES) : entries;
}

/** Append one wire chunk. Same-reference return on duplicates (replay). */
export function appendChunk(tails: TailMap, chunk: OutputChunk): TailMap {
  const key = tailKey(chunk.source, chunk.id);
  const state = tails.get(key) ?? EMPTY_TAIL_STREAM;
  if (chunk.seq <= state.lastSeq) return tails;
  const entry: TailEntry = { seq: chunk.seq, stream: chunk.stream, text: chunk.chunk };
  const next: TailStreamState = state.paused
    ? {
        ...state,
        lastSeq: chunk.seq,
        truncated: state.truncated || chunk.truncated,
        buffer: capped([...state.buffer, entry]),
      }
    : {
        ...state,
        lastSeq: chunk.seq,
        truncated: state.truncated || chunk.truncated,
        entries: capped([...state.entries, entry]),
      };
  const nextTails = new Map(tails);
  nextTails.set(key, next);
  return nextTails;
}

/** ⏸ PAUSE / ▶ RESUME. Resume flushes the paused buffer in order. */
export function setPaused(tails: TailMap, key: string, paused: boolean): TailMap {
  const state = tails.get(key) ?? EMPTY_TAIL_STREAM;
  if (state.paused === paused) return tails;
  const next: TailStreamState = paused
    ? { ...state, paused: true }
    : { ...state, paused: false, entries: capped([...state.entries, ...state.buffer]), buffer: [] };
  const nextTails = new Map(tails);
  nextTails.set(key, next);
  return nextTails;
}

/** The "+N WHILE PAUSED" counter. */
export function pausedCount(state: TailStreamState): number {
  return state.buffer.length;
}

/** Drop a stream's client state entirely (last unsubscribe). */
export function dropStream(tails: TailMap, key: string): TailMap {
  if (!tails.has(key)) return tails;
  const next = new Map(tails);
  next.delete(key);
  return next;
}
