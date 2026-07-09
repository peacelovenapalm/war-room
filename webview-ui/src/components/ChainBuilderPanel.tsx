import { useEffect, useState } from 'react';

import { CHAIN_MAX_STEPS, type ChainStepDefInput, validateStepTemplatesClient } from '../chain.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

interface ChainDefSummary {
  id: string;
  name: string;
  steps: ChainStepDefInput[];
}

interface ChainBuilderPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

function emptyStep(): ChainStepDefInput {
  return { id: crypto.randomUUID(), machine: '', provider: 'claude', cwd: '', prompt: '' };
}

/** Chain builder panel (v2 mechanic G3 — GAME-DESIGN.md §7.1): create a
 * multi-step dispatch chain and run it. Live results (per-step status,
 * substituted prompts) render in ChainTray.tsx, not here — this panel is
 * definition-authoring + a RUN button only. */
export function ChainBuilderPanel({ isOpen, onClose }: ChainBuilderPanelProps) {
  const [defs, setDefs] = useState<ChainDefSummary[]>([]);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<ChainStepDefInput[]>([emptyStep(), emptyStep()]);
  const [message, setMessage] = useState<string | null>(null);

  const loadDefs = () => {
    void fetch('/api/chains/defs')
      .then((res) => res.json())
      .then((data: ChainDefSummary[]) => setDefs(data))
      .catch(() => setDefs([]));
  };

  useEffect(() => {
    if (isOpen) loadDefs();
  }, [isOpen]);

  const templateCheck = validateStepTemplatesClient(steps);
  const canSave =
    name.trim() !== '' &&
    steps.length > 0 &&
    steps.length <= CHAIN_MAX_STEPS &&
    steps.every((s) => s.prompt.trim() !== '') &&
    templateCheck.ok;

  const handleAddStep = () => {
    if (steps.length >= CHAIN_MAX_STEPS) return;
    setSteps((prev) => [...prev, emptyStep()]);
  };

  const handleRemoveStep = (id: string) => {
    setSteps((prev) => (prev.length > 1 ? prev.filter((s) => s.id !== id) : prev));
  };

  const handleStepChange = (id: string, patch: Partial<ChainStepDefInput>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const handleSave = () => {
    if (!canSave) return;
    void fetch('/api/chains/defs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, steps }),
    })
      .then((res) => res.json())
      .then((body: { ok: boolean; reason?: string }) => {
        if (body.ok) {
          setName('');
          setSteps([emptyStep(), emptyStep()]);
          setMessage(null);
          loadDefs();
        } else {
          setMessage(`⚠ ${body.reason ?? 'save failed'}`);
        }
      });
  };

  const handleRun = (defId: string) => {
    void fetch(`/api/chains/defs/${defId}/run`, { method: 'POST' })
      .then((res) => res.json())
      .then((body: { ok: boolean; reason?: string }) => {
        setMessage(body.ok ? null : `⚠ ${body.reason ?? 'run failed'}`);
      });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="DISPATCH CHAINS" className="max-w-lg w-full">
      <div className="px-10 pb-10 flex flex-col gap-8">
        {message && <div className="text-sm text-status-permission">{message}</div>}

        <div className="flex flex-col gap-4">
          <span className="font-bold text-sm">SAVED CHAINS</span>
          {defs.length === 0 && (
            <span className="text-xs text-text-muted">No saved chains yet — build one below.</span>
          )}
          {defs.map((def) => (
            <div
              key={def.id}
              className="pixel-panel py-3 px-8 flex items-center justify-between gap-8 text-sm"
            >
              <span>
                {def.name} ({def.steps.length} step{def.steps.length === 1 ? '' : 's'})
              </span>
              <Button size="sm" variant="accent" onClick={() => handleRun(def.id)}>
                RUN ▶
              </Button>
            </div>
          ))}
        </div>

        <div className="border-t border-border pt-8 flex flex-col gap-6">
          <span className="font-bold text-sm">NEW CHAIN</span>
          <label className="flex flex-col gap-3 text-sm">
            <span className="font-bold">NAME</span>
            <input
              type="text"
              className="border-2 border-border bg-bg text-text py-4 px-8 rounded-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. build then report"
            />
          </label>

          {steps.map((step, i) => (
            <div key={step.id} className="pixel-panel py-4 px-8 flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-bold">STEP {i + 1}</span>
                {steps.length > 1 && (
                  <button
                    onClick={() => handleRemoveStep(step.id)}
                    className="bg-transparent border-none cursor-pointer text-text-muted hover:text-text"
                    title="Remove step"
                  >
                    x
                  </button>
                )}
              </div>
              <input
                type="text"
                className="border-2 border-border bg-bg text-text py-3 px-6 rounded-none"
                value={step.machine ?? ''}
                onChange={(e) => handleStepChange(step.id, { machine: e.target.value })}
                placeholder="machine (e.g. MACBOOK)"
              />
              <input
                type="text"
                className="border-2 border-border bg-bg text-text py-3 px-6 rounded-none"
                value={step.cwd ?? ''}
                onChange={(e) => handleStepChange(step.id, { cwd: e.target.value })}
                placeholder="project dir (e.g. /Users/dev/proj)"
              />
              <textarea
                className="border-2 border-border bg-bg text-text py-3 px-6 rounded-none min-h-64 resize-y"
                value={step.prompt}
                onChange={(e) => handleStepChange(step.id, { prompt: e.target.value })}
                placeholder={
                  i === 0
                    ? 'What should this step do?'
                    : 'Use {{step1.result}} to reference an earlier step'
                }
              />
            </div>
          ))}

          {!templateCheck.ok && (
            <span className="text-xs text-status-permission">⚠ {templateCheck.reason}</span>
          )}

          <div className="flex justify-between gap-6 pt-2">
            <Button
              variant={steps.length < CHAIN_MAX_STEPS ? 'default' : 'disabled'}
              size="sm"
              onClick={handleAddStep}
              disabled={steps.length >= CHAIN_MAX_STEPS}
            >
              + ADD STEP
            </Button>
            <Button
              variant={canSave ? 'accent' : 'disabled'}
              onClick={handleSave}
              disabled={!canSave}
            >
              SAVE CHAIN
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
