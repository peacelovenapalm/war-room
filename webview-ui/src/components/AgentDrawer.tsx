import { useEffect, useState } from 'react';

import { buildCopyIdLine, canFocusAgent, canKillAgent, type DispatchMachine } from '../dispatch.js';
import { deriveVisualState, STATE_CHIPS } from '../office/agentState.js';
import { formatAge } from '../office/crisis.js';
import type { OfficeState } from '../office/engine/officeState.js';
import type { ToolActivity } from '../office/types.js';
import { compactTokens } from '../shiftReport.js';
import { transport } from '../transport/index.js';
import { Button } from './ui/Button.js';
import { ControlTooltip } from './ui/ControlTooltip.js';
import { Modal } from './ui/Modal.js';

/** Refresh cadence for the FOCUS availability check while the drawer is open. */
const REFRESH_INTERVAL_MS = 10_000;

/** Cadence for polling the KILL outcome (KICKOFF v1.1 item 3) — the actual
 *  kill happens on the target machine's NEXT poll tick (~5s by default),
 *  after which the runner reports back; this just needs to catch that
 *  report reasonably promptly, not in real time. */
const KILL_POLL_INTERVAL_MS = 1_000;
/** Give up waiting for a runner report after this long and show an honest
 *  "no response" denial rather than spinning forever (e.g. the machine's
 *  runner went offline mid-request). */
const KILL_RESULT_TIMEOUT_MS = 15_000;

type KillPhase = 'idle' | 'confirm' | 'pending' | 'killed' | 'denied';

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

  // Worker session kill (KICKOFF v1.1 item 3): two-step confirm (mirrors
  // StopAllControl's pattern), then a transient 'pending' state while the
  // target machine's runner is polled and reports back, landing on a
  // terminal 'killed' or 'denied'.
  const [killPhase, setKillPhase] = useState<KillPhase>('idle');
  const [killReason, setKillReason] = useState<string | undefined>(undefined);
  const [killRequestId, setKillRequestId] = useState<string | null>(null);

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
    setKillPhase('idle');
    setKillReason(undefined);
    setKillRequestId(null);
  }, [agentId]);

  // Poll the pid-kill outcome (no WS broadcast for this ephemeral,
  // in-memory-only lifecycle — see PidKillRecord's doc in dispatchStore.ts).
  useEffect(() => {
    if (killPhase !== 'pending' || !killRequestId) return;
    let cancelled = false;
    const startedAt = Date.now();
    const interval = setInterval(() => {
      void fetch(`/api/agents/kill/${killRequestId}`)
        .then(async (res) => {
          if (!res.ok) return null;
          return (await res.json()) as { status: 'pending' | 'killed' | 'denied'; reason?: string };
        })
        .then((body) => {
          if (cancelled) return;
          if (body?.status === 'killed') {
            setKillPhase('killed');
          } else if (body?.status === 'denied') {
            setKillPhase('denied');
            setKillReason(body.reason);
          } else if (Date.now() - startedAt > KILL_RESULT_TIMEOUT_MS) {
            setKillPhase('denied');
            setKillReason('no response from runner');
          }
        })
        .catch(() => {
          if (!cancelled && Date.now() - startedAt > KILL_RESULT_TIMEOUT_MS) {
            setKillPhase('denied');
            setKillReason('no response from runner');
          }
        });
    }, KILL_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [killPhase, killRequestId]);

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
  // Worker session kill (KICKOFF v1.1 item 3): same reach as FOCUS's pid
  // requirement, but gated on ANY live runner rather than one specifically
  // advertising focus support — see canKillAgent's doc.
  const canKill = canKillAgent(pid, machines, ch.machine);
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

  const handleKill = () => {
    if (!canKill || !ch.machine || pid === undefined) return;
    if (killPhase === 'idle') {
      setKillPhase('confirm');
      return;
    }
    if (killPhase !== 'confirm') return; // pending/killed/denied — nothing left to click
    setKillPhase('pending');
    void fetch('/api/agents/kill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machine: ch.machine, pid }),
    })
      .then((res) => res.json())
      .then((body: { ok: boolean; id?: string; reason?: string }) => {
        if (body.ok && body.id) {
          setKillRequestId(body.id);
        } else {
          setKillPhase('denied');
          setKillReason(body.reason ?? 'request rejected');
        }
      })
      .catch(() => {
        setKillPhase('denied');
        setKillReason('request failed');
      });
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

        {!canKill && (
          <div className="text-sm text-warning mb-8" data-testid="kill-disabled-reason">
            {pid === undefined
              ? '⚠ NO PID — use COPY ID'
              : `⚠ NO RUNNER on ${ch.machine ?? 'this machine'} — KILL unavailable`}
          </div>
        )}

        {killPhase === 'denied' && (
          <div className="text-sm text-warning mb-8" data-testid="kill-denied-reason">
            {`⊘ KILL DENIED${killReason ? ` — ${killReason}` : ''}`}
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
          <ControlTooltip label="End this worker's session for real — two-step confirm" side="top">
            <Button
              variant={
                killPhase === 'confirm'
                  ? 'accent'
                  : canKill && (killPhase === 'idle' || killPhase === 'denied')
                    ? 'default'
                    : 'disabled'
              }
              onClick={handleKill}
              disabled={!canKill || killPhase === 'pending' || killPhase === 'killed'}
              title={pid === undefined ? 'No PID available — use Copy ID instead' : undefined}
              data-testid="kill-control"
            >
              {killPhase === 'confirm' && '⚠ CONFIRM'}
              {killPhase === 'pending' && '⏳ KILLING…'}
              {killPhase === 'killed' && '✕ KILLED'}
              {(killPhase === 'idle' || killPhase === 'denied') && '✕ Kill'}
            </Button>
          </ControlTooltip>
        </div>
      </div>
    </Modal>
  );
}
