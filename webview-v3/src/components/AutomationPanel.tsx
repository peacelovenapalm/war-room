import { useEffect, useState } from 'react';

import { useNow } from '../hooks/useNow';
import {
  chainMaxSteps,
  chainRunChipLabel,
  type ChainRunClient,
  type ChainStepDefInput,
  pruneChainRuns,
  validateStepTemplatesClient,
} from '../state/chain';
import { CHAIN_TEMPLATES, instantiateChainTemplate } from '../state/chainTemplates';
import {
  canCreateStandingOrder,
  scheduleLabel,
  standingOrderCapClient,
  type StandingOrderClient,
  standingOrderStatusLabel,
} from '../state/standingOrders';
import { Modal } from './Modal';
import { StopAllControl } from './StopAllControl';

interface ChainDefSummary {
  id: string;
  name: string;
  steps: ChainStepDefInput[];
}

export interface AutomationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  chainRuns: ChainRunClient[];
  chainRunReceivedAt: Record<string, number>;
  /** Lifted STOP ALL state — the SAME source the HUD instance renders
   *  (state/stopAll.ts), so the two controls can never disagree. */
  automationStopped: boolean;
  onAutomationStoppedChange: (stopped: boolean) => void;
}

function emptyStep(): ChainStepDefInput {
  return { id: crypto.randomUUID(), machine: '', provider: 'claude', cwd: '', prompt: '' };
}

/** CHAINS half — save/run multi-step dispatch sequences. Live per-run
 *  status comes from the real chainRunUpdate WS plane (chainRuns prop);
 *  this half is definition-authoring + a RUN button, matching v1. */
function ChainsSection({
  isOpen,
  chainRuns,
  chainRunReceivedAt,
  now,
}: {
  isOpen: boolean;
  chainRuns: ChainRunClient[];
  chainRunReceivedAt: Record<string, number>;
  now: number;
}) {
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

  // NOTE (v3 scope): core's generated EconomyUpdate has no purchasedPerks
  // field yet (see state/chain.ts's chainMaxSteps doc) — always the honest
  // base cap until that lands.
  const maxSteps = chainMaxSteps(false);
  const templateCheck = validateStepTemplatesClient(steps);
  const canSave =
    name.trim() !== '' &&
    steps.length > 0 &&
    steps.length <= maxSteps &&
    steps.every((s) => s.prompt.trim() !== '') &&
    templateCheck.ok;

  const visibleRuns = pruneChainRuns(chainRuns, now, chainRunReceivedAt);

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
    <div className="automation-section">
      <h3 className="briefing-section__title">CHAINS</h3>
      {message && <div className="modal__warn">{message}</div>}

      {visibleRuns.length > 0 && (
        <div className="automation-list" data-testid="chain-tray">
          {visibleRuns.map((run) => (
            <div key={run.id} className="automation-card" data-testid="chain-run-chip">
              CHAIN — {chainRunChipLabel(run)}
            </div>
          ))}
        </div>
      )}

      <div className="automation-list">
        {defs.length === 0 && (
          <span className="modal__muted">No saved chains yet — build one below.</span>
        )}
        {defs.map((def) => (
          <div key={def.id} className="automation-card automation-card--row">
            <span>
              {def.name} ({def.steps.length} step{def.steps.length === 1 ? '' : 's'})
            </span>
            <button
              type="button"
              className="verb verb--confirm"
              onClick={() => {
                handleRun(def.id);
              }}
            >
              RUN ▶
            </button>
          </div>
        ))}
      </div>

      <div className="automation-form">
        <span className="modal__muted">NEW CHAIN</span>
        <label className="field">
          <span className="field__label">
            START FROM TEMPLATE (optional — prefills, everything stays editable)
          </span>
          <select
            data-testid="chain-template-picker"
            value=""
            onChange={(e) => {
              const template = CHAIN_TEMPLATES.find((t) => t.key === e.target.value);
              if (!template) return;
              const filled = instantiateChainTemplate(template);
              setName(filled.name);
              setSteps(filled.steps);
              setMessage(null);
            }}
          >
            <option value="">— blank chain —</option>
            {CHAIN_TEMPLATES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">NAME</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. build then report"
          />
        </label>
        {steps.map((step, i) => (
          <div key={step.id} className="automation-card">
            <div className="automation-card--row">
              <span className="modal__muted">STEP {i + 1}</span>
              {steps.length > 1 && (
                <button
                  type="button"
                  className="dispatch-chip__dismiss"
                  title="Remove step"
                  onClick={() => {
                    setSteps((prev) =>
                      prev.length > 1 ? prev.filter((s) => s.id !== step.id) : prev,
                    );
                  }}
                >
                  ✕
                </button>
              )}
            </div>
            {(step.provider !== undefined || step.model !== undefined) && (
              // Template-carried fields with no editor input yet — surface
              // them as text so nothing rides into SAVE invisibly.
              <span className="modal__muted">
                provider:{' '}
                {step.provider === undefined || step.provider === '' ? 'default' : step.provider}
                {step.model !== undefined && step.model !== '' ? ` · model: ${step.model}` : ''}
              </span>
            )}
            <input
              type="text"
              value={step.machine ?? ''}
              onChange={(e) =>
                setSteps((prev) =>
                  prev.map((s) => (s.id === step.id ? { ...s, machine: e.target.value } : s)),
                )
              }
              placeholder="machine (e.g. MACBOOK)"
            />
            <input
              type="text"
              value={step.cwd ?? ''}
              onChange={(e) =>
                setSteps((prev) =>
                  prev.map((s) => (s.id === step.id ? { ...s, cwd: e.target.value } : s)),
                )
              }
              placeholder="project dir"
            />
            <textarea
              value={step.prompt}
              onChange={(e) =>
                setSteps((prev) =>
                  prev.map((s) => (s.id === step.id ? { ...s, prompt: e.target.value } : s)),
                )
              }
              placeholder={
                i === 0
                  ? 'What should this step do?'
                  : 'Use {{step1.result}} to reference an earlier step'
              }
            />
          </div>
        ))}
        {!templateCheck.ok && (
          <span className="field__hint field__hint--warn">⚠ {templateCheck.reason}</span>
        )}
        <div className="modal__actions">
          <button
            type="button"
            className="verb"
            disabled={steps.length >= maxSteps}
            onClick={() => {
              if (steps.length < maxSteps) setSteps((prev) => [...prev, emptyStep()]);
            }}
          >
            + ADD STEP
          </button>
          <button
            type="button"
            className="verb verb--confirm"
            disabled={!canSave}
            onClick={handleSave}
          >
            SAVE CHAIN
          </button>
        </div>
      </div>
    </div>
  );
}

