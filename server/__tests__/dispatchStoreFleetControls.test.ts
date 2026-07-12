/**
 * Unit tests for T5 fleet controls' dispatchStore.ts additions (KICKOFF T5,
 * D-21/D-27): PER-DISPATCH TIME CAP (timeoutSec validation + threading to
 * the runner poll response/broadcast plane, the `capped` terminal status)
 * and DAILY FLEET SPEND CEILING (the injected budgetGate closure, the
 * `queued-budget` held status, explicit-override release, and the
 * automatic local-date-rollover release). Same fresh-explicit-path-instance
 * convention as dispatchStore.test.ts — no shared singleton, no module reset
 * needed (unlike opsAdvisor.test.ts's multi-store scans).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DISPATCH_RINGING_CAP,
  DISPATCH_TIMEOUT_MAX_SEC,
  DispatchStore,
} from '../src/dispatchStore.js';

let tmpDir: string;
let statePath: string;
let auditPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-fleet-'));
  statePath = path.join(tmpDir, 'dispatch-queue.json');
  auditPath = path.join(tmpDir, 'dispatch-audit.jsonl');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function enqueueDispatch(s: DispatchStore, overrides: Record<string, unknown> = {}) {
  return s.enqueue({
    action: 'dispatch',
    machine: 'MACBOOK',
    provider: 'claude',
    cwd: '/x',
    prompt: 'p',
    ...overrides,
  });
}

// ── PER-DISPATCH TIME CAP ────────────────────────────────────────

describe('DispatchStore.enqueue — timeoutSec validation', () => {
  it('a positive integer within bounds is accepted and stored on the record', () => {
    const s = new DispatchStore(statePath, auditPath);
    const result = enqueueDispatch(s, { timeoutSec: 300 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.record.timeoutSec).toBe(300);
  });

  it('absent timeoutSec means no cap — current (unbounded) behavior, unchanged', () => {
    const s = new DispatchStore(statePath, auditPath);
    const result = enqueueDispatch(s);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.record.timeoutSec).toBeUndefined();
  });

  it.each([0, -1, 1.5, DISPATCH_TIMEOUT_MAX_SEC + 1])(
    'rejects an invalid timeoutSec (%s) with invalid-timeout',
    (bad) => {
      const s = new DispatchStore(statePath, auditPath);
      const result = enqueueDispatch(s, { timeoutSec: bad });
      expect(result).toEqual({ ok: false, reason: 'invalid-timeout' });
    },
  );

  it('the max bound itself is accepted', () => {
    const s = new DispatchStore(statePath, auditPath);
    const result = enqueueDispatch(s, { timeoutSec: DISPATCH_TIMEOUT_MAX_SEC });
    expect(result.ok).toBe(true);
  });
});

describe('DispatchStore — timeoutSec threads to the runner poll response and broadcast plane', () => {
  it('pendingFor() carries timeoutSec verbatim to the DispatchRunnerItem', () => {
    const s = new DispatchStore(statePath, auditPath);
    enqueueDispatch(s, { timeoutSec: 120 });
    const pending = s.pendingFor('MACBOOK');
    expect(pending).toHaveLength(1);
    expect(pending[0].timeoutSec).toBe(120);
  });

  it('getActive()/getRecent() echo timeoutSec on the broadcast plane', () => {
    const s = new DispatchStore(statePath, auditPath);
    enqueueDispatch(s, { timeoutSec: 60 });
    expect(s.getActive()[0].timeoutSec).toBe(60);
    expect(s.getRecent()[0].timeoutSec).toBe(60);
  });

  it('getRedispatchInput preserves timeoutSec — a rework re-dispatch keeps the same cap', () => {
    const s = new DispatchStore(statePath, auditPath);
    const enq = enqueueDispatch(s, { timeoutSec: 90 });
    if (!enq.ok) throw new Error('unreachable');
    expect(s.getRedispatchInput(enq.record.id)?.timeoutSec).toBe(90);
  });
});

describe('DispatchStore.reportStatus — capped is a DISTINCT terminal status', () => {
  it('from "answered", a capped event sets status=capped with exitCode/resultTail — never conflated with killed/exited', () => {
    const s = new DispatchStore(statePath, auditPath);
    const enq = enqueueDispatch(s, { timeoutSec: 30 });
    if (!enq.ok) throw new Error('unreachable');
    s.decide(enq.record.id, 'accept', {});
    const seen: string[] = [];
    s.onUpdate((b) => seen.push(b.status));
    s.reportStatus(enq.record.id, { event: 'capped', exitCode: -1, resultTail: 'cut off at cap' });
    expect(seen).toEqual(['capped']);
    const record = s.getRecent().find((r) => r.id === enq.record.id);
    expect(record?.status).toBe('capped');
    expect(record?.status).not.toBe('killed');
    expect(record?.status).not.toBe('exited');
    expect(record?.resultTail).toBe('cut off at cap');
  });

  it('capped is only honored from "answered" — never re-terminalizes an already-terminal record', () => {
    const s = new DispatchStore(statePath, auditPath);
    const enq = enqueueDispatch(s);
    if (!enq.ok) throw new Error('unreachable');
    s.decide(enq.record.id, 'accept', {});
    s.reportStatus(enq.record.id, { event: 'exited', exitCode: 0 });
    const seen: string[] = [];
    s.onUpdate((b) => seen.push(b.status));
    // A stray/late cap-timer fire racing a natural exit — must not overwrite.
    s.reportStatus(enq.record.id, { event: 'capped', exitCode: -1 });
    expect(seen).toEqual([]); // no re-broadcast
    expect(s.getRecent().find((r) => r.id === enq.record.id)?.status).toBe('exited');
  });
});

// ── DAILY FLEET SPEND CEILING ────────────────────────────────────

describe('DispatchStore — budgetGate / HELD ("queued-budget") state', () => {
  it('no budgetGate configured (setBudgetGate never called) — current unbounded behavior, always rings', () => {
    const s = new DispatchStore(statePath, auditPath);
    const result = enqueueDispatch(s);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.record.status).toBe('ringing');
  });

  it('a gate returning null (e.g. no ceiling configured) — still rings normally', () => {
    const s = new DispatchStore(statePath, auditPath);
    s.setBudgetGate(() => null);
    const result = enqueueDispatch(s);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.record.status).toBe('ringing');
  });

  it('spend below the ceiling — rings normally', () => {
    const s = new DispatchStore(statePath, auditPath);
    s.setBudgetGate(() => ({ ceiling: 1000, spend: 500 }));
    const result = enqueueDispatch(s);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.record.status).toBe('ringing');
  });

  it('spend AT the ceiling (exact boundary) — held, not rung', () => {
    const s = new DispatchStore(statePath, auditPath);
    s.setBudgetGate(() => ({ ceiling: 1000, spend: 1000 }));
    const result = enqueueDispatch(s);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.record.status).toBe('queued-budget');
    expect(result.record.reason).toContain('HELD');
    expect(result.record.reason).toContain('1000');
  });

  it('spend past the ceiling — held with an honest reason, never sent to the runner', () => {
    const s = new DispatchStore(statePath, auditPath);
    s.setBudgetGate(() => ({ ceiling: 500, spend: 750 }));
    const result = enqueueDispatch(s);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.record.status).toBe('queued-budget');
    expect(result.record.reason).toBe('HELD — daily ceiling 500 reached, spend 750');
    // Never sent to a runner poll — pendingFor only returns 'ringing'.
    expect(s.pendingFor('MACBOOK')).toHaveLength(0);
  });

  it('a held request bypasses the ringing cap entirely — it never rings, so backpressure does not apply to it', () => {
    const s = new DispatchStore(statePath, auditPath);
    s.setBudgetGate(() => ({ ceiling: 100, spend: 200 }));
    for (let i = 0; i < DISPATCH_RINGING_CAP + 2; i++) {
      const r = enqueueDispatch(s, { prompt: `p${String(i)}` });
      expect(r.ok).toBe(true);
    }
  });

  it('a "focus" action is never held (only dispatch spends fleet tokens)', () => {
    const s = new DispatchStore(statePath, auditPath);
    s.setBudgetGate(() => ({ ceiling: 0, spend: 1_000_000 }));
    // C8-5: focus now requires a live focus:true advertisement.
    s.recordAdvertisement('MACBOOK', { providers: ['claude'], roots: ['/x'], focus: true });
    const result = s.enqueue({ action: 'focus', machine: 'MACBOOK', pid: 123 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.record.status).toBe('ringing');
  });

  it('a held record is visible via getActive() (non-terminal, survives a WS reconnect replay)', () => {
    const s = new DispatchStore(statePath, auditPath);
    s.setBudgetGate(() => ({ ceiling: 0, spend: 1 }));
    enqueueDispatch(s);
    expect(s.getActive()).toHaveLength(1);
    expect(s.getActive()[0].status).toBe('queued-budget');
  });

  it('a held record cannot be stopped — requestStop reports not-in-flight, same as any never-started record', () => {
    const s = new DispatchStore(statePath, auditPath);
    s.setBudgetGate(() => ({ ceiling: 0, spend: 1 }));
    const enq = enqueueDispatch(s);
    if (!enq.ok) throw new Error('unreachable');
    expect(s.requestStop(enq.record.id)).toEqual({ ok: false, reason: 'not-in-flight' });
  });

  it('sweepExpired never touches a held record — it was never ringing, so the ringing TTL is irrelevant', () => {
    const s = new DispatchStore(statePath, auditPath);
    s.setBudgetGate(() => ({ ceiling: 0, spend: 1 }));
    const enq = enqueueDispatch(s);
    if (!enq.ok) throw new Error('unreachable');
    const farFuture = Date.now() + 24 * 60 * 60_000;
    s.sweepExpired(farFuture);
    expect(s.getRecent().find((r) => r.id === enq.record.id)?.status).toBe('queued-budget');
  });
});

describe('DispatchStore.releaseHeld — explicit human override', () => {
  it('releases a held record to ringing, clears the reason, and re-broadcasts', () => {
    const s = new DispatchStore(statePath, auditPath);
    s.setBudgetGate(() => ({ ceiling: 0, spend: 1 }));
    const enq = enqueueDispatch(s);
    if (!enq.ok) throw new Error('unreachable');
    const seen: string[] = [];
    s.onUpdate((b) => seen.push(b.status));
    const result = s.releaseHeld(enq.record.id);
    expect(result).toEqual({ ok: true });
    expect(seen).toEqual(['ringing']);
    const record = s.getRecent().find((r) => r.id === enq.record.id);
    expect(record?.status).toBe('ringing');
    expect(record?.reason).toBeUndefined();
    // Now genuinely pollable by the runner.
    expect(s.pendingFor('MACBOOK')).toHaveLength(1);
  });

  it('unknown id', () => {
    const s = new DispatchStore(statePath, auditPath);
    expect(s.releaseHeld('nope')).toEqual({ ok: false, reason: 'unknown-id' });
  });

  it('a record that is not held (e.g. already ringing) is rejected as not-held', () => {
    const s = new DispatchStore(statePath, auditPath);
    const enq = enqueueDispatch(s);
    if (!enq.ok) throw new Error('unreachable');
    expect(s.releaseHeld(enq.record.id)).toEqual({ ok: false, reason: 'not-held' });
  });
});

describe('DispatchStore.sweepHeldRollover — automatic local-date-rollover release', () => {
  it('a held record created before the start of the current local day auto-releases', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);
    const s = new DispatchStore(statePath, auditPath);
    s.setBudgetGate(() => ({ ceiling: 0, spend: 1 }));
    // enqueue()'s `now` param controls createdAt directly — the fixture
    // world's simplest way to backdate a held record without waiting a
    // real day.
    const heldYesterday = s.enqueue(
      { action: 'dispatch', machine: 'MACBOOK', provider: 'claude', cwd: '/x', prompt: 'p' },
      yesterday.getTime(),
    );
    if (!heldYesterday.ok) throw new Error('unreachable');
    expect(heldYesterday.record.status).toBe('queued-budget');

    const released = s.sweepHeldRollover(Date.now());
    expect(released).toBe(1);
    const record = s.getRecent().find((r) => r.id === heldYesterday.record.id);
    expect(record?.status).toBe('ringing');
    expect(record?.reason).toBeUndefined();
  });

  it('a held record created earlier TODAY does not release — same local day, ceiling still applies', () => {
    const s = new DispatchStore(statePath, auditPath);
    s.setBudgetGate(() => ({ ceiling: 0, spend: 1 }));
    const enq = enqueueDispatch(s);
    if (!enq.ok) throw new Error('unreachable');
    const released = s.sweepHeldRollover(Date.now());
    expect(released).toBe(0);
    expect(s.getRecent().find((r) => r.id === enq.record.id)?.status).toBe('queued-budget');
  });

  it('a non-held record is never touched by the rollover sweep', () => {
    const s = new DispatchStore(statePath, auditPath);
    const enq = enqueueDispatch(s);
    if (!enq.ok) throw new Error('unreachable');
    const released = s.sweepHeldRollover(Date.now() + 24 * 60 * 60_000);
    expect(released).toBe(0);
    expect(s.getRecent().find((r) => r.id === enq.record.id)?.status).toBe('ringing');
  });
});

// ── Codex fix round finding 6: release/rollover re-check the ringing cap ──

describe('HELD release re-checks the per-machine ringing cap — never a backpressure bypass', () => {
  /** Fill a machine's ringing queue to exactly `count` live entries. */
  function fillRinging(s: DispatchStore, count: number): void {
    for (let i = 0; i < count; i++) {
      const r = enqueueDispatch(s, { prompt: `filler-${String(i)}` });
      expect(r.ok).toBe(true);
    }
  }

  it('releaseHeld into a FULL ringing queue is an honest 2xx deny; the record stays held and releases once a slot frees', () => {
    const s = new DispatchStore(statePath, auditPath);
    fillRinging(s, 5); // DISPATCH_RINGING_CAP
    s.setBudgetGate(() => ({ ceiling: 0, spend: 1 }));
    const held = enqueueDispatch(s, { prompt: 'held' });
    if (!held.ok) throw new Error('unreachable');
    expect(held.record.status).toBe('queued-budget');
    s.setBudgetGate(() => null);

    expect(s.releaseHeld(held.record.id)).toEqual({ ok: false, reason: 'ringing-cap' });
    expect(s.getRecent().find((r) => r.id === held.record.id)?.status).toBe('queued-budget');

    // Free one slot (a ringing request expires via deny) — now the override works.
    const filler = s.getRecent().find((r) => r.status === 'ringing');
    if (!filler) throw new Error('unreachable');
    s.decide(filler.id, 'deny', { reason: 'test' });
    expect(s.releaseHeld(held.record.id).ok).toBe(true);
  });

  it('the rollover sweep releases only up to the cap — over-cap entries stay held (retried next sweep), and an earlier release in the SAME sweep counts against later candidates', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);
    const s = new DispatchStore(statePath, auditPath);
    fillRinging(s, 4); // one slot left under the cap of 5
    s.setBudgetGate(() => ({ ceiling: 0, spend: 1 }));
    const heldA = s.enqueue(
      { action: 'dispatch', machine: 'MACBOOK', provider: 'claude', cwd: '/x', prompt: 'a' },
      yesterday.getTime(),
    );
    const heldB = s.enqueue(
      { action: 'dispatch', machine: 'MACBOOK', provider: 'claude', cwd: '/x', prompt: 'b' },
      yesterday.getTime(),
    );
    if (!heldA.ok || !heldB.ok) throw new Error('unreachable');
    s.setBudgetGate(() => null);

    expect(s.sweepHeldRollover(Date.now())).toBe(1); // exactly the one free slot
    const statuses = [heldA.record.id, heldB.record.id].map(
      (id) => s.getRecent().find((r) => r.id === id)?.status,
    );
    expect(statuses.filter((st) => st === 'ringing')).toHaveLength(1);
    expect(statuses.filter((st) => st === 'queued-budget')).toHaveLength(1);

    // Next sweep with a freed slot picks up the straggler.
    const heldIds = [heldA.record.id, heldB.record.id];
    const ringingFiller = s
      .getRecent()
      .find((r) => r.status === 'ringing' && !heldIds.includes(r.id));
    if (!ringingFiller) throw new Error('unreachable');
    s.decide(ringingFiller.id, 'deny', { reason: 'test' });
    expect(s.sweepHeldRollover(Date.now())).toBe(1);
  });
});
