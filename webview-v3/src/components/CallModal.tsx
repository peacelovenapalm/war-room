import { useEffect, useState } from 'react';

import type { ClientMessage } from '../../../core/src/messages.js';
import {
  DISPATCH_EFFORT_PROVIDERS,
  DISPATCH_EFFORT_VALUES,
  DISPATCH_MODEL_OPTIONS,
  DISPATCH_PROMPT_MAX_CHARS,
  DISPATCH_TIMEOUT_MAX_SEC,
  DISPATCH_UI_PROVIDERS,
  type DispatchEffort,
  type DispatchMachine,
  type DispatchProvider,
  joinRootSubpath,
  promptRemaining,
  splitCwdIntoRootSubpath,
  type SubpathJoinResult,
} from '../net/dispatchFacts';
import { budgetChipLabel, budgetResetHintLine, type BudgetSnapshotClient } from '../state/budget';
import { Modal } from './Modal';

const REFRESH_INTERVAL_MS = 10_000;

/** Prefill carried from a BRIEFING todo line's DISPATCH button, or from
 *  ContractsPanel's "Dispatch via…" employee-assign dropdown. */
export interface CallModalPrefill {
  machine?: string;
  provider?: DispatchProvider;
  cwd?: string;
  prompt?: string;
  contractId?: string;
  employeeId?: string;
}

export interface CallModalProps {
  isOpen: boolean;
  onClose: () => void;
  prefill?: CallModalPrefill | null;
  send: (message: ClientMessage) => void;
  /** `requestId` is the correlation id sent on the wire — the caller's
   *  send-failure detector matches the echoed dispatchUpdate on it. */
  onSend: (machine: string, action: 'dispatch', requestId: string) => void;
  budget: BudgetSnapshotClient | null;
}

/** CALL modal (KICKOFF-v3.1 stage-3 port): pick a live machine + provider +
 *  project + prompt → enqueue a real dispatchRequest over the real WS
 *  connection. Options come ONLY from GET /api/dispatch/machines. */
