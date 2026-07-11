/**
 * Coalescing line forwarder for bin/transcript-tailer.mjs (T1 remote
 * live-tail, S3). Sibling of bin/lib/output-forwarder.mjs — same posture
 * (coalesce, sequential POST chain, dead-server never crashes/blocks,
 * backlog cap), but the body shape and target route differ:
 *
 *   output-forwarder: per (dispatch id, stream) TEXT chunks -> POST
 *     /api/dispatch/:id/output { stream, chunk, seq }
 *   line-forwarder:   per sessionId JSONL LINE ARRAYS -> POST
 *     /api/agents/output { sessionId, lines } (Bearer + X-Machine)
 *
 * ONE forwarder instance is shared across every session the daemon is
 * currently tailing (unlike output-forwarder, which dispatch-runner.mjs
 * creates fresh per run) — buffering is keyed by sessionId internally.
 *
 * Flush policy per session: EITHER the coalescing timer (~1s, armed by the
 * first buffered line) fires, OR the session's buffered bytes reach
 * maxBytes (~64KB), OR its buffered line COUNT reaches maxLines (200,
 * matching the server's MAX_AGENT_OUTPUT_LINES_PER_POST) — whichever first.
 * A flush that crosses maxLines mid-buffer (e.g. one read pass yields 250
 * new lines) is chunked into multiple POSTs of at most maxLines each, so
 * the server's hard per-POST line cap is never violated regardless of how
 * much was pushed between flushes.
 *
 * Per REMOTE-TAILER-DESIGN.md's wire contract: a 2xx `{ok:false}` response
 * (unknown-session, missing-machine) means the server no longer wants this
 * session's output — treated as tail-off, reported via `onDenied(sessionId,
 * reason)` so the daemon can drop its local tail state too (never inferred
 * from an HTTP error status, which just means "try again").
 */

/** Default coalescing window. */
export const LINE_FLUSH_INTERVAL_MS = 1_000;
/** Default per-session byte threshold for an immediate flush. */
export const LINE_FLUSH_MAX_BYTES = 64 * 1024;
/** Default per-session line-count threshold for an immediate flush —
 *  matches the server's MAX_AGENT_OUTPUT_LINES_PER_POST so a normal flush
 *  never needs chunking; a flush THAT exceeds it (see flushSession) still
 *  splits defensively. */
export const LINE_FLUSH_MAX_LINES = 200;
/** Max POSTs queued-or-in-flight at once — same backlog-cap rationale as
 *  output-forwarder.mjs's OUTPUT_MAX_PENDING_POSTS. */
export const LINE_MAX_PENDING_POSTS = 8;

const POST_TIMEOUT_MS = 10_000;

/**
 * Create a line forwarder for one machine's tailer process.
 *
 * @param {object} opts
 * @param {string} opts.url          server base URL (no trailing slash)
 * @param {string} opts.token        bearer token
 * @param {string} opts.machine      X-Machine label
 * @param {(url: string, init: object) => Promise<Response>} [opts.fetchImpl]
 * @param {number} [opts.flushMs]
 * @param {number} [opts.maxBytes]
 * @param {number} [opts.maxLines]
 * @param {number} [opts.maxPendingPosts]
 * @param {(msg: string) => void} [opts.log]
 * @param {(sessionId: string, reason: string) => void} [opts.onDenied]
 */
export function createLineForwarder({
  url,
  token,
  machine,
  fetchImpl = fetch,
  flushMs = LINE_FLUSH_INTERVAL_MS,
  maxBytes = LINE_FLUSH_MAX_BYTES,
  maxLines = LINE_FLUSH_MAX_LINES,
  maxPendingPosts = LINE_MAX_PENDING_POSTS,
  log = () => {},
  onDenied = () => {},
}) {
  /** @type {Map<string, { lines: string[], bytes: number }>} */
  const sessions = new Map();
  let timer = null;
  let stopped = false;
  // Sequential POST chain: preserves line order end-to-end per forwarder
  // (cross-session ordering isn't a contract — each session's own lines
  // stay in order, which is all the server-side ring append needs).
  let chain = Promise.resolve();
  let pendingPosts = 0;

  function sessionState(sessionId) {
    let state = sessions.get(sessionId);
    if (!state) {
      state = { lines: [], bytes: 0 };
      sessions.set(sessionId, state);
    }
    return state;
  }

  function post(sessionId, lines) {
    if (pendingPosts >= maxPendingPosts) {
      log(`⚠ line backlog full for ${sessionId} — dropped ${lines.length} line(s)`);
      return;
    }
    pendingPosts += 1;
    chain = chain.then(async () => {
      try {
        const res = await fetchImpl(`${url}/api/agents/output`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
            'x-machine': machine,
          },
          body: JSON.stringify({ sessionId, lines }),
          signal: AbortSignal.timeout(POST_TIMEOUT_MS),
        });
        if (!res.ok) {
          log(`⚠ line POST failed for ${sessionId} — server responded ${res.status}`);
          return;
        }
        let body;
        try {
          body = await res.json();
        } catch {
          return; // non-JSON 2xx ack is fine, nothing to react to
        }
        if (body && body.ok === false) {
          onDenied(sessionId, typeof body.reason === 'string' ? body.reason : 'denied');
        }
      } catch (err) {
        // Fire-and-forget: a dead server costs this batch, nothing else.
        const m = err instanceof Error ? err.message : String(err);
        log(`⚠ line POST failed for ${sessionId} (${m.split('\n')[0].slice(0, 200)})`);
      } finally {
        pendingPosts -= 1;
      }
    });
  }

  function flushSession(sessionId) {
    const state = sessions.get(sessionId);
    if (!state || state.lines.length === 0) return;
    const lines = state.lines;
    state.lines = [];
    state.bytes = 0;
    // Defensive chunking: normal flushes never exceed maxLines (push()
    // flushes as soon as the threshold is crossed), but a single push()
    // call can itself deliver more than maxLines lines in one read pass.
    for (let i = 0; i < lines.length; i += maxLines) {
      post(sessionId, lines.slice(i, i + maxLines));
    }
  }

  function flushAll() {
    for (const sessionId of sessions.keys()) flushSession(sessionId);
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
    /** Buffer new JSONL lines for one session. `newLines` is an array of
     *  already-filtered (assistant-only, size-checked) raw line strings. */
    push(sessionId, newLines) {
      if (stopped || !Array.isArray(newLines) || newLines.length === 0) return;
      const state = sessionState(sessionId);
      for (const line of newLines) {
        state.lines.push(line);
        state.bytes += Buffer.byteLength(line, 'utf8');
      }
      if (state.lines.length >= maxLines || state.bytes >= maxBytes) {
        flushSession(sessionId);
      } else {
        armTimer();
      }
    },

    /** Force-flush one session (used at tail-off — the final flush for
     *  that session only, other sessions' buffers are untouched). Returns
     *  the shared POST chain so a caller can await settling. */
    flush(sessionId) {
      flushSession(sessionId);
      return chain;
    },

    /** Drop a session's buffered-but-unflushed lines without posting them
     *  (used when a tail is refused/denied — nothing to send). */
    drop(sessionId) {
      sessions.delete(sessionId);
    },

    /** Stop the flush loop and perform a final flush of every session.
     *  Never throws. */
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
