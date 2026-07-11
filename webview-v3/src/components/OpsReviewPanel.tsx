import { useEffect, useRef, useState } from 'react';

import type { ClientMessage } from '../../../core/src/messages.js';
import type { DispatchEntry, SendFailure } from '../net/dispatchFacts';
import {
  KILL_POLL_INTERVAL_MS,
  KILL_RESULT_TIMEOUT_MS,
  pollKillOutcome,
  requestKill,
} from '../net/killAgent';
import {
  buildDispatchNudgeMessage,
  buildFocusMessage,
  buildKillRequest,
  buildRequeueUrl,
  proposalKey,
  type ProposalPhase,
  type ProposalState,
  resolveDisplayState,
  tapArmsConfirm,
  tapFires,
} from '../net/opsProposals';
import {
  type AutoStatus,
  type OpsFinding,
  type OpsProposalVerb,
  type OpsProposedAction,
  type OpsReview,
  SEVERITY_GLYPHS,
} from '../state/opsReview';
import { Modal } from './Modal';

const REFRESH_INTERVAL_MS = 60_000;

export interface OpsReviewPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** Real WS send — same function CallModal/AgentDrawer's kill fetch and
   *  DISPATCH-NUDGE reuse; queued client-side until the connection is live. */
  send: (message: ClientMessage) => void;
  /** Registers a fired dispatch requestId with App's silent-drop detector —
   *  the SAME handler CallModal's onSend already calls. */
  onDispatchSend: (machine: string, action: 'dispatch', requestId: string) => void;
  /** Global dispatch lifecycle state — used ONLY to tell a DISPATCH-NUDGE
   *  proposal's "sent" apart from "queued"/"send failed" honestly, without
   *  duplicating a second lifecycle tracker (DispatchTray remains the
   *  single source of truth for the entry's full lifecycle). */
  dispatchEntries: DispatchEntry[];
  sendFailures: SendFailure[];
}

const VERB_WORDS: Record<OpsProposalVerb, { pending: string; done: string; sent?: string }> = {
  kill: { pending: 'KILLING…', done: 'KILLED' },
  focus: { pending: 'SENDING…', done: 'FOCUS SENT', sent: 'FOCUS SENT' },
  'dispatch-nudge': { pending: 'SENDING…', done: 'QUEUED', sent: 'SENDING…' },
  requeue: { pending: 'REQUEUING…', done: 'REQUEUED' },
};

function ProposalButton({
  action,
  state,
  onTap,
  onCancel,
}: {
  action: OpsProposedAction;
  state: ProposalState;
  onTap: () => void;
  onCancel: () => void;
}) {
  const words = VERB_WORDS[action.verb];
  const phase = state.phase;
  const disabled = phase === 'pending' || phase === 'sent' || phase === 'done';

  if (phase === 'confirm') {
    return (
      <div className="ops-proposal ops-proposal--confirm" data-testid="ops-proposal-confirm">
        <span className="ops-proposal__confirm-text">⚠ CONFIRM: {action.label}</span>
        <button
          type="button"
          className="verb verb--confirm"
          data-testid={`ops-proposal-confirm-${action.verb}`}
          onClick={onTap}
        >
          ⚠ CONFIRM
        </button>
        <button
          type="button"
          className="verb"
          data-testid={`ops-proposal-cancel-${action.verb}`}
          onClick={onCancel}
        >
          CANCEL
        </button>
      </div>
    );
  }

  return (
    <div className="ops-proposal" data-testid="ops-proposal">
      <button
        type="button"
        className="verb"
        data-testid={`ops-proposal-tap-${action.verb}`}
        disabled={disabled}
        onClick={onTap}
      >
        {phase === 'idle' && action.label}
        {phase === 'pending' && `⏳ ${words.pending}`}
        {phase === 'sent' && `→ ${words.sent ?? words.pending}`}
        {phase === 'done' && `✓ ${words.done}`}
        {phase === 'failed' && `✗ FAILED${state.reason !== undefined ? ` — ${state.reason}` : ''}`}
      </button>
    </div>
  );
}

