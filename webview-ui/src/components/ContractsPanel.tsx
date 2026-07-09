import { useEffect, useState } from 'react';

import type { EmployeeSnapshotClient } from '../hooks/useExtensionMessages.js';
import { SignalChip } from './ui/SignalChip.js';

/** Mirrors server/src/contractStore.ts's Contract shape (GAME-DESIGN §6.2). */
export interface ContractClient {
  id: string;
  source: 'priority' | 'backlog' | 'gate' | 'daily' | 'weekly';
  title: string;
  sourceKey: string;
  payoutCash: number;
  payoutRep: number;
  status: 'open' | 'completed' | 'expired';
  completionMethod?:
    | 'todo-disappeared'
    | 'gate-flipped'
    | 'dispatch-result'
    | 'manual-claim'
    | 'daily-auto';
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

/** GAME-DESIGN §6.1: contracts derived from real vault todos/gates render
 *  real=true, EXCEPT manual-claim completions, which render dashed +
 *  "(unverified)" even though the underlying source is real -- the one
 *  documented exception to the real/SIM border rule. Dailies/weeklies are
 *  game-generated flavor, never real. */
function isRealContract(c: ContractClient): boolean {
  if (c.completionMethod === 'manual-claim') return false;
  return c.source === 'priority' || c.source === 'backlog' || c.source === 'gate';
}

function contractWord(c: ContractClient): string {
  if (c.completionMethod === 'manual-claim') return 'CLAIMED (unverified)';
  if (c.status === 'completed') return `${SOURCE_LABEL[c.source]} · DONE`;
  if (c.status === 'expired') return `${SOURCE_LABEL[c.source]} · EXPIRED`;
  return SOURCE_LABEL[c.source];
}

interface ContractsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  employees: Record<string, EmployeeSnapshotClient>;
  /** Opens the CALL modal prefilled from a contract + the chosen employee
   *  (GAME-DESIGN §6.2's dispatch-result completion path — the explicit
   *  contractId, never string-matched). */
  onDispatchContract: (contract: ContractClient, employee: EmployeeSnapshotClient) => void;
}

const REFRESH_INTERVAL_MS = 15_000;

/**
 * CONTRACTS panel (v2 mechanic G4 — GAME-DESIGN.md §6.2). Mirrors
 * TriagePanel.tsx's row structure (glyph+word chip, identity, one-line
 * detail) — CLAIM button (manual-claim escape hatch, rate-limited
 * server-side to 3/day) + an employee-assign dropdown that opens the CALL
 * modal prefilled to dispatch this contract via that employee.
 */
export function ContractsPanel({
  isOpen,
  onClose,
  employees,
  onDispatchContract,
}: ContractsPanelProps) {
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
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  const open = contracts.filter((c) => c.status === 'open');
  const resolved = contracts
    .filter((c) => c.status !== 'open')
    .sort((a, b) => (b.completedAt ?? b.expiredAt ?? 0) - (a.completedAt ?? a.expiredAt ?? 0))
    .slice(0, 10);

  const activeEmployees = Object.values(employees).filter((e) => e.status === 'active');

  const handleClaim = (id: string) => {
    void fetch(`/api/contracts/${encodeURIComponent(id)}/claim`, { method: 'POST' })
      .then((res) => res.json())
      .then((body: { ok: boolean; reason?: string }) => {
        setMessage(body.ok ? null : `⚠ ${body.reason ?? 'claim failed'}`);
        load();
      });
  };

  return (
    <div
      className="pixel-panel flex flex-col max-w-md max-h-[70vh] overflow-y-auto"
      data-testid="contracts-panel"
    >
      <div className="flex items-center justify-between py-4 px-8 border-b-2 border-border">
        <span className="font-bold text-sm">CONTRACTS — {open.length} OPEN</span>
        <button
          onClick={onClose}
          className="text-xs max-sm:min-w-44 max-sm:min-h-44 max-sm:shrink-0 max-sm:flex max-sm:items-center max-sm:justify-center"
          aria-label="Close contracts panel"
        >
          ✗
        </button>
      </div>

      {message && <div className="py-2 px-8 text-xs text-status-permission">{message}</div>}

      <div className="flex flex-col gap-3 py-4 px-8">
        {open.length === 0 && (
          <span className="text-xs text-text-muted">No open contracts right now.</span>
        )}
        {open.map((c) => (
          <div
            key={c.id}
            className="flex flex-col gap-2 pixel-panel py-3 px-4"
            data-testid="contract-row"
          >
            <div className="flex items-center justify-between gap-3">
              <SignalChip
                glyph={SOURCE_GLYPH[c.source]}
                word={contractWord(c)}
                real={isRealContract(c)}
              />
              <span className="text-xs whitespace-nowrap">
                ${c.payoutCash}
                {c.payoutRep > 0 ? ` · ★${c.payoutRep}` : ''}
              </span>
            </div>
            <span className="text-sm" title={c.title}>
              {c.title}
            </span>
            <div className="flex items-center gap-3">
              <button
                className="text-xs border-2 border-border rounded-none py-1 px-3
                  max-sm:min-w-44 max-sm:min-h-44 max-sm:flex max-sm:items-center max-sm:justify-center"
                onClick={() => handleClaim(c.id)}
                data-testid="contract-claim"
              >
                CLAIM
              </button>
              {activeEmployees.length > 0 && (
                <select
                  className="text-xs border-2 border-border bg-bg text-text py-1 px-2 rounded-none max-sm:min-h-44"
                  defaultValue=""
                  onChange={(e) => {
                    const emp = employees[e.target.value];
                    if (emp) onDispatchContract(c, emp);
                    e.target.value = '';
                  }}
                  data-testid="contract-assign-employee"
                >
                  <option value="" disabled>
                    Dispatch via…
                  </option>
                  {activeEmployees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        ))}
      </div>

      {resolved.length > 0 && (
        <div className="flex flex-col gap-2 py-4 px-8 border-t-2 border-border">
          <span className="text-xs text-text-muted">RECENT</span>
          {resolved.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-3"
              data-testid="contract-row-resolved"
            >
              <SignalChip
                glyph={SOURCE_GLYPH[c.source]}
                word={contractWord(c)}
                real={isRealContract(c)}
              />
              <span className="text-xs text-text-muted truncate">{c.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
