/**
 * Scrap & Rework Bin ingest (v3 WS-C STAGE 2 — KICKOFF-v3.1 §1 "failure
 * loop"). Feeds reworkBinStore.ts from REAL observed failures only:
 *
 *  - DISPATCH failures: a dispatch that exited nonzero, was killed via the
 *    stop channel, or was capped by its own timeoutSec timer (T5 fleet
 *    controls) piles a crate holding the VERBATIM output tail
 *    (dispatchStore's terminal broadcast — the same resultTail the result
 *    view shows). Focus actions and clean exits pile nothing. A denied
 *    dispatch piles nothing either: the runner's allowlist refused it and
 *    an identical re-dispatch would be refused again — there is nothing to
 *    rework.
 *  - TERMINAL crises: a session that VANISHED from the poller's report
 *    while its last observed state was `blocked` ended without ever being
 *    unblocked — a real terminal failure, crated with the verbatim
 *    waitingFor text. The stale sweep (poller silence) deliberately never
 *    piles: a dead poller says nothing about the session (ambiguous ≠
 *    observed — the honesty rule).
 *
 * The REWORK verb (httpServer.ts's /api/rework/:id/redispatch route)
 * re-enqueues the ORIGINAL dispatch parameters through the NORMAL dispatch
 * path — ringing cap, runner allowlist decision, TTL sweep, every existing
 * gate intact (never a bypass; a rework click is a conscious human act,
 * the same class as a CallModal Send). DISMISS is first-class and counted
 * in the SHIFT report (shiftStats.recordReworkDismissed).
 */

import type { DispatchBroadcast } from './dispatchStore.js';
import { DispatchStore, dispatchStore } from './dispatchStore.js';
import { ReworkBinStore, reworkBinStore } from './reworkBinStore.js';

export class ReworkBinIngest {
  private readonly bin: ReworkBinStore;
  private subscribed = false;

  constructor(bin: ReworkBinStore = reworkBinStore) {
    this.bin = bin;
  }

  /** Subscribe the dispatch failure feed. Idempotent — call exactly once
   *  at process startup (chainOrchestrator discipline). */
  start(dispatch: Pick<DispatchStore, 'onUpdate'> = dispatchStore): void {
    if (this.subscribed) return;
    this.subscribed = true;
    dispatch.onUpdate((broadcast) => this.onDispatchUpdate(broadcast));
  }

  /** A dispatch lifecycle broadcast — pile a crate for real failures.
   *  Public for direct unit testing. Idempotency lives in the store
   *  (one piled crate per (source, failure id)). */
  onDispatchUpdate(broadcast: DispatchBroadcast, now: number = Date.now()): void {
    if (broadcast.action !== 'dispatch') return;
    if (broadcast.status === 'exited') {
      if (broadcast.exitCode === undefined || broadcast.exitCode === 0) return;
      this.bin.pile(
        'dispatch',
        {
          id: broadcast.id,
          // Verbatim tail when the runner reported one; otherwise the
          // observed exit fact itself (still real, still traceable).
          excerpt:
            broadcast.resultTail && broadcast.resultTail.trim() !== ''
              ? broadcast.resultTail
              : `exited ${broadcast.exitCode} — no output tail reported`,
        },
        now,
      );
      return;
    }
    if (broadcast.status === 'killed') {
      this.bin.pile(
        'dispatch',
        {
          id: broadcast.id,
          excerpt:
            broadcast.resultTail && broadcast.resultTail.trim() !== ''
              ? broadcast.resultTail
              : 'killed via the stop channel — no output tail reported',
        },
        now,
      );
      return;
    }
    if (broadcast.status === 'capped') {
      this.bin.pile(
        'dispatch',
        {
          id: broadcast.id,
          excerpt:
            broadcast.resultTail && broadcast.resultTail.trim() !== ''
              ? broadcast.resultTail
              : `capped at ${String(broadcast.timeoutSec ?? '?')}s — no output tail reported`,
        },
        now,
      );
    }
  }

  /** A session vanished from the poller's report while blocked (the ONLY
   *  crisis path that piles — see file header). Wired via pollStateHandler's
   *  v3 sink; never called by the stale sweep. */
  recordAbandonedCrisis(
    agentId: number,
    machine: string | undefined,
    projectDir: string,
    waitingFor: string | undefined,
    now: number = Date.now(),
  ): void {
    this.bin.pile(
      'crisis',
      {
        id: `agent:${agentId}@${machine ?? 'LOCAL'}`,
        excerpt:
          waitingFor && waitingFor.trim() !== ''
            ? waitingFor
            : `session ended while blocked in ${projectDir} — no waitingFor captured`,
      },
      now,
    );
  }
}

/** Process-wide instance (the server is single-process) — start() is wired
 *  once in httpServer.ts's createHttpServer(). */
export const reworkBinIngest = new ReworkBinIngest();
