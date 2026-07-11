/**
 * Shared redispatch-a-crate implementation (T3 rung 2/3). Extracted out of
 * the POST /api/rework/:id/redispatch route body so a human's tap and the
 * rung-3 auto-executor's tick call the EXACT SAME sequence — no forked
 * copy, no bypass of dispatchStore.enqueue's own gates (ringing cap, etc).
 * A rework re-enqueues the crate's ORIGINAL dispatch parameters through the
 * NORMAL dispatch path; nothing here is a new mutation capability, it is
 * the one that already existed, given a name it can be imported by.
 */

import { dispatchStore } from './dispatchStore.js';
import { reworkBinStore } from './reworkBinStore.js';

export type RedispatchResult = { ok: true; dispatchId: string } | { ok: false; reason: string };

export function redispatchCrate(id: string): RedispatchResult {
  const crate = reworkBinStore.getById(id);
  if (!crate) return { ok: false, reason: 'not-found' };
  if (crate.status !== 'piled') return { ok: false, reason: 'not-piled' };
  if (crate.source !== 'dispatch') {
    // Crisis crates hold a dead session, not a dispatch — there is
    // nothing to re-enqueue; dismiss is the verb for those.
    return { ok: false, reason: 'not-redispatchable' };
  }
  const input = dispatchStore.getRedispatchInput(crate.failureRef.id);
  if (!input) return { ok: false, reason: 'original-dispatch-missing' };
  // The NORMAL path: every enqueue gate applies; a refusal (e.g. the
  // ringing cap) leaves the crate piled — the gate is never bypassed,
  // whether the caller is a human tap or the rung-3 auto-executor.
  const enqueued = dispatchStore.enqueue(input);
  if (!enqueued.ok) return { ok: false, reason: enqueued.reason };
  reworkBinStore.markReworked(crate.id);
  return { ok: true, dispatchId: enqueued.record.id };
}
