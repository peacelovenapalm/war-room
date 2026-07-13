import { useEffect, useState } from 'react';

import type { ClientMessage } from '../../../core/src/messages.js';
import type { AgentMap } from '../net/agentStore';
import {
  ANSWER_POLL_INTERVAL_MS,
  ANSWER_RESULT_TIMEOUT_MS,
  ANSWER_TEXT_MAX_CHARS,
  type AnswerReceipt,
  answerStatusLabel,
  type ComposerVerb,
  fetchAnswerReceipts,
  fetchLaunchedVia,
  parseAnswerOptions,
  pollAnswerOutcome,
  requestAnswer,
  requestPrompt,
} from '../net/answerFacts';
import {
  buildCopyIdLine,
  canFocusAgent,
  canKillAgent,
  type DispatchMachine,
  machineSupportsFocus,
} from '../net/dispatchFacts';
import {
  KILL_POLL_INTERVAL_MS,
  KILL_RESULT_TIMEOUT_MS,
  pollKillOutcome,
  requestKill,
} from '../net/killAgent';
import { buildFocusMessage } from '../net/opsProposals';
import { blockedAgeAnchor } from '../state/blockedAge';
import { formatAge } from '../state/crisis';
import type { CrisisState } from '../state/crisisStore';
import { compactTokens } from '../state/hud';
import type { TailStreamState } from '../state/tailStore';
import { currentActiveTool, sortedSubagents, type ToolActivityMap } from '../state/toolActivity';
import { deriveVisualState, freshPoll, STATE_CHIPS } from '../state/visualState';
import { ControlTip } from './ControlTip';
import { TailSheet } from './TailSheet';

/** Live elapsed-seconds display for the NOW RUNNING row — recomputed off
 *  the same age tick every other drawer fact uses (`now` prop), never its
 *  own timer. */
