import { useEffect, useState } from 'react';

import {
  DISPATCH_EFFORT_PROVIDERS,
  DISPATCH_EFFORT_VALUES,
  DISPATCH_MODEL_PATTERN,
  DISPATCH_PROMPT_MAX_CHARS,
  DISPATCH_UI_PROVIDERS,
  type DispatchEffort,
  type DispatchMachine,
  type DispatchProvider,
  joinRootSubpath,
  promptRemaining,
  splitCwdIntoRootSubpath,
  type SubpathJoinResult,
} from '../dispatch.js';
import { transport } from '../transport/index.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

/** Refresh cadence for the machine dropdown while the modal is open — a
 *  runner can come online/go offline (30s advertisement TTL server-side). */
const REFRESH_INTERVAL_MS = 10_000;

/** Prefill carried from a BRIEFING todo line's DISPATCH button. */
export interface CallModalPrefill {
  machine?: string;
  provider?: DispatchProvider;
  cwd?: string;
  prompt?: string;
}

interface CallModalProps {
  isOpen: boolean;
  onClose: () => void;
  prefill?: CallModalPrefill | null;
  /** Registers a send so the tray can flag it "⚠ NOT QUEUED" if no
   *  dispatchUpdate arrives — dispatchRequest has no ack on the wire. */
  onSend: (machine: string, action: 'dispatch') => void;
}

/** CALL modal (v1 mechanic #6b): pick a live machine + provider + project +
 *  prompt → enqueue a real dispatch. Machine/provider/root choices come ONLY
 *  from GET /api/dispatch/machines (live runner advertisements) — a machine
 *  without a runner is honestly absent, never a dead dropdown entry. */
