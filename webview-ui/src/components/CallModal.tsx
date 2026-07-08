import { useEffect, useState } from 'react';

import {
  DISPATCH_PROMPT_MAX_CHARS,
  type DispatchMachine,
  type DispatchProvider,
  promptRemaining,
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
}

/** CALL modal (v1 mechanic #6b): pick a live machine + provider + project +
 *  prompt → enqueue a real dispatch. Machine/provider/root choices come ONLY
 *  from GET /api/dispatch/machines (live runner advertisements) — a machine
 *  without a runner is honestly absent, never a dead dropdown entry. */
export function CallModal({ isOpen, onClose, prefill }: CallModalProps) {
  const [machines, setMachines] = useState<DispatchMachine[]>([]);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [machine, setMachine] = useState('');
  const [provider, setProvider] = useState<DispatchProvider | ''>('');
  const [cwd, setCwd] = useState('');
  const [prompt, setPrompt] = useState('');

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
  // modal opens with one — resets to blank otherwise.
  useEffect(() => {
    if (!isOpen) return;
    setMachine(prefill?.machine ?? '');
    setProvider(prefill?.provider ?? '');
    setCwd(prefill?.cwd ?? '');
    setPrompt(prefill?.prompt ?? '');
  }, [isOpen, prefill]);

  const selectedMachine = machines.find((m) => m.machine === machine);
  const remaining = promptRemaining(prompt);
  const canSubmit =
    machine.trim() !== '' &&
    provider !== '' &&
    cwd.trim() !== '' &&
    prompt.trim() !== '' &&
    remaining >= 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    transport.send({
      type: 'dispatchRequest',
      action: 'dispatch',
      machine,
      provider,
      cwd,
      prompt,
    });
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
                  setCwd('');
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
                    {selectedMachine.providers.map((p) => (
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
                    value={cwd}
                    onChange={(e) => setCwd(e.target.value)}
                  >
                    <option value="">— choose a project —</option>
                    {selectedMachine.roots.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
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
