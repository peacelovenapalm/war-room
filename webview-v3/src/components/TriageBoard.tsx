import { useState } from 'react';

import { useNow } from '../hooks/useNow';
import type { AgentMap } from '../net/agentStore';
import { agentIdentity } from '../net/agentStore';
import type { AckState } from '../state/ackUndo';
import { undoSecondsLeft } from '../state/ackUndo';
import type { CrisisViewInput, TriageRow } from '../state/crisis';
import { buildTriageRows, formatAge } from '../state/crisis';
import type { CrisisState } from '../state/crisisStore';
import { freshPoll } from '../state/visualState';
import { ControlTip } from './ControlTip';

export interface TriageBoardProps {
  agents: AgentMap;
  crisis: CrisisState;
  acks: AckState;
  /** ▸ DESK — walks the camera to the desk and opens the drawer. */
  onDesk: (agentId: number) => void;
  /** `since` names the debris INSTANCE being acked (ackUndo.ts keying). */
  onAck: (debrisKey: string, since: number) => void;
  onUndoAck: (debrisKey: string) => void;
}

/** One-line cause for a burning agent (verbatim waitingFor beats fallbacks). */
function causeFor(agents: AgentMap, agentId: number, now: number): string | undefined {
  const record = agents.get(agentId);
  if (!record) return undefined;
  const poll = freshPoll(record, now);
  if (poll?.state === 'blocked' && poll.waitingFor) return poll.waitingFor;
  if (record.toolPermission) return 'Needs approval';
  if (record.awaitingInput) return 'Waiting for input';
  return undefined;
}

/**
 * TRIAGE board (the signature surface; phone cold open). Rows are live
 * fires (stage glyph + word + identity + verbatim cause + escalation
 * forecast + age) and un-acked debris, ordered by age × severity — the top
 * row is always the thing to deal with next.
 *
 * Verb honesty (stage-2 contract):
 * - Debris rows: one-tap ✓ ACK with a real ↩ UNDO window (client-side
 *   dismiss is genuinely reversible).
 * - Blocked rows: the wire has NO remote approve gate today, so ✓ APPROVE
 *   says so on tap instead of pretending — the honest answer path is
 *   ▸ DESK → the drawer's COPY ID / KILL.
 *
 * Colorblind hard rule: every signal is SHAPE + TEXT; the board reads
 * fully in grayscale. All touch targets ≥44px on phone (index.css).
 */
