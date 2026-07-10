/**
 * Output ring buffer store (KICKOFF-v2.0 Phase 2 — streaming plane, slice
 * 2.2; DISPATCH-6B-DESIGN amendment #2).
 *
 * In-memory ONLY, deliberately: chunks are live-output TELEMETRY, never
 * command-plane data, and are never persisted (the PidKillRecord
 * ephemerality precedent — a server restart losing buffered output is
 * acceptable; the run's durable record stays the dispatch resultTail /
 * transcript file). Streaming never changes runner-decides containment.
 *
 * Keyed by (source, id) — the dispatch queue UUID (source 'dispatch') or
 * the session/transcript id (source 'agent'). Each key holds one append-
 * ordered chunk list shared across its streams, with a PER-STREAM byte
 * budget (default 128KB): when a stream exceeds its budget, its oldest
 * chunks are evicted (never the just-appended one) and the stream is marked
 * history-lost, so every LATER replay delivers that stream's first retained
 * chunk with `truncated: true` — a late subscriber honestly knows it is
 * seeing a tail, not the full output.
 *
 * `seq` is monotonic per (source, id, stream) and survives eviction (it
 * counts appends, not retained chunks) — a client can order chunks and
 * detect replay overlap after a reconnect without trusting arrival order.
 *
 * Delivery is fire-and-forget: `append()` returns synchronously and a
 * throwing listener can NEVER propagate into the producing path (the
 * backpressure hard requirement — a slow/dead subscriber must not block or
 * throw into whatever is feeding the ring). No timers of its own; lifecycle
 * sites call `evict()` on terminal status (killed/exited/failed).
 */

export type OutputSource = 'agent' | 'dispatch';
export type OutputStreamName = 'stdout' | 'stderr' | 'transcript';

/** Wire shape of one chunk — matches the generated OutputChunk message. */
export interface OutputChunkBroadcast {
  type: 'outputChunk';
  source: OutputSource;
  id: string;
  seq: number;
  stream: OutputStreamName;
  chunk: string;
  truncated: boolean;
}

/** Per-stream byte budget (KICKOFF-v2.0 Phase 2 spec: ~64–256KB/stream). */
export const OUTPUT_STREAM_BYTE_BUDGET = 128 * 1024;

interface StreamState {
  /** Next seq to assign — counts appends, so it survives eviction. */
  nextSeq: number;
  /** Bytes currently retained for this stream (UTF-8). */
  bytes: number;
  /** True once any chunk of this stream was evicted by the byte budget —
   *  replays mark the stream's first retained chunk `truncated: true`. */
  historyLost: boolean;
}

interface RingEntry {
  /** Retained chunks in append order, interleaved across streams. */
  chunks: OutputChunkBroadcast[];
  streams: Map<OutputStreamName, StreamState>;
}

/** Composite (source, id) key - shared with the WS tail-subscription
 *  registry (clientMessageHandler/httpServer) so both sides always agree on
 *  what one stream owner is. */
export function outputStreamKey(source: OutputSource, id: string): string {
  // NUL (\u0000) can't appear in either component (UUIDs / session ids).
  return `${source}\u0000${id}`;
}

export class OutputRingStore {
  private readonly entries = new Map<string, RingEntry>();
  private listeners: Array<(chunk: OutputChunkBroadcast) => void> = [];
  private readonly byteBudget: number;

  constructor(byteBudget: number = OUTPUT_STREAM_BYTE_BUDGET) {
    this.byteBudget = byteBudget;
  }

  /** Subscribe to live chunk appends. Returns an unsubscribe function.
   *  Delivery is fire-and-forget per listener — a throwing listener never
   *  propagates into the append (producing) path. */
  onChunk(listener: (chunk: OutputChunkBroadcast) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Append one chunk to a (source, id) stream. Synchronous: assigns the
   * stream's next seq, retains the chunk in the ring (evicting the stream's
   * oldest chunks if its byte budget is exceeded — never the chunk just
   * appended), and fans out to listeners fire-and-forget.
   */
  append(
    source: OutputSource,
    id: string,
    stream: OutputStreamName,
    chunk: string,
  ): OutputChunkBroadcast {
    const k = outputStreamKey(source, id);
    let entry = this.entries.get(k);
    if (!entry) {
      entry = { chunks: [], streams: new Map() };
      this.entries.set(k, entry);
    }
    let state = entry.streams.get(stream);
    if (!state) {
      state = { nextSeq: 0, bytes: 0, historyLost: false };
      entry.streams.set(stream, state);
    }

    const broadcast: OutputChunkBroadcast = {
      type: 'outputChunk',
      source,
      id,
      seq: state.nextSeq++,
      stream,
      chunk,
      // Live delivery is never truncated — the flag marks lost REPLAY
      // history, applied at replay time (see replay()).
      truncated: false,
    };
    entry.chunks.push(broadcast);
    state.bytes += Buffer.byteLength(chunk, 'utf8');
    this.evictOverBudget(entry, stream, state, broadcast);

    for (const listener of this.listeners) {
      try {
        listener(broadcast);
      } catch {
        // Fire-and-forget: a broken subscriber must never block or throw
        // into the producing path.
      }
    }
    return broadcast;
  }

  /**
   * Buffered chunks for (source, id) in append order — the replay a fresh
   * tailSubscribe delivers to its socket. For each stream whose older
   * history was evicted, the first retained chunk is delivered (as a copy)
   * with `truncated: true`.
   */
  replay(source: OutputSource, id: string): OutputChunkBroadcast[] {
    const entry = this.entries.get(outputStreamKey(source, id));
    if (!entry) return [];
    const needsMark = new Set<OutputStreamName>();
    for (const [stream, state] of entry.streams) {
      if (state.historyLost) needsMark.add(stream);
    }
    return entry.chunks.map((c) => {
      if (needsMark.has(c.stream)) {
        needsMark.delete(c.stream);
        return { ...c, truncated: true };
      }
      return c;
    });
  }

  /** Drop everything retained for (source, id) — called by lifecycle sites
   *  when the owner reaches a terminal status (killed/exited/failed). */
  evict(source: OutputSource, id: string): void {
    this.entries.delete(outputStreamKey(source, id));
  }

  /** Evict the oldest chunks of `stream` until it fits its byte budget.
   *  The just-appended chunk is never evicted, even if it alone exceeds the
   *  budget — a subscriber always sees at least the newest chunk. */
  private evictOverBudget(
    entry: RingEntry,
    stream: OutputStreamName,
    state: StreamState,
    newest: OutputChunkBroadcast,
  ): void {
    if (state.bytes <= this.byteBudget) return;
    const retained: OutputChunkBroadcast[] = [];
    for (const c of entry.chunks) {
      if (c.stream === stream && c !== newest && state.bytes > this.byteBudget) {
        state.bytes -= Buffer.byteLength(c.chunk, 'utf8');
        state.historyLost = true;
        continue;
      }
      retained.push(c);
    }
    entry.chunks = retained;
  }
}

/** Process-wide instance (the server is single-process). */
export const outputRingStore = new OutputRingStore();
