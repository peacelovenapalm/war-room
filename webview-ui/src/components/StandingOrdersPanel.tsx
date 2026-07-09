import { useEffect, useState } from 'react';

import {
  canCreateStandingOrder,
  scheduleLabel,
  STANDING_ORDER_BASE_CAP,
  type StandingOrderClient,
  standingOrderStatusLabel,
} from '../standingOrders.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

interface StandingOrdersPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Standing orders panel (v2 mechanic G3 — GAME-DESIGN.md §7.2): create a
 *  scheduled dispatch and manage the UNCONDITIONAL first-fire confirm gate
 *  — every new order shows "⚠ NEEDS FIRST-RUN CONFIRM" until a human
 *  explicitly clicks CONFIRM, which fires it once immediately and only
 *  THEN unlocks unattended future ticks. No perk or setting bypasses this. */
export function StandingOrdersPanel({ isOpen, onClose }: StandingOrdersPanelProps) {
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
  // Perk-derived cap isn't known client-side without an extra economy round
  // trip — show the conservative base cap as a hint; the server enforces
  // the real (possibly perk-raised) cap authoritatively either way.
  const canCreate =
    canCreateStandingOrder(enabledCount, STANDING_ORDER_BASE_CAP) || orders.length === 0;
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
    <Modal isOpen={isOpen} onClose={onClose} title="STANDING ORDERS" className="max-w-lg w-full">
      <div className="px-10 pb-10 flex flex-col gap-8">
        {message && <div className="text-sm text-status-permission">{message}</div>}

        <div className="flex flex-col gap-4">
          {orders.length === 0 && (
            <span className="text-xs text-text-muted">
              No standing orders yet — create one below.
            </span>
          )}
          {orders.map((order) => (
            <div key={order.id} className="pixel-panel py-4 px-8 flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-bold">{order.name}</span>
                <span className="text-xs text-text-muted">{scheduleLabel(order.schedule)}</span>
              </div>
              <div className="flex items-center justify-between gap-6">
                <span data-testid="standing-order-status">{standingOrderStatusLabel(order)}</span>
                <div className="flex gap-4">
                  {order.needsFirstFireConfirm ? (
                    <Button
                      size="sm"
                      variant="accent"
                      onClick={() => handleConfirmFirstFire(order.id)}
                    >
                      CONFIRM
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => handleToggle(order.id, !order.enabled)}>
                      {order.enabled ? 'DISABLE' : 'ENABLE'}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => handleDelete(order.id)}>
                    DELETE
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-border pt-8 flex flex-col gap-6">
          <span className="font-bold text-sm">NEW STANDING ORDER</span>
          {!canCreate && (
            <span className="text-xs text-warning">
              ⚠ enabled-order cap reached — disable one or buy a perk to raise it
            </span>
          )}
          <input
            type="text"
            className="border-2 border-border bg-bg text-text py-4 px-8 rounded-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="NAME"
          />
          <input
            type="text"
            className="border-2 border-border bg-bg text-text py-4 px-8 rounded-none"
            value={machine}
            onChange={(e) => setMachine(e.target.value)}
            placeholder="machine (e.g. MACBOOK)"
          />
          <input
            type="text"
            className="border-2 border-border bg-bg text-text py-4 px-8 rounded-none"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="project dir"
          />
          <textarea
            className="border-2 border-border bg-bg text-text py-4 px-8 rounded-none min-h-64 resize-y"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should this dispatch do?"
          />
          <div className="flex items-center gap-6 text-sm">
            <label className="flex items-center gap-3">
              <input
                type="radio"
                checked={scheduleKind === 'daily'}
                onChange={() => setScheduleKind('daily')}
              />
              DAILY @
              <input
                type="number"
                min={0}
                max={23}
                className="border-2 border-border bg-bg text-text py-2 px-4 rounded-none w-48"
                value={atLocalHour}
                onChange={(e) => setAtLocalHour(Number(e.target.value))}
                disabled={scheduleKind !== 'daily'}
              />
              :00
            </label>
            <label className="flex items-center gap-3">
              <input
                type="radio"
                checked={scheduleKind === 'interval'}
                onChange={() => setScheduleKind('interval')}
              />
              EVERY
              <input
                type="number"
                min={1}
                className="border-2 border-border bg-bg text-text py-2 px-4 rounded-none w-48"
                value={everyHours}
                onChange={(e) => setEveryHours(Number(e.target.value))}
                disabled={scheduleKind !== 'interval'}
              />
              h
            </label>
          </div>
          <div className="flex justify-end pt-2">
            <Button
              variant={canSave && canCreate ? 'accent' : 'disabled'}
              onClick={handleSave}
              disabled={!canSave || !canCreate}
            >
              SAVE
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
