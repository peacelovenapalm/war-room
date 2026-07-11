/**
 * Pure builders + confirm-step contract for OPS REVIEW's RUNG 2 gated
 * proposals — kept separate from OpsReviewPanel.tsx so the exact
 * wire-message/URL/params built per verb is independently unit-testable
 * without rendering. Every builder here reuses the SAME shape an existing
 * panel already sends (kill: net/killAgent.ts's requestKill params;
 * dispatch-nudge: CallModal.tsx's dispatchRequest message; requeue: the
 * existing /api/rework/:id/redispatch route) — never a new server
 * capability, only a new (small) client trigger for focus/requeue where v3
 * had no prior UI path.
 */

import type { ClientMessage } from '../../../core/src/messages.js';
import type { OpsProposalVerb, OpsProposedAction } from '../state/opsReview';
import type { DispatchEntry, SendFailure } from './dispatchFacts';

export type ProposalPhase = 'idle' | 'confirm' | 'pending' | 'sent' | 'done' | 'failed';

export interface ProposalState {
  phase: ProposalPhase;
  reason?: string;
  requestId?: string;
}

export function proposalKey(findingId: string, verb: OpsProposalVerb): string {
  return `${findingId}:${verb}`;
}

/** Confirm-step contract: a tap from 'idle' or 'failed' arms the confirm
 *  step (never executes on the first tap); a tap while 'confirm' is armed
 *  is the one that actually fires. 'pending'/'sent'/'done' taps are no-ops
 *  (button is disabled in those phases). */
export function tapArmsConfirm(phase: ProposalPhase): boolean {
  return phase === 'idle' || phase === 'failed';
}

export function tapFires(phase: ProposalPhase): boolean {
  return phase === 'confirm';
}

export function buildKillRequest(action: OpsProposedAction): { machine: string; pid: number } {
  return { machine: String(action.params.machine), pid: Number(action.params.pid) };
}

/** Mirrors webview-ui's v1 FOCUS button — no ack exists on the wire for
 *  this action anywhere in the system, so its honest terminal phase is
 *  'sent', never a fabricated 'done'. */
export function buildFocusMessage(action: OpsProposedAction): ClientMessage {
  return {
    type: 'dispatchRequest',
    action: 'focus',
    machine: String(action.params.machine),
    pid: Number(action.params.pid),
  };
}

/** Exact shape of CallModal.tsx's handleSubmit() dispatchRequest — same
 *  fields, same correlation-id pattern, just pre-filled from the finding's
 *  verbatim waitingFor/machine/cwd/provider instead of a form. */
export function buildDispatchNudgeMessage(
  action: OpsProposedAction,
  requestId: string,
): ClientMessage {
  return {
    type: 'dispatchRequest',
    action: 'dispatch',
    machine: String(action.params.machine),
    provider: String(action.params.provider),
    cwd: String(action.params.cwd),
    prompt: String(action.params.prompt),
    requestId,
  };
}

export function buildRequeueUrl(action: OpsProposedAction): string {
  return `/api/rework/${String(action.params.reworkId)}/redispatch`;
}

/** Resolves a DISPATCH-NUDGE proposal's real outcome from the GLOBAL
 *  dispatch lifecycle — never a fabricated "sent = success". DispatchTray
 *  stays the single source of truth for the entry's full lifecycle; this
 *  only tells a definite "queued" (found in dispatchEntries) or "failed"
 *  (found in sendFailures) apart from "still sending" (neither yet). Pure
 *  function — called at render time, not effect-driven state. */
export function resolveDisplayState(
  state: ProposalState,
  dispatchEntries: DispatchEntry[],
  sendFailures: SendFailure[],
): ProposalState {
  if (state.phase === 'sent' && state.requestId !== undefined) {
    if (sendFailures.some((f) => f.id === state.requestId)) {
      return { phase: 'failed', reason: 'not queued (no response)' };
    }
    if (dispatchEntries.some((e) => e.requestId === state.requestId)) {
      return { phase: 'done' };
    }
  }
  return state;
}
