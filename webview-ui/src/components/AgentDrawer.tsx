import { useEffect, useState } from 'react';

import { buildCopyIdLine, canFocusAgent, type DispatchMachine } from '../dispatch.js';
import { deriveVisualState, STATE_CHIPS } from '../office/agentState.js';
import { formatAge } from '../office/crisis.js';
import type { OfficeState } from '../office/engine/officeState.js';
import type { ToolActivity } from '../office/types.js';
import { compactTokens } from '../shiftReport.js';
import { transport } from '../transport/index.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

/** Refresh cadence for the FOCUS availability check while the drawer is open. */
const REFRESH_INTERVAL_MS = 10_000;

interface AgentDrawerProps {
  agentId: number | null;
  officeState: OfficeState;
  agentTools: Record<number, ToolActivity[]>;
  onClose: () => void;
  /** Registers a send so the tray can flag it "⚠ NOT QUEUED" if no
   *  dispatchUpdate arrives — dispatchRequest has no ack on the wire. */
  onSend: (machine: string, action: 'focus') => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-8 py-3 text-sm" data-testid="drawer-row">
      <span className="shrink-0 font-bold text-text-muted">{label}</span>
      <span className="text-right break-all">{value}</span>
    </div>
  );
}

/** Agent detail drawer (Greg's direct ask, mechanic #6b): click any office
 *  agent to see machine, project dir, session id, exact NEEDS-INPUT/
 *  permission text, blocked age, and token spend — ends the "a fire is
 *  burning but which window is it?" problem. FOCUS best-effort fronts the
 *  session's real terminal on that machine (deny-by-default runner side);
 *  COPY ID always works as the honest fallback. */
export function AgentDrawer({
  agentId,
  officeState,
  agentTools,
  onClose,
  onSend,
}: AgentDrawerProps) {
  const [machines, setMachines] = useState<DispatchMachine[]>([]);
  const [copied, setCopied] = useState(false);
  // Ticks the blocked-age display while the drawer is open (Date.now() must
  // not be called directly in render — react-hooks/purity).
  const [now, setNow] = useState(() => Date.now());

  const isOpen = agentId !== null;

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/dispatch/machines');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as DispatchMachine[];
        if (!cancelled) setMachines(data);
      } catch (err) {
        console.log('[AgentDrawer] failed to fetch /api/dispatch/machines:', err);
      }
    };
    void load();
    const interval = setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isOpen]);

  useEffect(() => {
    setCopied(false);
  }, [agentId]);

  if (agentId === null) return null;
  const ch = officeState.characters.get(agentId);
  if (!ch) return null;

  const tools = agentTools[agentId];
  const visualState = deriveVisualState(ch, tools);
  const chip = STATE_CHIPS[visualState];
  const since = ch.crisis?.since ?? ch.pollState?.since;
  const blockedAge = since !== undefined ? formatAge(now - since) : null;
  // The runner's focus action fronts a terminal by OS pid — it ignores
  // sessionId entirely and denies with reason "missing-pid" without one.
  // pid arrives via the hook forwarder's X-Pid header (server AgentState.pid,
  // carried through AgentCreated/ExistingAgents/agentPidUpdate); it's absent
  // for sessions predating the forwarder install, so FOCUS stays honestly
  // disabled ("NO PID") until telemetry actually arrives for THIS session —
  // never send a request we know the runner will deny.
  const pid = ch.pid;
  const canFocus = canFocusAgent(pid, machines, ch.machine);
  const copyLine = buildCopyIdLine(ch.machine, ch.cwd, ch.sessionId);

  const handleFocus = () => {
    if (!canFocus || !ch.machine || pid === undefined) return;
    transport.send({
      type: 'dispatchRequest',
      action: 'focus',
      machine: ch.machine,
      pid,
    });
    onSend(ch.machine, 'focus');
  };

  const handleCopy = () => {
    void navigator.clipboard.writeText(copyLine).then(() => setCopied(true));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`AGENT #${agentId}`}
      className="max-w-md w-full"
    >
      <div className="px-10 pb-10">
        <div className="flex flex-col divide-y divide-border mb-8">
          <Row label="MACHINE" value={ch.machine ?? '(local)'} />
          <Row label="PROJECT DIR" value={ch.cwd ?? ch.folderName ?? '(unknown)'} />
          <Row label="SESSION ID" value={ch.sessionId ?? '(unknown)'} />
          <Row label="PROVIDER" value={ch.provider ?? 'claude'} />
          <Row label="STATE" value={`${chip.glyph} ${chip.label}`} />
          <Row label="NEEDS INPUT / PERMISSION" value={ch.pollState?.waitingFor ?? '—'} />
          <Row label="BLOCKED AGE" value={blockedAge ?? '—'} />
          <Row
            label="TOKENS"
            value={`${compactTokens(ch.inputTokens ?? 0)} in · ${compactTokens(ch.outputTokens ?? 0)} out`}
          />
        </div>

        {!canFocus && (
          <div className="text-sm text-warning mb-8">
            {pid === undefined
              ? '⚠ NO PID — use COPY ID'
              : `⚠ NO RUNNER on ${ch.machine ?? 'this machine'}`}
          </div>
        )}

        <div className="flex justify-end gap-6">
          <Button variant="default" onClick={handleCopy}>
            {copied ? 'Copied ✓' : 'Copy ID'}
          </Button>
          <Button
            variant={canFocus ? 'accent' : 'disabled'}
            onClick={handleFocus}
            disabled={!canFocus}
            title={pid === undefined ? 'No PID available — use Copy ID instead' : undefined}
          >
            Focus
          </Button>
        </div>
      </div>
    </Modal>
  );
}