export function CallModal({ isOpen, onClose, prefill, send, onSend, budget }: CallModalProps) {
  const [machines, setMachines] = useState<DispatchMachine[]>([]);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [machine, setMachine] = useState('');
  const [provider, setProvider] = useState<DispatchProvider | ''>('');
  const [root, setRoot] = useState('');
  const [subpath, setSubpath] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState<DispatchEffort | ''>('');
  // T5 fleet controls, PER-DISPATCH TIME CAP — free text so an empty field
  // reads unambiguously as "no cap" (current behavior), never a fabricated
  // default number.
  const [timeoutSecInput, setTimeoutSecInput] = useState('');
  const [pendingPrefillCwd, setPendingPrefillCwd] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/dispatch/machines');
        if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
        const data = (await res.json()) as DispatchMachine[];
        if (!cancelled) {
          setMachines(data);
          setFetchFailed(false);
        }
      } catch {
        if (!cancelled) setFetchFailed(true);
      }
    };
    void load();
    const interval = setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isOpen]);

  // Reset the form on each fresh open — "adjust state while rendering"
  // (react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes),
  // NOT an effect: a plain useState "previous value" track, updated
  // conditionally during render. React's docs sanction calling a state
  // setter mid-render for exactly this pattern (it bails out and re-runs
  // the render before painting) — unlike a ref, whose .current may not
  // be read/written during render (react-hooks/refs).
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setMachine(prefill?.machine ?? '');
      setProvider(prefill?.provider ?? '');
      setRoot('');
      setSubpath('');
      setPrompt(prefill?.prompt ?? '');
      setModel('');
      setEffort('');
      setTimeoutSecInput('');
      setPendingPrefillCwd(prefill?.cwd ?? '');
    }
  }

  const selectedMachine = machines.find((m) => m.machine === machine);

  // Genuinely reactive to an ASYNC external event (the machines fetch
  // resolving after mount) — not a synchronous prop-derived reset, so this
  // stays an effect (react-hooks/set-state-in-effect targets the
  // resettable-derived-state pattern above, not "sync once external data
  // arrives").
  useEffect(() => {
    if (!pendingPrefillCwd || !selectedMachine) return;
    const split = splitCwdIntoRootSubpath(pendingPrefillCwd, selectedMachine.roots);
    if (split) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above the effect
      setRoot(split.root);
      setSubpath(split.subpath);
    }
    setPendingPrefillCwd('');
  }, [pendingPrefillCwd, selectedMachine]);

  const remaining = promptRemaining(prompt);
  const joined: SubpathJoinResult =
    root.trim() !== ''
      ? joinRootSubpath(root, subpath)
      : { ok: false, reason: 'no project chosen' };
  const showEffort = provider !== '' && DISPATCH_EFFORT_PROVIDERS.includes(provider);
  const modelOptions = provider !== '' ? (DISPATCH_MODEL_OPTIONS[provider] ?? []) : [];
  // T5 fleet controls, PER-DISPATCH TIME CAP — empty means no cap; anything
  // else must parse as a positive integer within bounds, or Send stays
  // disabled with an honest inline reason (never silently dropped/clamped).
  const timeoutTrimmed = timeoutSecInput.trim();
  const timeoutParsed = timeoutTrimmed === '' ? undefined : Number(timeoutTrimmed);
  const timeoutValid =
    timeoutTrimmed === '' ||
    (Number.isInteger(timeoutParsed) &&
      timeoutParsed !== undefined &&
      timeoutParsed > 0 &&
      timeoutParsed <= DISPATCH_TIMEOUT_MAX_SEC);
  const canSubmit =
    machine.trim() !== '' &&
    provider !== '' &&
    joined.ok &&
    prompt.trim() !== '' &&
    remaining >= 0 &&
    timeoutValid;
  const resetHint = budgetResetHintLine(budget, provider || undefined);

  const handleSubmit = () => {
    // canSubmit already guarantees provider !== '' (its own definition
    // checks it) — TS's aliased-condition narrowing carries that fact
    // forward from here, so `provider` below is DispatchProvider, not ''.
    if (!canSubmit || !joined.ok || !joined.cwd) return;
    // Correlation id (asyncapi DispatchRequest.requestId): echoed on every
    // dispatchUpdate for this queue entry, so the silent-drop detector can
    // tell exactly which send a broadcast answers.
    const requestId = crypto.randomUUID();
    send({
      type: 'dispatchRequest',
      action: 'dispatch',
      machine,
      provider,
      cwd: joined.cwd,
      prompt,
      requestId,
      ...(model.trim() !== '' ? { model: model.trim() } : {}),
      ...(showEffort && effort !== '' ? { effort } : {}),
      ...(timeoutTrimmed !== '' && timeoutParsed !== undefined
        ? { timeoutSec: timeoutParsed }
        : {}),
    });
    onSend(machine, 'dispatch', requestId);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="CALL A COWORKER" testId="call-modal">
      {fetchFailed && machines.length === 0 && (
        <div className="modal__warn">⚠ unable to reach /api/dispatch/machines</div>
      )}
      {machines.length === 0 ? (
        <div className="modal__warn" data-testid="call-no-runners">
          ⚠ NO RUNNERS — no live dispatch runner is advertising for any machine.
        </div>
      ) : (
        <>
          <label className="field">
            <span className="field__label">MACHINE</span>
            <select
              value={machine}
              onChange={(e) => {
                setMachine(e.target.value);
                setProvider('');
                setRoot('');
                setSubpath('');
              }}
            >
              <option value="">— choose a machine —</option>
              {machines.map((m) => (
                <option key={m.machine} value={m.machine}>
                  {m.machine}
                </option>
              ))}
            </select>
          </label>

          {selectedMachine && (
            <>
              <label className="field">
                <span className="field__label">PROVIDER</span>
                <select
                  value={provider}
                  onChange={(e) => {
                    setProvider(e.target.value as DispatchProvider);
                    setModel('');
                  }}
                >
                  <option value="">— choose a provider —</option>
                  {selectedMachine.providers
                    .filter((p) => DISPATCH_UI_PROVIDERS.includes(p as DispatchProvider))
                    .map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                </select>
              </label>

              <label className="field">
                <span className="field__label">PROJECT</span>
                <select value={root} onChange={(e) => setRoot(e.target.value)}>
                  <option value="">— choose a project —</option>
                  {selectedMachine.roots.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>

              {root && (
                <label className="field">
                  <span className="field__label">SUBFOLDER (optional)</span>
                  <input
                    type="text"
                    value={subpath}
                    onChange={(e) => setSubpath(e.target.value)}
                    placeholder="e.g. packages/api"
                  />
                  <span className="field__hint">
                    {joined.ok
                      ? `Runs at: ${joined.cwd}`
                      : `⚠ ${joined.reason ?? 'invalid subfolder'}`}
                  </span>
                </label>
              )}

              <label className="field">
                <span className="field__label">MODEL (optional)</span>
                <select value={model} onChange={(e) => setModel(e.target.value)}>
                  {modelOptions.length === 0 && <option value="">default (no flag)</option>}
                  {modelOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              {showEffort && (
                <label className="field">
                  <span className="field__label">EFFORT (optional)</span>
                  <select
                    value={effort}
                    onChange={(e) => setEffort(e.target.value as DispatchEffort)}
                  >
                    <option value="">— default —</option>
                    {DISPATCH_EFFORT_VALUES.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}

          <label className="field">
            <span className="field__label">TIME CAP (optional, seconds)</span>
            <input
              type="text"
              inputMode="numeric"
              value={timeoutSecInput}
              onChange={(e) => setTimeoutSecInput(e.target.value)}
              placeholder="no cap"
              data-testid="call-timeout-input"
            />
            <span className={timeoutValid ? 'field__hint' : 'field__hint field__hint--warn'}>
              {timeoutValid
                ? 'runner SIGTERMs then SIGKILLs at the cap — absent means no cap'
                : `⚠ enter a whole number of seconds, 1–${String(DISPATCH_TIMEOUT_MAX_SEC)}`}
            </span>
          </label>

          <label className="field">
            <span className="field__label">PROMPT</span>
            <textarea
              value={prompt}
              maxLength={DISPATCH_PROMPT_MAX_CHARS}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should this session do?"
            />
            <span className={remaining < 0 ? 'field__hint field__hint--warn' : 'field__hint'}>
              {remaining} chars remaining
            </span>
          </label>

          <div className="modal__actions">
            <span
              className="modal__budget-chip"
              data-testid="call-modal-budget-chip"
              title="Informational only — manual sends are never budget-gated"
            >
              {budgetChipLabel(budget, provider || undefined)}
            </span>
            {resetHint && (
              <span className="modal__muted" data-testid="call-modal-reset-hint">
                {resetHint}
              </span>
            )}
            <button type="button" className="verb" onClick={onClose}>
              CANCEL
            </button>
            <button
              type="button"
              className="verb verb--confirm"
              disabled={!canSubmit}
              onClick={handleSubmit}
              data-testid="call-submit"
            >
              CALL
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