export function TriageBoard({ agents, crisis, acks, onDesk, onAck, onUndoAck }: TriageBoardProps) {
  const [noticeKeys, setNoticeKeys] = useState<ReadonlySet<string>>(new Set());
  const now = useNow();

  const fires: CrisisViewInput[] = [...crisis.fires.entries()].map(([agentId, fire]) => {
    const record = agents.get(agentId);
    return {
      agentId,
      since: fire.since,
      identity: record ? agentIdentity(record) : `#${String(agentId)} (gone)`,
      cause: causeFor(agents, agentId, now),
    };
  });
  const rows = buildTriageRows(fires, [...crisis.debris.values()], now);

  return (
    <section className="triage-board" data-testid="triage-board" aria-label="Triage board">
      <header className="triage-board__header">
        {rows.length > 0 ? `⚠ TRIAGE — ${String(rows.length)} OPEN` : '⚠ TRIAGE'}
      </header>
      {rows.length === 0 ? (
        <div className="triage-board__clear" data-testid="triage-all-clear">
          ✓ BOARD CLEAR — the floor is calm.
        </div>
      ) : (
        <div className="triage-board__rows">
          {rows.map((row) => (
            <BoardRow
              key={row.rowKey}
              row={row}
              agents={agents}
              acks={acks}
              now={now}
              noticeShown={noticeKeys.has(row.rowKey)}
              onShowNotice={() => {
                setNoticeKeys((previous) => new Set(previous).add(row.rowKey));
              }}
              onDesk={onDesk}
              onAck={onAck}
              onUndoAck={onUndoAck}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BoardRow({
  row,
  agents,
  acks,
  now,
  noticeShown,
  onShowNotice,
  onDesk,
  onAck,
  onUndoAck,
}: {
  row: TriageRow;
  agents: AgentMap;
  acks: AckState;
  now: number;
  noticeShown: boolean;
  onShowNotice: () => void;
  onDesk: (agentId: number) => void;
  onAck: (debrisKey: string, since: number) => void;
  onUndoAck: (debrisKey: string) => void;
}) {
  // Instance-matched only (ackUndo.ts keying): a pending ack aimed at an
  // OLDER debris instance that happened to reuse this row's key must not
  // render an UNDO chip on the new crate — the sweep will drop it.
  const pendingEntry = row.debrisKey !== undefined ? acks.get(row.debrisKey) : undefined;
  const pendingUndoUntil =
    pendingEntry !== undefined && pendingEntry.since === row.debrisSince
      ? pendingEntry.undoUntil
      : undefined;
  const agentPresent = agents.has(row.agentId);

  return (
    <div
      className={`triage-row${row.loud ? ' triage-row--loud' : ''}`}
      data-testid="triage-row"
      data-kind={row.kind}
      data-stage={row.stage ?? 'debris'}
    >
      <div className="triage-row__facts">
        <span className="triage-row__stage">
          {row.glyph} {row.word}
        </span>
        <span className="triage-row__identity">{row.identity}</span>
        <span className="triage-row__age" data-testid="triage-age">
          {formatAge(row.ageMs)}
        </span>
      </div>
      <div className="triage-row__detail">
        <span className="triage-row__cause" title={row.cause}>
          {row.cause}
        </span>
        {row.forecast !== undefined && <span className="triage-row__forecast">{row.forecast}</span>}
      </div>
      <div className="triage-row__verbs">
        {row.gate === 'ack-undo' && row.debrisKey !== undefined && (
          <>
            {pendingUndoUntil === undefined ? (
              <ControlTip label="Dismisses this debris row — genuinely reversible for 5s via UNDO.">
                <button
                  type="button"
                  className="verb"
                  data-testid="verb-ack"
                  onClick={() => {
                    onAck(row.debrisKey!, row.debrisSince ?? 0);
                  }}
                >
                  ✓ ACK
                </button>
              </ControlTip>
            ) : (
              <ControlTip label="Restores this row within its 5s window.">
                <button
                  type="button"
                  className="verb verb--undo"
                  data-testid="verb-undo"
                  onClick={() => {
                    onUndoAck(row.debrisKey!);
                  }}
                >
                  ↩ UNDO ({String(undoSecondsLeft(pendingUndoUntil, now))}s)
                </button>
              </ControlTip>
            )}
          </>
        )}
        {row.gate === 'none' && (
          <ControlTip label="No remote approve gate exists yet — taps the honest reason, not a fake success.">
            <button
              type="button"
              className="verb verb--gateless"
              data-testid="verb-approve"
              aria-describedby={noticeShown ? `${row.rowKey}-notice` : undefined}
              onClick={onShowNotice}
            >
              ✓ APPROVE
            </button>
          </ControlTip>
        )}
        {agentPresent && (
          <ControlTip label="Opens the agent drawer and walks the camera there.">
            <button
              type="button"
              className="verb"
              data-testid="verb-desk"
              onClick={() => {
                onDesk(row.agentId);
              }}
            >
              ▸ DESK
            </button>
          </ControlTip>
        )}
      </div>
      {noticeShown && (
        <div className="triage-row__notice" id={`${row.rowKey}-notice`} data-testid="gate-notice">
          ⊘ NO REMOTE GATE — the wire can't answer this prompt yet. ▸ DESK, then COPY ID (answer at
          the terminal) or ✕ KILL.
        </div>
      )}
    </div>
  );
}
