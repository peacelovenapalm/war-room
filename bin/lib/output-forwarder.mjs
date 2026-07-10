/**
 * Coalescing output forwarder (KICKOFF-v2.0 Phase 2 slice 2.5 —
 * DISPATCH-6B-DESIGN amendment #2).
 *
 * Buffers a dispatch child's stdout/stderr per (dispatch id, stream) and
 * POSTs coalesced chunks to the server's Bearer-authed
 * `POST /api/dispatch/:id/output` — the same authed runner->server channel
 * as every status/decision POST. TELEMETRY ONLY: output never rides the
 * poll response, never carries commands, and never affects the runner's
 * containment decisions.
 *
 * Flush policy: a stream's buffer is flushed when EITHER
 *   - the coalescing timer (default ~1s, armed by the first buffered byte)
 *     fires, or
 *   - the stream's buffered bytes reach the max (default ~8KB) — flushed
 *     immediately, without waiting for the timer.
 * `stop()` (called when the child exits) halts the flush loop and performs
 * the final flush.
 *
 * Resilience contract (the runner's existing error posture): a dead or slow
 * server NEVER crashes or blocks the runner — every POST failure is
 * swallowed after a ⚠ log line, and the failed chunk is dropped (ephemeral
 * telemetry; the durable record stays the per-run log file). POSTs are
 * chained sequentially per forwarder so chunks arrive in order — the ring's
 * server-assigned seq stays monotonic without trusting network reordering.
 */

/** Default coalescing window. */
export const OUTPUT_FLUSH_INTERVAL_MS = 1_000;
/** Default per-stream byte threshold for an immediate flush. */
export const OUTPUT_FLUSH_MAX_BYTES = 8 * 1024;
/** Max POSTs queued-or-in-flight on the chain at once. A HUNG (not dead)
 *  server serializes each POST behind a 10s abort — without a cap, a chatty
 *  child (>8KB/s) queues chunks in runner memory faster than the chain
 *  drains, for the whole run. At the cap, further flushes are DROPPED with
 *  a ⚠ log (ephemeral telemetry — same posture as a failed POST), bounding
 *  runner memory to ~cap x maxBytes. */
export const OUTPUT_MAX_PENDING_POSTS = 8;

const POST_TIMEOUT_MS = 10_000;

/**
 * Create a forwarder for one dispatch run.
 *
 * @param {object} opts
 * @param {string} opts.url        server base URL (no trailing slash)
 * @param {string} opts.token      bearer token
 * @param {string} opts.id         dispatch id
 * @param {(url: string, init: object) => Promise<unknown>} [opts.fetchImpl]
 * @param {number} [opts.flushMs]
 * @param {number} [opts.maxBytes]
 * @param {number} [opts.maxPendingPosts]
 * @param {(msg: string) => void} [opts.log]
 */
export function createOutputForwarder({
  url,
  token,
  id,
  fetchImpl = fetch,
  flushMs = OUTPUT_FLUSH_INTERVAL_MS,
  maxBytes = OUTPUT_FLUSH_MAX_BYTES,
  maxPendingPosts = OUTPUT_MAX_PENDING_POSTS,
  log = () => {},
}) {
  /** @type {Map<string, { parts: string[], bytes: number, seq: number }>} */
  const streams = new Map();
  let timer = null;
  let stopped = false;
  // Sequential POST chain: preserves chunk order end-to-end and gives
  // stop() one promise to await for the final flush.
  let chain = Promise.resolve();
  // Chain-depth counter for the backlog cap (queued + in-flight POSTs).
  let pendingPosts = 0;

  function streamState(stream) {
    let state = streams.get(stream);
    if (!state) {
      state = { parts: [], bytes: 0, seq: 0 };
      streams.set(stream, state);
    }
    return state;
  }

  function post(stream, chunk, seq) {
    if (pendingPosts >= maxPendingPosts) {
      // Backlog cap: a hung server sheds chunks instead of queuing runner
      // memory unboundedly — same ephemeral-telemetry posture as a failed
      // POST (the durable record stays the per-run log file).
      const dropped = Buffer.byteLength(chunk, 'utf8');
      log(`⚠ output backlog full for ${id}/${stream} — dropped a ${dropped}-byte chunk`);
      return;
    }
    pendingPosts += 1;
    chain = chain.then(async () => {
      try {
        await fetchImpl(`${url}/api/dispatch/${id}/output`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ stream, chunk, seq }),
          signal: AbortSignal.timeout(POST_TIMEOUT_MS),
        });
      } catch (err) {
        // Fire-and-forget: a dead server costs this chunk, nothing else.
        const m = err instanceof Error ? err.message : String(err);
        log(`⚠ output POST failed for ${id}/${stream} (${m.split('\n')[0].slice(0, 200)})`);
      } finally {
        pendingPosts -= 1;
      }
    });
  }

  function flushStream(stream) {
    const state = streams.get(stream);
    if (!state || state.parts.length === 0) return;
    const chunk = state.parts.join('');
    state.parts = [];
    state.bytes = 0;
    post(stream, chunk, state.seq++);
  }

  function flushAll() {
    for (const stream of streams.keys()) flushStream(stream);
  }

  function armTimer() {
    if (timer !== null || stopped) return;
    timer = setTimeout(() => {
      timer = null;
      flushAll();
    }, flushMs);
    timer.unref?.();
  }

  return {
    /** Buffer one piece of output. `data` may be a Buffer or string. */
    push(stream, data) {
      if (stopped) return;
      const text = typeof data === 'string' ? data : data.toString('utf8');
      if (text === '') return;
      const state = streamState(stream);
      state.parts.push(text);
      state.bytes += Buffer.byteLength(text, 'utf8');
      if (state.bytes >= maxBytes) {
        flushStream(stream);
      } else {
        armTimer();
      }
    },

    /** Stop the flush loop and perform the final flush. Never throws. */
    async stop() {
      if (stopped) return chain;
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      flushAll();
      return chain;
    },
  };
}
