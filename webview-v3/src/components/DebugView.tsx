import { useEffect } from 'react';

import type { AgentMap } from '../net/agentStore';
import type { ConnectionStatus } from '../net/connection';
import type { CrisisState } from '../state/crisisStore';
import { shouldPollDiagnostics } from '../state/diagnosticsPolling';
import type { EconomySnapshot } from '../state/economy';
import { Modal } from './Modal';

/** Loosely typed to match core's generated AgentDiagnostics.agents
 *  (Record<string, any>[] — the server hasn't tightened this type). */
export interface DiagnosticsRow {
  id?: number;
  jsonlExists?: boolean;
  linesProcessed?: number;
  lastDataAt?: number;
  fileSize?: number;
  [key: string]: unknown;
}

export interface DebugViewProps {
  isOpen: boolean;
  onClose: () => void;
  agents: AgentMap;
  connectionStatus: ConnectionStatus;
  crisis: CrisisState;
  economy: EconomySnapshot | null;
  diagnostics: DiagnosticsRow[];
  onRequestDiagnostics: () => void;
}

const REFRESH_MS = 2_000;

/**
 * Debug view (KICKOFF-v3.1 stage-3 port) — a raw table escape hatch. v3
 * rewrite: dumps net/agentStore.ts's actual AgentMap + crisis/economy
 * state rather than porting v1's office-engine-shaped DebugView, since v3
 * tracks agent facts differently. requestDiagnostics/agentDiagnostics is
 * the one real wire round trip (JSONL tailer health per agent).
 */
export function DebugView({
  isOpen,
  onClose,
  agents,
  connectionStatus,
  crisis,
  economy,
  diagnostics,
  onRequestDiagnostics,
}: DebugViewProps) {
  useEffect(() => {
    if (!shouldPollDiagnostics(isOpen, connectionStatus)) return;
    onRequestDiagnostics();
    const interval = setInterval(onRequestDiagnostics, REFRESH_MS);
    return () => {
      clearInterval(interval);
    };
  }, [connectionStatus, isOpen, onRequestDiagnostics]);

  const diagById = new Map(diagnostics.map((d) => [d.id, d]));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="DEBUG — RAW TABLE" testId="debug-view" wide>
      <p className="modal__intro">
        connection: {connectionStatus} · fires: {crisis.fires.size} · debris: {crisis.debris.size} ·
        cash: {economy?.cash ?? '—'} · rep: {economy?.reputation ?? '—'}
      </p>
      <div className="debug-table-wrap">
        <table className="debug-table" data-testid="debug-agent-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>NAME</th>
              <th>MACHINE</th>
              <th>PROVIDER</th>
              <th>STATUS</th>
              <th>PID</th>
              <th>IN</th>
              <th>OUT</th>
              <th>POLL</th>
              <th>JSONL</th>
              <th>LINES</th>
            </tr>
          </thead>
          <tbody>
            {[...agents.values()].map((a) => {
              const diag = diagById.get(a.id);
              return (
                <tr key={a.id} data-testid="debug-agent-row">
                  <td>{a.id}</td>
                  <td>{a.name}</td>
                  <td>{a.machine ?? '(local)'}</td>
                  <td>{a.provider ?? '—'}</td>
                  <td>
                    {a.status}
                    {a.awaitingInput ? ' + AWAITING' : ''}
                  </td>
                  <td>{a.pid ?? '—'}</td>
                  <td>{a.inputTokens}</td>
                  <td>{a.outputTokens}</td>
                  <td>{a.poll ? `${a.poll.state}${a.poll.stale ? ' (stale)' : ''}` : '—'}</td>
                  <td>{diag ? (diag.jsonlExists ? '✓' : '✗') : '?'}</td>
                  <td>{diag?.linesProcessed ?? '—'}</td>
                </tr>
              );
            })}
            {agents.size === 0 && (
              <tr>
                <td colSpan={11}>no agents on the floor</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