export function CallModal({ isOpen, onClose, prefill, onSend }: CallModalProps) {
  const [machines, setMachines] = useState<DispatchMachine[]>([]);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [machine, setMachine] = useState('');
  const [provider, setProvider] = useState<DispatchProvider | ''>('');
  const [root, setRoot] = useState('');
  const [subpath, setSubpath] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState<DispatchEffort | ''>('');
  // A prefilled cwd (BRIEFING todo bridge) that hasn't yet been split into
  // root+subpath because the machine's roots weren't loaded at prefill time.
  const [pendingPrefillCwd, setPendingPrefillCwd] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/dispatch/machines');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as DispatchMachine[];
        if (!cancelled) {
          setMachines(data);
          setFetchFailed(false);
        }
      } catch (err) {
        console.log('[CallModal] failed to fetch /api/dispatch/machines:', err);
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

  // Apply prefill (from a BRIEFING todo's DISPATCH button) each time the
  // modal opens with one — resets to blank otherwise. The prefill carries a
  // full cwd, not a root+subpath pair, so it's parked in pendingPrefillCwd
  // until the machine's roots are known (see the effect below).
  useEffect(() => {
    if (!isOpen) return;
    setMachine(prefill?.machine ?? '');
    setProvider(prefill?.provider ?? '');
    setRoot('');
    setSubpath('');
    setPrompt(prefill?.prompt ?? '');
    setModel('');
    setEffort('');
    setPendingPrefillCwd(prefill?.cwd ?? '');
  }, [isOpen, prefill]);

  const selectedMachine = machines.find((m) => m.machine === machine);

  // Resolve a pending prefill cwd into root+subpath once the matching
  // machine's roots are loaded (machines fetch is async, may lag the
  // prefill-apply effect above). Falls back to leaving root unset if no
  // advertised root contains it — an honest "pick one yourself" rather than
  // guessing a root that would silently deny server-side.
  useEffect(() => {
    if (!pendingPrefillCwd || !selectedMachine) return;
    const split = splitCwdIntoRootSubpath(pendingPrefillCwd, selectedMachine.roots);
    if (split) {
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
  const modelValid = model.trim() === '' || DISPATCH_MODEL_PATTERN.test(model.trim());
  const canSubmit =
    machine.trim() !== '' &&
    provider !== '' &&
    joined.ok &&
    prompt.trim() !== '' &&
    remaining >= 0 &&
    modelValid;

  const handleSubmit = () => {
    if (!canSubmit || !joined.ok || !joined.cwd) return;
    transport.send({
      type: 'dispatchRequest',
      action: 'dispatch',
      machine,
      provider,
      cwd: joined.cwd,
      prompt,
      ...(model.trim() !== '' ? { model: model.trim() } : {}),
      ...(showEffort && effort !== '' ? { effort } : {}),
    });
    onSend(machine, 'dispatch');
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="CALL A COWORKER" className="max-w-md w-full">
      <div className="px-10 pb-10 flex flex-col gap-8">
        {fetchFailed && machines.length === 0 && (
          <div className="text-sm text-status-permission">
            ⚠ unable to reach /api/dispatch/machines
          </div>
        )}
        {machines.length === 0 ? (
          <div className="text-sm text-warning">
            ⚠ NO RUNNERS — install the dispatch runner runbook
            (.planning/runbooks/install-dispatch-runner-launchd.sh) on a machine first.
          </div>
        ) : (
          <>
            <label className="flex flex-col gap-3 text-sm">
              <span className="font-bold">MACHINE</span>
              <select
                className="border-2 border-border bg-bg text-text py-4 px-8 rounded-none"
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
                <label className="flex flex-col gap-3 text-sm">
                  <span className="font-bold">PROVIDER</span>
                  <select
                    className="border-2 border-border bg-bg text-text py-4 px-8 rounded-none"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value as DispatchProvider)}
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

                <label className="flex flex-col gap-3 text-sm">
                  <span className="font-bold">PROJECT</span>
                  <select
                    className="border-2 border-border bg-bg text-text py-4 px-8 rounded-none"
                    value={root}
                    onChange={(e) => setRoot(e.target.value)}
                  >
                    <option value="">— choose a project —</option>
                    {selectedMachine.roots.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>

                {root && (
                  <label className="flex flex-col gap-3 text-sm">
                    <span className="font-bold">SUBFOLDER (optional)</span>
                    <input
                      type="text"
                      className="border-2 border-border bg-bg text-text py-4 px-8 rounded-none"
                      value={subpath}
                      onChange={(e) => setSubpath(e.target.value)}
                      placeholder="e.g. packages/api"
                    />
                    <span className="text-2xs text-text-muted">
                      Any folder under the chosen project — leave blank to run at the project root.{' '}
                      {joined.ok
                        ? `Runs at: ${joined.cwd}`
                        : `⚠ ${joined.reason ?? 'invalid subfolder'}`}
                    </span>
                  </label>
                )}

                <label className="flex flex-col gap-3 text-sm">
                  <span className="font-bold">MODEL (optional)</span>
                  <input
                    type="text"
                    className="border-2 border-border bg-bg text-text py-4 px-8 rounded-none"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="e.g. fable, opus, o3"
                  />
                  {!modelValid && (
                    <span className="text-2xs text-status-permission font-bold">
                      ⚠ letters, digits, ".", "_", "/", "-" only
                    </span>
                  )}
                </label>

                {showEffort && (
                  <label className="flex flex-col gap-3 text-sm">
                    <span className="font-bold">EFFORT (optional)</span>
                    <select
                      className="border-2 border-border bg-bg text-text py-4 px-8 rounded-none"
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

            <label className="flex flex-col gap-3 text-sm">
              <span className="font-bold">PROMPT</span>
              <textarea
                className="border-2 border-border bg-bg text-text py-4 px-8 rounded-none min-h-96 resize-y"
                value={prompt}
                maxLength={DISPATCH_PROMPT_MAX_CHARS}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="What should this session do?"
              />
              <span
                className={`text-2xs text-right ${remaining < 0 ? 'text-status-permission font-bold' : 'text-text-muted'}`}
              >
                {remaining} chars remaining
              </span>
            </label>

            <div className="flex justify-end gap-6 pt-4">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant={canSubmit ? 'accent' : 'disabled'}
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                Call
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
