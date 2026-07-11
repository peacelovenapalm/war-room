/**
 * Remote tail-instruction plane (T1 remote live-tail, S2 of
 * .planning/v2/REMOTE-TAILER-DESIGN.md "Steering"). Aggregates WS
 * tailSubscribe/tailUnsubscribe demand for REMOTE agents (machine !== this
 * server's own label — local agents never touch this module, see
 * noteTailSubscribe's early-return) into per-machine TailInstruction
 * queues, drained at-most-once by POST /api/tailer/poll
 * (registerTailerPollRoute, httpServer.ts) — the same drain-array shape
 * dispatchStore.drainStopsFor uses for StopInstruction.
 *
 * Demand tracking is REFCOUNTED per agent (not per socket): N sockets
 * subscribed to the same remote agent is still ONE tail-on; the LAST
 * unsubscribe (explicit tailUnsubscribe, or socket close — see
 * httpServer.ts's per-socket tailSubscriptions Set teardown) is what
 * enqueues tail-off. A DemandRecord survives refcount hitting zero (only
 * removed on the agent's own 'agentRemoved') so `everIssued` — the
 * fromStart:true-exactly-once contract — stays correct across a
 * subscribe/unsubscribe/re-subscribe cycle for the SAME agent.
 *
 * A demand whose (machine, sessionId) has no retained transcriptPath yet
 * (remoteTranscriptPaths.ts — the hook event carrying it may not have
 * arrived) is honestly unserviceable: tryEnqueueTailOn silently skips.
 * reconcileAdvertisement (called every poll, after the drain) retries the
 * lookup each tick, so a late-arriving path is picked up automatically —
 * no separate retry timer needed.
 *
 * Telemetry-only, same as the rest of the streaming plane: tail-on/off can
 * only start or stop READING a file. This module never touches dispatch
 * records, kill/spawn machinery, or the local JSONL tap.
 */

import type { AgentStateStore } from './agentStateStore.js';
import { MAX_TAIL_QUEUE_PER_MACHINE } from './constants.js';
import { getRemoteTranscriptPath } from './remoteTranscriptPaths.js';

export interface TailInstruction {
  kind: 'tail-on' | 'tail-off';
  sessionId: string;
  transcriptPath: string;
  /** true only on the agent's FIRST-ever successfully-issued tail-on (S1's
   *  usage-accounting contract: fromStart replays the whole file, so the
   *  remote route's isRecentEnoughForShiftSpend guard sees historical
   *  records exactly once, the same way it does for /resume locally). */
  fromStart?: boolean;
}

interface DemandRecord {
  machine: string;
  sessionId: string;
  /** Live WS subscriber count across ALL sockets for this agent. */
  refcount: number;
  /** True once a tail-on has been successfully ENQUEUED (not merely
   *  attempted — see tryEnqueueTailOn) for this agent. Persists across a
   *  refcount 0 gap; only cleared by onAgentRemoved. */
  everIssued: boolean;
  /** The transcriptPath the last successful tail-on carried — reused for
   *  the matching tail-off so it never needs a fresh (and possibly by-then
   *  evicted) remoteTranscriptPaths lookup. */
  transcriptPath?: string;
}

/** Keyed by agentId — the same id tailSubscribe/tailUnsubscribe and
 *  'agentRemoved' already carry, so no separate (machine, sessionId)
 *  index is needed for the hot paths. */
const demandByAgentId = new Map<number, DemandRecord>();
/** Per-machine, at-most-once-drained instruction queues (dispatchStore's
 *  stopQueue precedent). */
const queues = new Map<string, TailInstruction[]>();

function pushInstruction(machine: string, instruction: TailInstruction): void {
  const queue = queues.get(machine) ?? [];
  queue.push(instruction);
  if (queue.length > MAX_TAIL_QUEUE_PER_MACHINE) {
    queue.shift(); // defensive-only oldest-first eviction; never hit in normal operation
  }
  queues.set(machine, queue);
}

/** Attempt to enqueue tail-on for a record with live demand. No-op
 *  (honestly absent, not queued) when the transcript path isn't retained
 *  yet — reconcileAdvertisement retries this every poll. */
function tryEnqueueTailOn(rec: DemandRecord): void {
  const transcriptPath = getRemoteTranscriptPath(rec.machine, rec.sessionId);
  if (!transcriptPath) return;
  const fromStart = !rec.everIssued;
  rec.everIssued = true;
  rec.transcriptPath = transcriptPath;
  pushInstruction(rec.machine, {
    kind: 'tail-on',
    sessionId: rec.sessionId,
    transcriptPath,
    fromStart,
  });
}

/** Enqueue tail-off using the record's own last-known transcriptPath — no
 *  fresh remoteTranscriptPaths lookup, so this still works even if that
 *  entry was evicted in the same tick (e.g. by 'agentRemoved'). A demand
 *  that was NEVER successfully tailed (no transcriptPath ever resolved)
 *  has nothing to stop; skipped, matching tryEnqueueTailOn's honest-absence
 *  posture. */
