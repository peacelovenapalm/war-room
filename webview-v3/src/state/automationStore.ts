/**
 * Pure reducers wiring the real server WS plane into the automation
 * surfaces' pure logic modules (dispatch tray, chain tray, budget meter) —
 * same "verbatim mirror, no synthesized state" convention as
 * net/agentStore.ts and state/economy.ts.
 */

import type { ServerMessage } from '../../../core/src/messages.js';
import {
  type DispatchEntry,
  isTerminalDispatchStatus,
  upsertDispatchEntry,
} from '../net/dispatchFacts';
import type { BudgetSnapshotClient } from './budget';
import { type ChainRunClient, upsertChainRun } from './chain';

export function reduceDispatchEntries(
  entries: DispatchEntry[],
  message: ServerMessage,
  now: number = Date.now(),
): DispatchEntry[] {
  if (message.type !== 'dispatchUpdate') return entries;
  return upsertDispatchEntry(
    entries,
    {
      id: message.id,
      action: message.action,
      status: message.status,
      machine: message.machine,
      provider: message.provider,
      promptPreview: message.promptPreview,
      reason: message.reason,
      pid: message.pid,
      exitCode: message.exitCode,
      resultTail: message.resultTail,
      // T5 fleet controls — lets a CAPPED chip render "(Ns)" without a
      // second round trip.
      timeoutSec: message.timeoutSec,
      requestId: message.requestId,
      updatedAt: message.updatedAt,
    },
    now,
  );
}

/** Merge GET /api/dispatch/recent into the live WS store. Snapshot rows are
 * ordered by server updatedAt in reduceDispatchEntries, while reconnect
 * authoritatively removes old non-terminal rows absent from the snapshot.
 * IDs updated over WS after this HTTP request began are preserved from the
 * absence-prune race. Terminal rows remain until the user dismisses them. */
export function reconcileDispatchSnapshot(
  entries: DispatchEntry[],
  snapshot: Extract<ServerMessage, { type: 'dispatchUpdate' }>[],
  preserveIds: ReadonlySet<string>,
  now: number = Date.now(),
): DispatchEntry[] {
  const snapshotIds = new Set(snapshot.map((message) => message.id));
  let next = entries.filter(
    (entry) =>
      isTerminalDispatchStatus(entry.status) ||
      snapshotIds.has(entry.id) ||
      preserveIds.has(entry.id),
  );
  for (const message of snapshot) next = reduceDispatchEntries(next, message, now);
  return next;
}

export function reduceChainRuns(runs: ChainRunClient[], message: ServerMessage): ChainRunClient[] {
  if (message.type !== 'chainRunUpdate') return runs;
  // core's generated ChainRun doesn't yet declare `pausedReason` (server-
  // side addition ahead of the last asyncapi codegen run, same drift as
  // EconomyUpdate.purchasedPerks — see state/chain.ts's chainMaxSteps
  // note). Read it through a narrow, documented escape hatch rather than
  // widening the whole message to `any`.
  const pausedReason = (message.run as { pausedReason?: string }).pausedReason;
  const run: ChainRunClient = { ...message.run, pausedReason };
  return upsertChainRun(runs, run);
}

/** Client receipt time per chain run id — chain.ts's pruneChainRuns needs
 *  this because ChainRunClient itself carries no client-local timestamp.
 *  Refreshed on every update for that run id (auto-clear ages from the
 *  MOST RECENT sighting, not the first). */
export function reduceChainRunReceivedAt(
  receivedAtById: Record<string, number>,
  message: ServerMessage,
  now: number = Date.now(),
): Record<string, number> {
  if (message.type !== 'chainRunUpdate') return receivedAtById;
  return { ...receivedAtById, [message.run.id]: now };
}

export function reduceBudget(
  prev: BudgetSnapshotClient | null,
  message: ServerMessage,
): BudgetSnapshotClient | null {
  if (message.type !== 'budgetUpdate') return prev;
  return { claude: message.claude, codex: message.codex };
}