/** STANDING ORDERS half — scheduled dispatches with the UNCONDITIONAL
 *  first-fire confirm gate (KICKOFF-v3.1 hard rule 8): every new order
 *  needs one explicit CONFIRM click before it can ever fire unattended. */
function StandingOrdersSection({ isOpen }: { isOpen: boolean }) {
  const [orders, setOrders] = useState<StandingOrderClient[]>([]);
  const [name, setName] = useState('');
  const [machine, setMachine] = useState('');
  const [cwd, setCwd] = useState('');
  const [prompt, setPrompt] = useState('');
  const [scheduleKind, setScheduleKind] = useState<'daily' | 'interval'>('daily');
  const [atLocalHour, setAtLocalHour] = useState(9);
  const [everyHours, setEveryHours] = useState(1);
  const [message, setMessage] = useState<string | null>(null);

  const loadOrders = () => {
    void fetch('/api/standing-orders')
      .then((res) => res.json())
      .then((data: StandingOrderClient[]) => setOrders(data))
      .catch(() => setOrders([]));
  };

  useEffect(() => {
    if (isOpen) loadOrders();
  }, [isOpen]);

  const enabledCount = orders.filter((o) => o.enabled).length;
  // Same v3-scope note as ChainsSection: no live perk state yet, base cap only.
  const effectiveCap = standingOrderCapClient(null);
  const canCreate = canCreateStandingOrder(enabledCount, effectiveCap) || orders.length === 0;
  const canSave =
    name.trim() !== '' && prompt.trim() !== '' && machine.trim() !== '' && cwd.trim() !== '';

  const handleSave = () => {
    if (!canSave) return;
    const schedule =
      scheduleKind === 'daily'
        ? { kind: 'daily' as const, atLocalHour }
        : { kind: 'interval' as const, everyMs: everyHours * 3_600_000 };
    void fetch('/api/standing-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, schedule, machine, provider: 'claude', cwd, prompt }),
    })
      .then((res) => res.json())
      .then((body: { ok: boolean; reason?: string }) => {
        if (body.ok) {
          setName('');
          setPrompt('');
          setMessage(null);
          loadOrders();
        } else {
          setMessage(`⚠ ${body.reason ?? 'save failed'}`);
        }
      });
  };

  const handleConfirmFirstFire = (id: string) => {
    void fetch(`/api/standing-orders/${id}/confirm-first-fire`, { method: 'POST' })
      .then((res) => res.json())
      .then((body: { ok: boolean; reason?: string }) => {
        setMessage(body.ok ? null : `⚠ ${body.reason ?? 'confirm failed'}`);
        loadOrders();
      });
  };

  const handleToggle = (id: string, enabled: boolean) => {
    void fetch(`/api/standing-orders/${id}/enabled`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    }).then(loadOrders);
  };

  const handleDelete = (id: string) => {
    void fetch(`/api/standing-orders/${id}/delete`, { method: 'POST' }).then(loadOrders);
  };

  return (
    <div className="automation-section">
      <h3 className="briefing-section__title">STANDING ORDERS</h3>
      {message && <div className="modal__warn">{message}</div>}

      <div className="automation-list">
        {orders.length === 0 && (
          <span className="modal__muted">No standing orders yet — create one below.</span>
        )}
        {orders.map((order) => (
          <div key={order.id} className="automation-card">
            <div className="automation-card--row">
              <strong>{order.name}</strong>
              <span className="modal__muted">{scheduleLabel(order.schedule)}</span>
            </div>
            <div className="automation-card--row">
              <span data-testid="standing-order-status">{standingOrderStatusLabel(order)}</span>
              <span className="modal__actions">
                {order.needsFirstFireConfirm ? (
                  <button
                    type="button"
                    className="verb verb--confirm"
                    data-testid="standing-order-confirm"
                    onClick={() => {
                      handleConfirmFirstFire(order.id);
                    }}
                  >
                    CONFIRM
                  </button>
                ) : (
                  <button
                    type="button"
                    className="verb"
                    onClick={() => {
                      handleToggle(order.id, !order.enabled);
                    }}
                  >
                    {order.enabled ? 'DISABLE' : 'ENABLE'}
                  </button>
                )}
                <button
                  type="button"
                  className="verb"
                  onClick={() => {
                    handleDelete(order.id);
                  }}
                >
                  DELETE
                </button>
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="automation-form">
        <span className="modal__muted">NEW STANDING ORDER</span>
        {!canCreate && (
          <span className="field__hint field__hint--warn">
            ⚠ enabled-order cap reached — disable one to raise it
          </span>
        )}
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="NAME"
        />
        <input
          type="text"
          value={machine}
          onChange={(e) => setMachine(e.target.value)}
          placeholder="machine (e.g. MACBOOK)"
        />
        <input
          type="text"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="project dir"
        />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What should this dispatch do?"
        />
        <div className="automation-card--row">
          <label>
            <input
              type="radio"
              checked={scheduleKind === 'daily'}
              onChange={() => setScheduleKind('daily')}
            />{' '}
            DAILY @
            <input
              type="number"
              min={0}
              max={23}
              value={atLocalHour}
              disabled={scheduleKind !== 'daily'}
              onChange={(e) => setAtLocalHour(Number(e.target.value))}
            />
            :00
          </label>
          <label>
            <input
              type="radio"
              checked={scheduleKind === 'interval'}
              onChange={() => setScheduleKind('interval')}
            />{' '}
            EVERY
            <input
              type="number"
              min={1}
              value={everyHours}
              disabled={scheduleKind !== 'interval'}
              onChange={(e) => setEveryHours(Number(e.target.value))}
            />
            h
          </label>
        </div>
        <div className="modal__actions">
          <button
            type="button"
            className="verb verb--confirm"
            disabled={!canSave || !canCreate}
            onClick={handleSave}
          >
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
}

/** Automation panel (KICKOFF-v3.1 decision register clustering: "Chains,
 *  Standing orders … STOP ALL always visible"): chains + standing orders
 *  side by side, with STOP ALL repeated here too (it's ALSO always in the
 *  HUD — this is the same control, not a second kill switch). */
export function AutomationPanel({
  isOpen,
  onClose,
  chainRuns,
  chainRunReceivedAt,
  automationStopped,
  onAutomationStoppedChange,
}: AutomationPanelProps) {
  const now = useNow(isOpen);
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="AUTOMATION" testId="automation-panel" wide>
      <div className="automation-panel">
        <div className="automation-panel__stopall">
          <StopAllControl stopped={automationStopped} onStoppedChange={onAutomationStoppedChange} />
        </div>
        <ChainsSection
          isOpen={isOpen}
          chainRuns={chainRuns}
          chainRunReceivedAt={chainRunReceivedAt}
          now={now}
        />
        <StandingOrdersSection isOpen={isOpen} />
      </div>
    </Modal>
  );
}