function tryEnqueueTailOff(rec: DemandRecord): void {
  if (!rec.everIssued || !rec.transcriptPath) return;
  pushInstruction(rec.machine, {
    kind: 'tail-off',
    sessionId: rec.sessionId,
    transcriptPath: rec.transcriptPath,
  });
}

/**
 * WS tailSubscribe for source==='agent' (clientMessageHandler.ts). No-op
 * for a local agent (agent.machine undefined or === the server's own
 * label) — demand only exists for remote agents, so local tailing gets
 * ZERO new behavior. Call only on a genuinely NEW subscription for this
 * socket (the caller checks its own tailSubscriptions Set first) so two
 * tailSubscribe messages for the same (socket, agent) never double-count.
 */
export function noteTailSubscribe(
  store: AgentStateStore,
  agentId: number,
  ownMachineLabel: string | undefined,
): void {
  const agent = store.get(agentId);
  if (!agent || !agent.machine || agent.machine === ownMachineLabel) return;
  let rec = demandByAgentId.get(agentId);
  if (!rec) {
    rec = { machine: agent.machine, sessionId: agent.sessionId, refcount: 0, everIssued: false };
    demandByAgentId.set(agentId, rec);
  }
  rec.refcount += 1;
  if (rec.refcount === 1) tryEnqueueTailOn(rec);
}

/** WS tailUnsubscribe (explicit, or socket-close teardown) for
 *  source==='agent'. No-op for an agentId with no demand record (never
 *  subscribed remotely, or already fully removed). */
export function noteTailUnsubscribe(agentId: number): void {
  const rec = demandByAgentId.get(agentId);
  if (!rec || rec.refcount === 0) return;
  rec.refcount -= 1;
  if (rec.refcount === 0) tryEnqueueTailOff(rec);
}

/** 'agentRemoved' choke point (createHttpServer, same site
 *  outputRingStore/remoteTranscriptPaths hook into): the demand record can
 *  never outlive its agent. Issues a final tail-off if there was live
 *  demand, then drops the record entirely — a LATER agent reusing the same
 *  numeric id (new session) starts fresh, correctly getting fromStart:true
 *  again. */
export function onAgentRemoved(agentId: number): void {
  const rec = demandByAgentId.get(agentId);
  if (!rec) return;
  if (rec.refcount > 0) tryEnqueueTailOff(rec);
  demandByAgentId.delete(agentId);
}

/** Drain (pop + clear) a machine's queued instructions — at-most-once
 *  delivery, the exact dispatchStore.drainStopsFor(machine) precedent. */
export function drainTailQueueFor(machine: string): TailInstruction[] {
  const queue = queues.get(machine);
  if (!queue || queue.length === 0) return [];
  queues.delete(machine);
  return queue;
}

/**
 * Recovery reconciliation (REMOTE-TAILER-DESIGN.md "Steering" — "a tailer
 * restart drops all active tails ... the server re-issues tail-on for
 * sessions with live WS subscribers on the tailer's next advertisement").
 * Called by registerTailerPollRoute AFTER drainTailQueueFor, so
 * `justDrainedSessionIds` reflects exactly what THIS SAME poll response
 * already carries — nothing here duplicates an instruction issued a moment
 * earlier in the same tick.
 *
 * - A session with live demand, not in `active`, not just drained: gets a
 *   tail-on. fromStart follows the SAME everIssued rule tryEnqueueTailOn
 *   uses (not unconditionally false) — correct both for the common restart
 *   case (everIssued already true, so fromStart:false) and for a demand
 *   whose transcriptPath only just became resolvable (genuinely first-ever,
 *   so fromStart:true).
 * - A session in `active` with NO live demand: gets a tail-off (a
 *   subscriber left while the tailer was mid-restart and never got the
 *   original tail-off).
 */
export function reconcileAdvertisement(
  machine: string,
  active: readonly string[],
  justDrained: readonly TailInstruction[],
): TailInstruction[] {
  const activeSet = new Set(active);
  const justDrainedSessionIds = new Set(justDrained.map((i) => i.sessionId));
  const extra: TailInstruction[] = [];

  const demandedSessionIds = new Set<string>();
  for (const rec of demandByAgentId.values()) {
    if (rec.machine !== machine || rec.refcount === 0) continue;
    demandedSessionIds.add(rec.sessionId);
    if (activeSet.has(rec.sessionId) || justDrainedSessionIds.has(rec.sessionId)) continue;
    const transcriptPath = getRemoteTranscriptPath(rec.machine, rec.sessionId);
    if (!transcriptPath) continue; // still unresolved; retried next poll
    const fromStart = !rec.everIssued;
    rec.everIssued = true;
    rec.transcriptPath = transcriptPath;
    extra.push({ kind: 'tail-on', sessionId: rec.sessionId, transcriptPath, fromStart });
  }

  for (const sessionId of active) {
    if (demandedSessionIds.has(sessionId) || justDrainedSessionIds.has(sessionId)) continue;
    const transcriptPath = getRemoteTranscriptPath(machine, sessionId) ?? '';
    extra.push({ kind: 'tail-off', sessionId, transcriptPath });
  }

  return extra;
}