function FindingRow({
  finding,
  proposals,
  onTap,
  onCancel,
}: {
  finding: OpsFinding;
  proposals: Record<string, ProposalState>;
  onTap: (finding: OpsFinding, action: OpsProposedAction) => void;
  onCancel: (finding: OpsFinding, action: OpsProposedAction) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { glyph, word } = SEVERITY_GLYPHS[finding.severity];
  return (
    <div
      className={`ops-finding ops-finding--${finding.severity}`}
      data-testid="ops-finding"
      data-severity={finding.severity}
    >
      <button
        type="button"
        className="ops-finding__head"
        data-testid="ops-finding-toggle"
        onClick={() => {
          setExpanded((e) => !e);
        }}
      >
        <span className="ops-finding__severity">
          {glyph} {word}
        </span>
        <span className="ops-finding__summary">{finding.summary}</span>
      </button>
      {expanded && (
        <div className="ops-finding__body" data-testid="ops-finding-detail">
          <p className="ops-finding__detail">{finding.detail}</p>
          {finding.receipts.length > 0 && (
            <ul className="ops-finding__receipts" data-testid="ops-finding-receipts">
              {finding.receipts.map((r, i) => (
                <li key={i}>
                  <strong>{r.label}:</strong> {r.value}
                </li>
              ))}
            </ul>
          )}
          {finding.proposedActions !== undefined && finding.proposedActions.length > 0 && (
            <div className="ops-finding__proposals" data-testid="ops-finding-proposals">
              {finding.proposedActions.map((action) => (
                <ProposalButton
                  key={action.verb}
                  action={action}
                  state={proposals[proposalKey(finding.id, action.verb)] ?? { phase: 'idle' }}
                  onTap={() => {
                    onTap(finding, action);
                  }}
                  onCancel={() => {
                    onCancel(finding, action);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatReceiptTs(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** RUNG 3: read-only render of the auto-executor's real state — the
 *  honest whitelist line (server-generated, "AUTO: OFF — whitelist empty"
 *  unless Greg has hand-edited the whitelist file) plus every receipt
 *  that has actually fired, shape+label per outcome (colorblind rule).
 *  This section never taps anything — auto-actions are Greg's hand-edit
 *  to enable, not a button here. */
function AutoSection({ status }: { status: AutoStatus }) {
  return (
    <div className="ops-auto" data-testid="ops-auto-section">
      <div className="ops-auto__whitelist-line" data-testid="ops-auto-whitelist-line">
        {status.whitelistLine}
      </div>
      {status.receipts.length > 0 && (
        <ul className="ops-auto__receipts" data-testid="ops-auto-receipts">
          {status.receipts.map((r, i) => (
            <li
              key={i}
              data-testid="ops-auto-receipt"
              data-outcome={r.outcome.ok ? 'ok' : 'failed'}
            >
              <span className="ops-auto__receipt-glyph">{r.outcome.ok ? '✓' : '✗'}</span>{' '}
              <span>{formatReceiptTs(r.ts)}</span> <strong>{r.actionKind}</strong>{' '}
              <span className="modal__muted">— {r.outcome.detail}</span>
              <div className="modal__muted">cause: {r.cause.findingId}</div>
              <div className="modal__muted">undo: {r.undo}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** OPS REVIEW panel (T3 self-healing ladder): Ops Advisor findings list —
 *  GET /api/ops/review on open + every 60s while open. RUNG 1 (read-only):
 *  every finding cites its raw receipts, expandable per row. RUNG 2 (gated
 *  proposals): findings that have an honestly-available action surface a
 *  one-tap button — tap once to arm a confirm step showing EXACTLY what
 *  will happen, tap again to fire it through the SAME endpoint/message an
 *  existing panel already uses (kill: AgentDrawer's fetch path via
 *  net/killAgent.ts; dispatch-nudge: CallModal's dispatchRequest shape;
 *  requeue: the existing /api/rework/:id/redispatch route). Nothing here
 *  ever auto-executes — System proposes, Greg disposes. */
export function OpsReviewPanel({
  isOpen,
  onClose,
  send,
  onDispatchSend,
  dispatchEntries,
  sendFailures,
}: OpsReviewPanelProps) {
  const [review, setReview] = useState<OpsReview | null>(null);
  const [error, setError] = useState(false);
  const [autoStatus, setAutoStatus] = useState<AutoStatus | null>(null);
  const [proposals, setProposals] = useState<Record<string, ProposalState>>({});
  const cancelledRef = useRef(false);

  useEffect(
    () => () => {
      cancelledRef.current = true;
    },
    [],
  );

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/ops/review');
        if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
        const data = (await res.json()) as OpsReview;
        if (!cancelled) {
          setReview(data);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    };
    void load();
    const interval = setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isOpen]);

  // RUNG 3: the auto-executor's real status — same open + 60s-refresh
  // cadence as the findings fetch above, its own independent endpoint.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/ops/auto');
        if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
        const data = (await res.json()) as AutoStatus;
        if (!cancelled) setAutoStatus(data);
      } catch {
        /* honest omission: the AUTO section simply doesn't render this cycle */
      }
    };
    void load();
    const interval = setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isOpen]);

  const setPhase = (key: string, phase: ProposalPhase, reason?: string, requestId?: string) => {
    if (cancelledRef.current) return;
    setProposals((prev) => ({ ...prev, [key]: { phase, reason, requestId } }));
  };

  const executeKill = (key: string, action: OpsProposedAction) => {
    const { machine, pid } = buildKillRequest(action);
    setPhase(key, 'pending');
    void requestKill(machine, pid).then((body) => {
      if (!body.ok || body.id === undefined) {
        setPhase(key, 'failed', body.reason ?? 'request rejected');
        return;
      }
      const requestId = body.id;
      const startedAt = Date.now();
      const poll = () => {
        if (cancelledRef.current) return;
        void pollKillOutcome(requestId).then((outcome) => {
          if (cancelledRef.current) return;
          if (outcome?.status === 'killed') {
            setPhase(key, 'done');
          } else if (outcome?.status === 'denied') {
            setPhase(key, 'failed', outcome.reason ?? 'denied');
          } else if (Date.now() - startedAt > KILL_RESULT_TIMEOUT_MS) {
            setPhase(key, 'failed', 'no response from runner');
          } else {
            setTimeout(poll, KILL_POLL_INTERVAL_MS);
          }
        });
      };
      setTimeout(poll, KILL_POLL_INTERVAL_MS);
    });
  };

  const executeFocus = (key: string, action: OpsProposedAction) => {
    // No ack exists on the wire for focus (mirrors the v1 fallback's own
    // honesty ceiling) — "sent" is the truthful terminal state, never
    // upgraded to a fabricated "done".
    send(buildFocusMessage(action));
    setPhase(key, 'sent');
  };

  const executeDispatchNudge = (key: string, action: OpsProposedAction) => {
    const requestId = crypto.randomUUID();
    send(buildDispatchNudgeMessage(action, requestId));
    onDispatchSend(String(action.params.machine), 'dispatch', requestId);
    setPhase(key, 'sent', undefined, requestId);
  };

  const executeRequeue = (key: string, action: OpsProposedAction) => {
    setPhase(key, 'pending');
    void fetch(buildRequeueUrl(action), { method: 'POST' })
      .then((res) => res.json())
      .then((body: { ok: boolean; dispatchId?: string; reason?: string }) => {
        if (body.ok) {
          setPhase(key, 'done');
        } else {
          setPhase(key, 'failed', body.reason ?? 'rejected');
        }
      })
      .catch(() => {
        setPhase(key, 'failed', 'request failed');
      });
  };

  const handleTap = (finding: OpsFinding, action: OpsProposedAction) => {
    const key = proposalKey(finding.id, action.verb);
    const phase = proposals[key]?.phase ?? 'idle';
    if (tapArmsConfirm(phase)) {
      setPhase(key, 'confirm');
      return;
    }
    if (!tapFires(phase)) return;
    switch (action.verb) {
      case 'kill':
        executeKill(key, action);
        break;
      case 'focus':
        executeFocus(key, action);
        break;
      case 'dispatch-nudge':
        executeDispatchNudge(key, action);
        break;
      case 'requeue':
        executeRequeue(key, action);
        break;
    }
  };

  const handleCancel = (finding: OpsFinding, action: OpsProposedAction) => {
    setPhase(proposalKey(finding.id, action.verb), 'idle');
  };

  const displayProposals: Record<string, ProposalState> = {};
  for (const [key, state] of Object.entries(proposals)) {
    displayProposals[key] = resolveDisplayState(state, dispatchEntries, sendFailures);
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="OPS REVIEW" testId="ops-review-panel">
      {error && !review && <div className="modal__warn">⚠ unable to reach /api/ops/review</div>}
      {review && (
        <div className="ops-findings" data-testid="ops-findings">
          {review.findings.map((f) => (
            <FindingRow
              key={f.id}
              finding={f}
              proposals={displayProposals}
              onTap={handleTap}
              onCancel={handleCancel}
            />
          ))}
        </div>
      )}
      <p className="modal__footnote">
        Waste and stale-telemetry patterns, each citing the raw events behind it. Gated proposals
        only appear where the action is honestly available right now — nothing executes without a
        two-tap confirm. System proposes, Greg disposes.
      </p>
      {autoStatus && (
        <>
          <h3 className="ops-auto__heading">AUTO</h3>
          <AutoSection status={autoStatus} />
          <p className="modal__footnote">
            Rung 3: guardrailed auto-execution, whitelist ships empty — only Greg's own hand-edit
            turns an action on. Every fire leaves the receipt above; nothing here taps anything.
          </p>
        </>
      )}
    </Modal>
  );
}