function elapsedSeconds(startedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

/** Refresh cadence for the live-runner check while the drawer is open. */
const MACHINES_REFRESH_MS = 10_000;
/** How long the FOCUS button shows "▸ SENT" after a tap — dispatchRequest
 *  has no ack on the wire (buildFocusMessage's doc), so this is honestly
 *  labeled as a send confirmation, never a success/done claim. */
const FOCUS_SENT_DISPLAY_MS = 2_000;
/** Refresh cadence for the answer receipts list while the drawer is open. */
const ANSWERS_REFRESH_MS = 5_000;

type KillPhase = 'idle' | 'confirm' | 'pending' | 'killed' | 'denied';

/** ANSWER composer phases — 'compose' (free-text + one-tap options),
 *  'confirm' (verbatim-prompt discipline: show the exact text before it's
 *  ever sent), then the real delivery outcome. No fake states: 'sending'
 *  renders "DELIVERING…" only once the POST is actually in flight. */
type AnswerPhase = 'compose' | 'confirm' | 'sending' | 'delivered' | 'denied';

export interface AgentDrawerProps {
  agentId: number;
  agents: AgentMap;
  /** T1c (FACE-MERGE-PLAN.md) — current tool + subagent activity, keyed by
   *  agentId. Many agents predate this store (it only starts filling once
   *  the first tool event arrives), so its absence renders NOTHING — never
   *  a fake IDLE row. */
  toolActivity: ToolActivityMap;
  crisis: CrisisState;
  now: number;
  tail: TailStreamState | undefined;
  pinned: boolean;
  onTogglePin: () => void;
  onTogglePause: () => void;
  onClose: () => void;
  /** Real WS send — same function CallModal/OpsReviewPanel use. FOCUS has
   *  no ack on the wire (buildFocusMessage's doc), so the drawer only ever
   *  shows an honest transient "sent" state, never a fabricated success. */
  send: (message: ClientMessage) => void;
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
  toolActivity,
  crisis,
  now,
  tail,
  pinned,
  onTogglePin,
  onTogglePause,
  onClose,
  send,
}: AgentDrawerProps) {
  const [machines, setMachines] = useState<DispatchMachine[]>([]);
  const [copied, setCopied] = useState(false);
  const [killPhase, setKillPhase] = useState<KillPhase>('idle');
  const [killReason, setKillReason] = useState<string | undefined>(undefined);
  const [killRequestId, setKillRequestId] = useState<string | null>(null);
  const [focusSent, setFocusSent] = useState(false);

  // T2/T4 remote-answer plane — composer local state.
  const [answerPhase, setAnswerPhase] = useState<AnswerPhase>('compose');
  const [answerText, setAnswerText] = useState('');
  const [answerReason, setAnswerReason] = useState<string | undefined>(undefined);
  const [answerRequestId, setAnswerRequestId] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<AnswerReceipt[]>([]);
  // C3 free-form PROMPT verb — mode toggle on the SAME composer/phase
  // machinery (gate 4 CLOSED: shared plumbing, not a second composer).
  // Gated on the identical `managed === true` check as ANSWER — see the
  // `!managed`/`managed &&` branches below, which render neither mode's
  // entry point for an unmanaged agent.
  const [composerVerb, setComposerVerb] = useState<ComposerVerb>('answer');
  // C3 born-managed wrapper — read-only "LAUNCHED VIA" fact, fetched
  // alongside the machines poll cadence once this agent is managed.
  const [launchedVia, setLaunchedVia] = useState<'wrapper' | 'call-modal' | undefined>(undefined);

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

  // FOCUS's "▸ SENT" is a transient send confirmation, not a lasting
  // status — revert to the idle label after FOCUS_SENT_DISPLAY_MS.
  useEffect(() => {
    if (!focusSent) return;
    const timeout = setTimeout(() => {
      setFocusSent(false);
    }, FOCUS_SENT_DISPLAY_MS);
    return () => clearTimeout(timeout);
  }, [focusSent]);

  // Poll the pid-kill outcome (no WS broadcast for this ephemeral lifecycle).
  useEffect(() => {
    if (killPhase !== 'pending' || killRequestId === null) return;
    let cancelled = false;
    const startedAt = Date.now();
    const interval = setInterval(() => {
      void pollKillOutcome(killRequestId).then((body) => {
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
      });
    }, KILL_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [killPhase, killRequestId]);

  const record = agents.get(agentId);
  const managed = record?.managed ?? false;
  const machine = record?.machine;

  // T2/T4 remote-answer plane — poll the delivery outcome (same "no WS
  // broadcast for this ephemeral lifecycle" tolerance as KILL).
  useEffect(() => {
    if (answerPhase !== 'sending' || answerRequestId === null) return;
    let cancelled = false;
    const startedAt = Date.now();
    const interval = setInterval(() => {
      void pollAnswerOutcome(answerRequestId).then((body) => {
        if (cancelled) return;
        if (body?.status === 'delivered') {
          setAnswerPhase('delivered');
        } else if (body?.status === 'denied') {
          setAnswerPhase('denied');
          setAnswerReason(body.reason);
        } else if (Date.now() - startedAt > ANSWER_RESULT_TIMEOUT_MS) {
          setAnswerPhase('denied');
          setAnswerReason('no response from runner');
        }
      });
    }, ANSWER_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [answerPhase, answerRequestId]);

  // T2/T4 remote-answer plane — receipts (one-tap-real: the VERBATIM text
  // IS the receipt). Machine-level scope: the drawer never learns its own
  // managedSessionRef (the answer POST response only echoes the request
  // id), so this is the honest fallback the design calls out rather than a
  // false narrower filter.
  useEffect(() => {
    // Not fetched when non-managed/no machine — the render only shows the
    // receipts section when `managed` is true, so stale state here never
    // surfaces (avoids a synchronous setState-in-effect on every
    // non-managed agent's mount, which would cascade renders for nothing).
    if (!managed || !machine) return;
    let cancelled = false;
    const load = () => {
      void fetchAnswerReceipts(machine).then((data) => {
        if (!cancelled) setReceipts(data);
      });
    };
    load();
    const interval = setInterval(load, ANSWERS_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [managed, machine]);

  // C3 born-managed wrapper — read-only "LAUNCHED VIA" fact. Same managed
  // gate as receipts; refetched on the same cadence as the machines poll
  // (a session's launchedVia never changes after creation, so this is
  // mostly about picking it up once managed flips true, not tracking a
  // live transition).
  const recordPid = record?.pid;
  useEffect(() => {
    // No setState here on the early-out: `launchedVia` is only ever
    // RENDERED behind `managed && launchedVia !== undefined` below, so a
    // stale value surviving a transition to unmanaged is harmless — it
    // just never shows. Avoids a synchronous setState-in-effect on every
    // non-managed agent's mount/update (same rationale as the receipts
    // effect just above).
    if (!managed || !machine || recordPid === undefined) return;
    let cancelled = false;
    const load = () => {
      void fetchLaunchedVia(machine, recordPid).then((value) => {
        if (!cancelled) setLaunchedVia(value);
      });
    };
    load();
    const interval = setInterval(load, MACHINES_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [managed, machine, recordPid]);

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
  // C9-3: BLOCKED AGE anchors ONLY to the needs-input fire's onset — never a
  // fall-back to poll?.since, which is the CURRENT poll snapshot's age (not a
  // blocked age) and made non-blocked agents show a stale, ever-growing
  // duration. A non-blocked agent has no fire → "—".
  const since = blockedAgeAnchor(crisis.fires.get(agentId));
  const blockedAge = since !== undefined ? formatAge(now - since) : '—';
  const pid = record.pid;
  const canKill = canKillAgent(pid, machines, record.machine);
  // FOCUS button: same "hide, don't show a dead control" posture as v1 —
  // a machine that never advertised focus:true has no plane for this verb
  // at all, so the button doesn't render rather than sitting permanently
  // disabled. When the machine DOES support focus, canFocus additionally
  // requires a real pid (see canFocusAgent's doc) and the button stays
  // visible-but-disabled with an honest reason in that case.
  const focusCapable = machineSupportsFocus(machines, record.machine);
  const canFocus = canFocusAgent(pid, machines, record.machine);
  const copyLine = buildCopyIdLine(record.machine, record.cwd, record.sessionId);

  // T1c — NOW RUNNING: honest empty state. This agent's activity record
  // (and every subagent's) is undefined until the first tool event
  // actually arrives for it, so `activity`/`current`/`subagents` all fall
  // back to "nothing to show" rather than a fabricated IDLE.
  const activity = toolActivity.get(agentId);
  const current = currentActiveTool(activity);
  const subagents = sortedSubagents(activity);

  const handleCopy = () => {
    void navigator.clipboard.writeText(copyLine).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  const handleFocus = () => {
    if (!canFocus || record.machine === undefined || pid === undefined) return;
    send(
      buildFocusMessage({
        verb: 'focus',
        label: 'FOCUS',
        params: { machine: record.machine, pid },
      }),
    );
    setFocusSent(true);
  };

  const handleKill = () => {
    if (!canKill || record.machine === undefined || pid === undefined) return;
    if (killPhase === 'idle' || killPhase === 'denied') {
      setKillPhase('confirm');
      return;
    }
    if (killPhase !== 'confirm') return;
    setKillPhase('pending');
    void requestKill(record.machine, pid).then((body) => {
      if (body.ok && body.id !== undefined) {
        setKillRequestId(body.id);
      } else {
        setKillPhase('denied');
        setKillReason(body.reason ?? 'request rejected');
      }
    });
  };

  // T2/T4 remote-answer plane — free-text ALWAYS available; a defensively
  // parsed AskUserQuestion option list ALSO renders as one-tap choices that
  // prefill the text (never invent options — parseAnswerOptions.ts is [] on
  // any ambiguity). Every path — typed or tapped — passes through the same
  // confirm step (verbatim-prompt discipline) before anything is sent.
  // C3: one-tap options are ANSWER-only (they come from parsing the pending
  // question's own text) — PROMPT mode never renders them, since a PROMPT
  // is not a reply to anything in particular.
  const answerOptions = composerVerb === 'answer' ? parseAnswerOptions(poll?.waitingFor) : [];
  const answerRemaining = ANSWER_TEXT_MAX_CHARS - answerText.length;
  const canSendAnswer = managed && answerText.trim() !== '' && answerRemaining >= 0;

  const handleSelectAnswerOption = (option: string) => {
    setAnswerText(option);
    setAnswerPhase('confirm');
  };

  const handleSelectComposerVerb = (verb: ComposerVerb) => {
    if (verb === composerVerb) return;
    setComposerVerb(verb);
    // Switching modes mid-compose discards in-flight text/phase — the
    // verbatim-confirm step is about to show DIFFERENT semantics (a reply
    // vs. an unprompted instruction), so carrying stale text across modes
    // would risk confirming the wrong kind of send.
    setAnswerPhase('compose');
    setAnswerText('');
    setAnswerReason(undefined);
    setAnswerRequestId(null);
  };

  const handleAnswerNext = () => {
    if (answerPhase === 'compose') {
      if (!canSendAnswer) return;
      setAnswerPhase('confirm');
      return;
    }
    if (answerPhase !== 'confirm' || record.machine === undefined || pid === undefined) return;
    setAnswerPhase('sending');
    const sendComposer = composerVerb === 'prompt' ? requestPrompt : requestAnswer;
    void sendComposer(record.machine, pid, answerText).then((body) => {
      if (body.ok && body.id !== undefined) {
        setAnswerRequestId(body.id);
      } else {
        setAnswerPhase('denied');
        setAnswerReason(body.reason ?? 'request rejected');
      }
    });
  };

  const handleAnswerBack = () => {
    setAnswerPhase('compose');
  };

  const handleAnswerReset = () => {
    setAnswerPhase('compose');
    setAnswerText('');
    setAnswerReason(undefined);
    setAnswerRequestId(null);
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
        {/* One-tap-real: token counts are real for ANY agent whose machine
            actually streams usage — local sessions via the JSONL tap
            (transcriptParser.ts), remote sessions via a running
            transcript-tailer daemon on that machine (T1 remote live-tail
            plane: POST /api/agents/output → the same agentTokenUsage
            broadcast, consumed here identically regardless of machine —
            see agentStore.ts's agentTokenUsage case, which has no
            machine branch). A remote machine with NO tailer installed
            (per-machine opt-in) never gets usage records, so its counters
            legitimately sit at 0 forever — a permanent "0 in · 0 out"
            would read as a real measurement, so NO DATA stays the honest
            render for that case. It is never a stand-in for "this plane
            doesn't work yet". */}
        <Row
          label="TOKENS"
          value={
            record.inputTokens === 0 && record.outputTokens === 0
              ? '— NO DATA (no transcript access)'
              : `${compactTokens(record.inputTokens)} in · ${compactTokens(record.outputTokens)} out`
          }
        />
      </div>

      {/* T1c (FACE-MERGE-PLAN.md) — NOW RUNNING: ported from webview-ui's
          canvas tool rendering. Honest empty state: renders NOTHING when
          this agent has no in-flight tool AND no subagents — many agents
          predate this store (it only fills from the first tool event
          onward), and a fake IDLE row would be worse than no row. */}
      {(current !== undefined || subagents.length > 0) && (
        <div className="drawer__facts" data-testid="drawer-now-running">
          {current !== undefined && (
            <Row
              label="NOW RUNNING"
              value={`▸ ${current.name} (${String(elapsedSeconds(current.startedAt, now))}s${
                current.runInBackground ? ', background' : ''
              })`}
            />
          )}
          {subagents.length > 0 && (
            <Row
              label={`⧉ ${String(subagents.length)} SUBAGENT${subagents.length === 1 ? '' : 'S'}`}
              value={subagents
                .map((sub) => {
                  const tool = currentActiveTool(sub);
                  return tool ? `▸ ${tool.name}` : sub.permissionWait ? '⚠ permission' : '…';
                })
                .join('  ·  ')}
            />
          )}
        </div>
      )}

      {focusCapable && !canFocus && (
        <div className="drawer__warn" data-testid="focus-disabled-reason">
          ⚠ NO PID — use COPY ID
        </div>
      )}
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
        <ControlTip label="Copies MACHINE · project dir · session id — works even when KILL is unavailable.">
          <button type="button" className="verb" data-testid="drawer-copy-id" onClick={handleCopy}>
            {copied ? '✓ COPIED' : '⧉ COPY ID'}
          </button>
        </ControlTip>
        {/* Hidden entirely (not a dead disabled control) when the machine
            never advertised focus:true — v1's gate, see canFocusAgent. */}
        {focusCapable && (
          <ControlTip
            label={
              canFocus
                ? 'Fronts the real terminal window on its machine — best-effort, no ack on the wire.'
                : 'No PID available — use COPY ID instead.'
            }
          >
            <button
              type="button"
              className="verb"
              data-testid="drawer-focus"
              disabled={!canFocus}
              onClick={handleFocus}
            >
              {focusSent ? '▸ SENT' : '⌖ FOCUS'}
            </button>
          </ControlTip>
        )}
        <ControlTip label="End this worker's session for real — two-step confirm, real /api/agents/kill.">
          <button
            type="button"
            className={killPhase === 'confirm' ? 'verb verb--confirm' : 'verb'}
            data-testid="drawer-kill"
            disabled={!canKill || killPhase === 'pending' || killPhase === 'killed'}
            onClick={handleKill}
          >
            {killPhase === 'confirm' && '⚠ CONFIRM KILL'}
            {killPhase === 'pending' && '⏳ KILLING…'}
            {killPhase === 'killed' && '✕ KILLED'}
            {(killPhase === 'idle' || killPhase === 'denied') && '✕ KILL'}
          </button>
        </ControlTip>
      </div>

      {/* T2/T4 remote-answer plane (REMOTE-ANSWER-DESIGN.md): ANSWER only
          renders when the runner has advertised this agent as one it
          launched + owns. Every other agent — including any pre-existing
          session the runner merely observes — keeps this honest row
          instead, forever (the runner can only ever answer sessions it
          supervises, by construction, not by policy). */}
      {!managed && (
        <div className="drawer__warn" data-testid="answer-desk-only">
          ⌨ DESK-only — not launched via War Room, so no plane exists to type into it remotely.
        </div>
      )}

      {/* C3 born-managed wrapper — read-only fact, only meaningful once
          managed (an unmanaged session was never launched via War Room at
          all). Absent (pre-C3 session, or the lookup hasn't resolved yet)
          renders nothing rather than a fabricated "call-modal" default. */}
      {managed && launchedVia !== undefined && (
        <div className="drawer__facts">
          <Row
            label="LAUNCHED VIA"
            value={launchedVia === 'wrapper' ? 'wr claude' : 'CALL modal'}
          />
        </div>
      )}

      {managed && (
        <div className="drawer__answer" data-testid="answer-composer">
          {/* C3 free-form PROMPT verb — mode toggle, SAME managed gate as
              the composer below it. Unmanaged sessions never render this
              block at all (see the `!managed` DESK-only row above), so
              there is no way to reach PROMPT mode without `managed===true`
              — identical gate to ANSWER, by construction. */}
          <div className="drawer__verbs" data-testid="composer-mode-toggle">
            <button
              type="button"
              className={composerVerb === 'answer' ? 'verb verb--confirm' : 'verb'}
              data-testid="composer-mode-answer"
              onClick={() => {
                handleSelectComposerVerb('answer');
              }}
            >
              ANSWER
            </button>
            <ControlTip label="Send free text into this session regardless of whether it's currently asking a question — same as typing at its keyboard.">
              <button
                type="button"
                className={composerVerb === 'prompt' ? 'verb verb--confirm' : 'verb'}
                data-testid="composer-mode-prompt"
                onClick={() => {
                  handleSelectComposerVerb('prompt');
                }}
              >
                PROMPT
              </button>
            </ControlTip>
          </div>
          <div className="drawer__answer-head">
            {composerVerb === 'prompt' ? 'PROMPT' : 'ANSWER'}
          </div>

          {answerPhase === 'compose' && (
            <>
              {answerOptions.length > 0 && (
                <div className="answer-options" data-testid="answer-options">
                  {answerOptions.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className="verb"
                      data-testid="answer-option"
                      onClick={() => {
                        handleSelectAnswerOption(option);
                      }}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
              <textarea
                className="answer-text"
                data-testid="answer-text"
                value={answerText}
                maxLength={ANSWER_TEXT_MAX_CHARS}
                placeholder={
                  composerVerb === 'prompt'
                    ? 'Type free text to send into this session, whether or not it asked anything…'
                    : 'Type an answer to send into this session…'
                }
                onChange={(e) => {
                  setAnswerText(e.target.value);
                }}
              />
              <div className="drawer__verbs">
                <span className="field__hint">{answerRemaining} chars remaining</span>
                <ControlTip label="Types this text into the live session — shows the exact text before it sends.">
                  <button
                    type="button"
                    className="verb verb--confirm"
                    data-testid="answer-next"
                    disabled={!canSendAnswer}
                    onClick={handleAnswerNext}
                  >
                    {composerVerb === 'prompt' ? 'PROMPT…' : 'ANSWER…'}
                  </button>
                </ControlTip>
              </div>
            </>
          )}

          {answerPhase === 'confirm' && (
            <>
              {/* Verbatim-prompt discipline (CALL modal precedent): the
                  exact text that will be typed into the session, never a
                  summary or a truncation. */}
              <div className="answer-confirm-text" data-testid="answer-confirm-text">
                {answerText}
              </div>
              <div className="drawer__verbs">
                <button
                  type="button"
                  className="verb"
                  data-testid="answer-back"
                  onClick={handleAnswerBack}
                >
                  BACK
                </button>
                <button
                  type="button"
                  className="verb verb--confirm"
                  data-testid="answer-confirm-send"
                  onClick={handleAnswerNext}
                >
                  ⚠ CONFIRM SEND
                </button>
              </div>
            </>
          )}

          {answerPhase === 'sending' && (
            <div className="drawer__warn" data-testid="answer-status">
              … DELIVERING…
            </div>
          )}
          {answerPhase === 'delivered' && (
            <>
              <div className="drawer__warn" data-testid="answer-status">
                {answerStatusLabel('delivered')}
              </div>
              <div className="drawer__verbs">
                <button
                  type="button"
                  className="verb"
                  data-testid="answer-reset"
                  onClick={handleAnswerReset}
                >
                  ANSWER AGAIN
                </button>
              </div>
            </>
          )}
          {answerPhase === 'denied' && (
            <>
              <div className="drawer__warn" data-testid="answer-status">
                {answerStatusLabel('denied', answerReason)}
              </div>
              <div className="drawer__verbs">
                <button
                  type="button"
                  className="verb"
                  data-testid="answer-reset"
                  onClick={handleAnswerReset}
                >
                  TRY AGAIN
                </button>
              </div>
            </>
          )}

          {/* Receipts — one-tap-real: the verbatim text IS the receipt. */}
          {receipts.length > 0 && (
            <div className="answer-receipts" data-testid="answer-receipts">
              <div className="drawer__answer-head">RECENT ANSWERS ({record.machine ?? '?'})</div>
              {receipts
                .slice()
                .reverse()
                .map((receipt) => (
                  <div className="answer-receipt-row" data-testid="answer-receipt" key={receipt.id}>
                    <span className="answer-receipt-row__status">
                      {receipt.verb === 'prompt' ? 'PROMPT · ' : ''}
                      {answerStatusLabel(receipt.status, receipt.reason)}
                    </span>
                    <span className="answer-receipt-row__text">{receipt.text}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      <TailSheet
        state={tail}
        onTogglePause={onTogglePause}
        onTogglePin={onTogglePin}
        pinned={pinned}
      />
    </aside>
  );
}
