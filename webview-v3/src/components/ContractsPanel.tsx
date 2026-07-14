import { useEffect, useState } from 'react';

import { Modal } from './Modal';

/** Mirrors server/src/contractStore.ts's Contract shape. */
export interface ContractClient {
  id: string;
  source: 'priority' | 'backlog' | 'gate' | 'daily' | 'weekly';
  title: string;
  sourceKey: string;
  payoutCash: number;
  payoutRep: number;
  status: 'open' | 'completed' | 'expired';
  completionMethod?:
    'todo-disappeared' | 'gate-flipped' | 'dispatch-result' | 'manual-claim' | 'daily-auto';
  createdAt: number;
  deadlineAt?: number;
  completedAt?: number;
  expiredAt?: number;
}

const SOURCE_GLYPH: Record<ContractClient['source'], string> = {
  priority: '▲',
  backlog: '≋',
  gate: '✱',
  daily: '✧',
  weekly: '✦',
};
const SOURCE_LABEL: Record<ContractClient['source'], string> = {
  priority: 'PRIORITY',
  backlog: 'BACKLOG',
  gate: 'GATE',
  daily: 'DAILY',
  weekly: 'WEEKLY',
};

/** Manual-claim completions render "(unverified)" even though the source
 *  is real — the one documented exception to the real/sim border rule.
 *  Dailies/weeklies are game-generated flavor, never real. */
function isRealContract(c: ContractClient): boolean {
  if (c.completionMethod === 'manual-claim') return false;
  return c.source === 'priority' || c.source === 'backlog' || c.source === 'gate';
}

function contractWord(c: ContractClient, reissued: boolean): string {
  if (c.completionMethod === 'manual-claim') return 'CLAIMED (unverified)';
  if (c.status === 'completed') return `${SOURCE_LABEL[c.source]} · DONE`;
  if (c.status === 'expired') return `${SOURCE_LABEL[c.source]} · EXPIRED`;
  // Minor finding: the SAME underlying sourceKey can show up as an open
  // contract AND a completed one (a daily/gate cycle re-issuing after a
  // prior completion) with no explanation — the honest fix is to say so,
  // not to guess whether it's really the same work or hide one copy.
  return reissued ? `${SOURCE_LABEL[c.source]} · REISSUED` : SOURCE_LABEL[c.source];
}

export interface ContractsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onDispatchContract: (contract: ContractClient) => void;
}

const REFRESH_INTERVAL_MS = 15_000;

/** CONTRACTS panel (KICKOFF-v3.1 stage-3 port): real vault todos/tracker
 *  gates rendered as payout-bearing contracts (GET /api/contracts, already
 *  live server-side — no WS-C addition needed for this surface). CLAIM
 *  button (manual-claim escape hatch, server rate-limited) + a "Dispatch"
 *  action that opens the CALL modal prefilled to this contract. */
export function ContractsPanel({ isOpen, onClose, onDispatchContract }: ContractsPanelProps) {
  const [contracts, setContracts] = useState<ContractClient[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => {
    void fetch('/api/contracts')
      .then((res) => res.json())
      .then((data: ContractClient[]) => setContracts(data))
      .catch(() => setContracts([]));
  };

  useEffect(() => {
    if (!isOpen) return;
    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const open = contracts.filter((c) => c.status === 'open');
  const resolved = contracts
    .filter((c) => c.status !== 'open')
    .sort((a, b) => (b.completedAt ?? b.expiredAt ?? 0) - (a.completedAt ?? a.expiredAt ?? 0))
    .slice(0, 10);
  const completedSourceKeys = new Set(
    contracts.filter((c) => c.status === 'completed').map((c) => c.sourceKey),
  );

  const handleClaim = (id: string) => {
    void fetch(`/api/contracts/${encodeURIComponent(id)}/claim`, { method: 'POST' })
      .then((res) => res.json())
      .then((body: { ok: boolean; reason?: string }) => {
        setMessage(body.ok ? null : `⚠ ${body.reason ?? 'claim failed'}`);
        load();
      });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`CONTRACTS — ${String(open.length)} OPEN`}
      testId="contracts-panel"
    >
      {message && <div className="modal__warn">{message}</div>}
      <div className="automation-list">
        {open.length === 0 && <span className="modal__muted">No open contracts right now.</span>}
        {open.map((c) => (
          <div key={c.id} className="automation-card" data-testid="contract-row">
            <div className="automation-card--row">
              <span className={isRealContract(c) ? 'signal-chip' : 'signal-chip signal-chip--sim'}>
                {SOURCE_GLYPH[c.source]} {contractWord(c, completedSourceKeys.has(c.sourceKey))}
              </span>
              <span>
                ${c.payoutCash}
                {c.payoutRep > 0 ? ` · ★${c.payoutRep}` : ''}
              </span>
            </div>
            <span title={c.title}>{c.title}</span>
            <div className="modal__actions">
              <button
                type="button"
                className="verb"
                onClick={() => handleClaim(c.id)}
                data-testid="contract-claim"
              >
                CLAIM
              </button>
              <button
                type="button"
                className="verb verb--confirm"
                data-testid="contract-dispatch"
                onClick={() => {
                  onDispatchContract(c);
                }}
              >
                DISPATCH
              </button>
            </div>
          </div>
        ))}
      </div>

      {resolved.length > 0 && (
        <div className="automation-list">
          <span className="modal__muted">RECENT</span>
          {resolved.map((c) => (
            <div key={c.id} className="automation-card--row" data-testid="contract-row-resolved">
              <span className={isRealContract(c) ? 'signal-chip' : 'signal-chip signal-chip--sim'}>
                {SOURCE_GLYPH[c.source]} {contractWord(c, false)}
              </span>
              <span className="modal__muted">{c.title}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
