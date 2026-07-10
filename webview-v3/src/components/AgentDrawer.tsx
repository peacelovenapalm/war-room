import { useEffect, useState } from 'react';

import type { AgentMap } from '../net/agentStore';
import { buildCopyIdLine, canKillAgent, type DispatchMachine } from '../net/dispatchFacts';
import { formatAge } from '../state/crisis';
import type { CrisisState } from '../state/crisisStore';
import { compactTokens } from '../state/hud';
import type { TailStreamState } from '../state/tailStore';
import { deriveVisualState, freshPoll, STATE_CHIPS } from '../state/visualState';
import { TailSheet } from './TailSheet';

/** Refresh cadence for the live-runner check while the drawer is open. */
const MACHINES_REFRESH_MS = 10_000;
/** Kill-outcome poll cadence + honest give-up (mirrors the v1 drawer). */
const KILL_POLL_INTERVAL_MS = 1_000;
const KILL_RESULT_TIMEOUT_MS = 15_000;

type KillPhase = 'idle' | 'confirm' | 'pending' | 'killed' | 'denied';

export interface AgentDrawerProps {
  agentId: number;
  agents: AgentMap;
  crisis: CrisisState;
  now: number;
  tail: TailStreamState | undefined;
  pinned: boolean;
  onTogglePin: () => void;
  onTogglePause: () => void;
  onClose: () => void;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="drawer-row" data-testid="drawer-row">
      <span className="drawer-row__label">{label}</span>
      <span className="drawer-row__value">{value}</span>
    </div>
  );
}

/**
 * Over-the-shoulder agent drawer (v1 port, stage-2 scope): every v1 fact —
 * machine, project dir, session id, provider, state chip, verbatim
 * waiting-for text, blocked age, token spend — plus the LIVE TAIL
 * (tailSubscribe is acquired by App when the drawer opens), COPY ID, and
 * the two-step KILL against the real /api/agents/kill gate with honest
 * disabled/denied states ("NO PID" / "NO RUNNER" / denial reason).
 */
export function AgentDrawer({
  agentId,
  agents,
  crisis,
  now,
  tail,
  pinned,
  onTogglePin,
  onTogglePause,
  onClose,
}: AgentDrawerProps) {
  const [machines, setMachines] = useState<DispatchMachine[]>([]);
  const [copied, setCopied] = useState(false);
  const [killPhase, setKillPhase] = useState<KillPhase>('idle');
  const [killReason, setKillReason] = useState<string | undefined>(undefined);
  const [killRequestId, setKillRequestId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/dispatch/machines');
        if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
        const data = (await res.json()) as DispatchMachine[];
        if (!cancelled) setMachines(data);
      } catch {
        if (!cancelled) setMachines([]);
      }
    };
    void load();
    const interval = setInterval(() => void load(), MACHINES_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // NOTE: App renders this drawer with key={agentId}, so switching agents
  // remounts and resets copied/kill state — no reset effect needed.

  // Poll the pid-kill outcome (no WS broadcast for this ephemeral lifecycle).
  useEffect(() => {
    if (killPhase !== 'pending' || killRequestId === null) return;
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

  const record = agents.get(agentId);
  if (!record) {
    return (
      <aside className="drawer" data-testid="agent-drawer">
        <header className="drawer__head">
          <span className="drawer__title">AGENT #{String(agentId)}</span>
          <button type="button" className="verb" data-testid="drawer-close" onClick={onClose}>
            ✕ CLOSE
          </button>
        </header>
        <div className="drawer__gone">✕ SESSION CLOSED — this agent left the floor.</div>
      </aside>
    );
  }

  const chip = STATE_CHIPS[deriveVisualState(record, now)];
  const poll = freshPoll(record, now);
  const since = crisis.fires.get(agentId)?.since ?? poll?.since;
  const blockedAge = since !== undefined ? formatAge(now - since) : '—';
  const pid = record.pid;
  const canKill = canKillAgent(pid, machines, record.machine);
  const copyLine = buildCopyIdLine(record.machine, record.cwd, record.sessionId);

  const handleCopy = () => {
    void navigator.clipboard.writeText(copyLine).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  const handleKill = () => {
    if (!canKill || record.machine === undefined || pid === undefined) return;
    if (killPhase === 'idle' || killPhase === 'denied') {
      setKillPhase('confirm');
      return;
    }
    if (killPhase !== 'confirm') return;
    setKillPhase('pending');
    void fetch('/api/agents/kill', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machine: record.machine, pid }),
    })
      .then((res) => res.json())
      .then((body: { ok: boolean; id?: string; reason?: string }) => {
        if (body.ok && body.id !== undefined) {
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
    <aside className="drawer" data-testid="agent-drawer">
      <header className="drawer__head">
        <span className="drawer__title">
          AGENT #{String(agentId)} · {chip.glyph} {chip.label}
        </span>
        <button type="button" className="verb" data-testid="drawer-close" onClick={onClose}>
          ✕ CLOSE
        </button>
      </header>

      <div className="drawer__facts">
        <Row label="MACHINE" value={record.machine ?? '(local)'} />
        <Row label="PROJECT DIR" value={record.cwd ?? record.name} />
        <Row label="SESSION ID" value={record.sessionId ?? '(unknown)'} />
        <Row label="PROVIDER" value={record.provider ?? 'claude'} />
        <Row label="STATE" value={`${chip.glyph} ${chip.label}`} />
        <Row label="NEEDS INPUT / PERMISSION" value={poll?.waitingFor ?? '—'} />
        <Row label="BLOCKED AGE" value={blockedAge} />
        <Row
          label="TOKENS"
          value={`${compactTokens(record.inputTokens)} in · ${compactTokens(record.outputTokens)} out`}
        />
      </div>

      {!canKill && (
        <div className="drawer__warn" data-testid="kill-disabled-reason">
          {pid === undefined
            ? '⚠ NO PID — use COPY ID'
            : `⚠ NO RUNNER on ${record.machine ?? 'this machine'} — KILL unavailable`}
        </div>
      )}
      {killPhase === 'denied' && (
        <div className="drawer__warn" data-testid="kill-denied-reason">
          {`⊘ KILL DENIED${killReason !== undefined ? ` — ${killReason}` : ''}`}
        </div>
      )}

      <div className="drawer__verbs">
        <button type="button" className="verb" data-testid="drawer-copy-id" onClick={handleCopy}>
          {copied ? '✓ COPIED' : '⧉ COPY ID'}
        </button>
        <button
          type="button"
          className={killPhase === 'confirm' ? 'verb verb--confirm' : 'verb'}
          data-testid="drawer-kill"
          disabled={!canKill || killPhase === 'pending' || killPhase === 'killed'}
          title="End this worker's session for real — two-step confirm"
          onClick={handleKill}
        >
          {killPhase === 'confirm' && '⚠ CONFIRM KILL'}
          {killPhase === 'pending' && '⏳ KILLING…'}
          {killPhase === 'killed' && '✕ KILLED'}
          {(killPhase === 'idle' || killPhase === 'denied') && '✕ KILL'}
        </button>
      </div>

      <TailSheet
        state={tail}
        onTogglePause={onTogglePause}
        onTogglePin={onTogglePin}
        pinned={pinned}
      />
    </aside>
  );
}
