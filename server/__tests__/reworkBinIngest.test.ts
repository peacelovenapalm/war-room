/**
 * Scrap & Rework Bin ingest + route tests (v3 WS-C stage 2). Unit level:
 * only REAL failures pile (exit≠0 / killed / vanished-while-blocked),
 * verbatim excerpts, store-level dedupe. Route level (real server): the
 * REWORK verb re-enqueues the ORIGINAL params through the NORMAL dispatch
 * path (every gate intact — the ringing cap refusal is asserted), DISMISS
 * is first-class with a reason and counts on the SHIFT scorecard, and
 * crisis crates are honestly not redispatchable.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

const { PixelAgentsServer } = await import('../src/server.js');
const { AgentStateStore } = await import('../src/agentStateStore.js');
const { DispatchStore, dispatchStore } = await import('../src/dispatchStore.js');
const { ReworkBinIngest } = await import('../src/reworkBinIngest.js');
const { reworkBinStore, ReworkBinStore } = await import('../src/reworkBinStore.js');
const { ShiftStats } = await import('../src/shiftStats.js');

import type { ReworkBinItem } from '../../core/src/messages.js';
import type { DispatchBroadcast } from '../src/dispatchStore.js';
import { DISPATCH_CONTEXT_PREAMBLE } from '../src/dispatchStore.js';

beforeEach(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-rework-test-'));
  fs.mkdirSync(path.join(tmpBase, '.pixel-agents'), { recursive: true });
});

afterEach(() => {
  try {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function makeIngest() {
  const bin = new ReworkBinStore(path.join(tmpBase, 'rework-bin.json'));
  const ingest = new ReworkBinIngest(bin);
  return { bin, ingest };
}

function broadcast(overrides: Partial<DispatchBroadcast>): DispatchBroadcast {
  return {
    type: 'dispatchUpdate',
    id: 'd-1',
    action: 'dispatch',
    status: 'exited',
    machine: 'TESTMACH',
    ...overrides,
  };
}

describe('ReworkBinIngest — only real failures pile', () => {
  it('piles a nonzero exit with the VERBATIM result tail', () => {
    const { bin, ingest } = makeIngest();
    ingest.onDispatchUpdate(
      broadcast({ exitCode: 2, resultTail: 'Error: ECONNREFUSED 127.0.0.1:5432' }),
    );
    const items = bin.getPiled();
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe('dispatch');
    expect(items[0].failureRef.id).toBe('d-1');
    expect(items[0].failureRef.excerpt).toBe('Error: ECONNREFUSED 127.0.0.1:5432');
  });

  it('piles a killed dispatch; clean exits, focus actions, and denials pile NOTHING', () => {
    const { bin, ingest } = makeIngest();
    ingest.onDispatchUpdate(broadcast({ id: 'd-ok', exitCode: 0, resultTail: 'all good' }));
    ingest.onDispatchUpdate(broadcast({ id: 'd-focus', action: 'focus', exitCode: 1 }));
    ingest.onDispatchUpdate(broadcast({ id: 'd-denied', status: 'denied' }));
    expect(bin.getPiled()).toHaveLength(0);

    ingest.onDispatchUpdate(broadcast({ id: 'd-killed', status: 'killed', exitCode: undefined }));
    const items = bin.getPiled();
    expect(items).toHaveLength(1);
    expect(items[0].failureRef.id).toBe('d-killed');
    expect(items[0].failureRef.excerpt).toContain('killed via the stop channel');
  });

  it('the same failure broadcast twice stacks ONE crate (store dedupe)', () => {
    const { bin, ingest } = makeIngest();
    ingest.onDispatchUpdate(broadcast({ exitCode: 1, resultTail: 'boom' }));
    ingest.onDispatchUpdate(broadcast({ exitCode: 1, resultTail: 'boom' }));
    expect(bin.getPiled()).toHaveLength(1);
  });

  it('piles a vanished-while-blocked crisis with the verbatim waitingFor', () => {
    const { bin, ingest } = makeIngest();
    ingest.recordAbandonedCrisis(4, 'NEXUS', '/code/war-room', 'Approve migration 0042?', 1000);
    const items = bin.getPiled();
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe('crisis');
    expect(items[0].failureRef.id).toBe('agent:4@NEXUS');
    expect(items[0].failureRef.excerpt).toBe('Approve migration 0042?');
  });
});

describe('DispatchStore.getRedispatchInput', () => {
  it('returns the ORIGINAL request params (server-side only) and refuses focus actions', () => {
    const store = new DispatchStore(
      path.join(tmpBase, 'dq.json'),
      path.join(tmpBase, 'dq-audit.jsonl'),
    );
    const enq = store.enqueue({
      action: 'dispatch',
      machine: 'TESTMACH',
      provider: 'claude',
      cwd: '/repo',
      prompt: 'fix the flaky test',
      model: 'fable',
      effort: 'high',
    });
    if (!enq.ok) throw new Error('enqueue failed');
    expect(store.getRedispatchInput(enq.record.id)).toEqual({
      action: 'dispatch',
      machine: 'TESTMACH',
      provider: 'claude',
      cwd: '/repo',
      // 4B: the stored prompt carries the context preamble; re-enqueue's
      // startsWith guard keeps it from doubling.
      prompt: `${DISPATCH_CONTEXT_PREAMBLE}fix the flaky test`,
      model: 'fable',
      effort: 'high',
      permissionMode: undefined,
    });

    // C8-5: focus now requires a live focus:true advertisement.
    store.recordAdvertisement('TESTMACH', { providers: ['claude'], roots: ['/repo'], focus: true });
    const focus = store.enqueue({ action: 'focus', machine: 'TESTMACH', sessionId: 'sess-1' });
    if (!focus.ok) throw new Error('focus enqueue failed');
    expect(store.getRedispatchInput(focus.record.id)).toBeUndefined();
    expect(store.getRedispatchInput('unknown')).toBeUndefined();
  });
});

describe('ShiftStats.recordReworkDismissed', () => {
  it('counts dismissals on the scorecard (informational, no grade effect)', () => {
    const stats = new ShiftStats(path.join(tmpBase, 'shift.json'), () => {});
    const now = Date.now();
    expect(stats.getReport(now).reworkDismissed).toBe(0);
    stats.recordReworkDismissed(now);
    stats.recordReworkDismissed(now);
    const report = stats.getReport(now);
    expect(report.reworkDismissed).toBe(2);
    expect(report.efficiency).toBeNull(); // dismissals never grade anything
  });
});

describe('rework routes (real server)', () => {
  let server: InstanceType<typeof PixelAgentsServer>;

  beforeEach(() => {
    server = new PixelAgentsServer();
  });

  afterEach(() => {
    server?.stop();
  });

  function uniqueMachine(): string {
    return `RW-${crypto.randomUUID().slice(0, 8)}`.toUpperCase();
  }

  /** Enqueue directly on the singleton store (the routes and ingest are
   *  wired to it), accept, then report a failing exit. */
  function failOneDispatch(machine: string, prompt: string): string {
    const enq = dispatchStore.enqueue({
      action: 'dispatch',
      machine,
      provider: 'claude',
      cwd: '/repo',
      prompt,
    });
    if (!enq.ok) throw new Error(`enqueue failed: ${enq.reason}`);
    dispatchStore.decide(enq.record.id, 'accept', { pid: 1234 });
    dispatchStore.reportStatus(enq.record.id, {
      event: 'exited',
      exitCode: 7,
      resultTail: `verbatim failure for ${prompt}`,
    });
    return enq.record.id;
  }

  async function getRework(port: number): Promise<ReworkBinItem[]> {
    const res = await fetch(`http://127.0.0.1:${port}/api/rework`);
    return (await res.json()) as ReworkBinItem[];
  }

  it('REWORK re-dispatches through the normal path and marks the crate reworked', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machine = uniqueMachine();
    const prompt = `rework-me-${crypto.randomUUID()}`;
    const failedId = failOneDispatch(machine, prompt);

    const crate = (await getRework(config.port)).find((i) => i.failureRef.id === failedId);
    expect(crate).toBeDefined();
    expect(crate!.status).toBe('piled');
    expect(crate!.failureRef.excerpt).toBe(`verbatim failure for ${prompt}`);

    const res = await fetch(`http://127.0.0.1:${config.port}/api/rework/${crate!.id}/redispatch`, {
      method: 'POST',
    });
    const body = (await res.json()) as { ok: boolean; dispatchId?: string };
    expect(body.ok).toBe(true);

    // The fresh dispatch is a NORMAL ringing queue entry for that machine,
    // carrying the ORIGINAL prompt — visible on the runner poll surface.
    const pending = dispatchStore.pendingFor(machine);
    expect(
      pending.some(
        (p) => p.id === body.dispatchId && p.prompt === `${DISPATCH_CONTEXT_PREAMBLE}${prompt}`,
      ),
    ).toBe(true);

    const after = (await getRework(config.port)).find((i) => i.id === crate!.id);
    expect(after!.status).toBe('reworked');
  });

  it('GATE HONESTY: a ringing-cap refusal leaves the crate piled (never bypassed)', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machine = uniqueMachine();
    const failedId = failOneDispatch(machine, `cap-test-${crypto.randomUUID()}`);
    const crate = (await getRework(config.port)).find((i) => i.failureRef.id === failedId);

    // Fill the machine's ringing cap (5) with fresh requests.
    for (let i = 0; i < 5; i++) {
      const enq = dispatchStore.enqueue({
        action: 'dispatch',
        machine,
        provider: 'claude',
        cwd: '/repo',
        prompt: `filler ${i}`,
      });
      if (!enq.ok) throw new Error('filler enqueue failed');
    }

    const res = await fetch(`http://127.0.0.1:${config.port}/api/rework/${crate!.id}/redispatch`, {
      method: 'POST',
    });
    const body = (await res.json()) as { ok: boolean; reason?: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('ringing-cap-exceeded');

    const after = (await getRework(config.port)).find((i) => i.id === crate!.id);
    expect(after!.status).toBe('piled'); // the gate held; the crate stays
  });

  it('DISMISS records the reason and increments the SHIFT scorecard count', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machine = uniqueMachine();
    const failedId = failOneDispatch(machine, `dismiss-me-${crypto.randomUUID()}`);
    const crate = (await getRework(config.port)).find((i) => i.failureRef.id === failedId);

    const shiftBefore = (await (
      await fetch(`http://127.0.0.1:${config.port}/api/shift`)
    ).json()) as { today: { reworkDismissed: number } };

    const res = await fetch(`http://127.0.0.1:${config.port}/api/rework/${crate!.id}/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'superseded by the v3 rewrite' }),
    });
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);

    const after = (await getRework(config.port)).find((i) => i.id === crate!.id);
    expect(after!.status).toBe('dismissed');
    expect(after!.dismissedReason).toBe('superseded by the v3 rewrite');

    const shiftAfter = (await (
      await fetch(`http://127.0.0.1:${config.port}/api/shift`)
    ).json()) as { today: { reworkDismissed: number } };
    expect(shiftAfter.today.reworkDismissed).toBe(shiftBefore.today.reworkDismissed + 1);

    // Dismissing twice is a refusal, not a double-count.
    const again = await fetch(`http://127.0.0.1:${config.port}/api/rework/${crate!.id}/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(((await again.json()) as { ok: boolean }).ok).toBe(false);
  });

  it('crisis crates are honestly not redispatchable (dismiss is their verb)', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const piled = reworkBinStore.pile('crisis', {
      id: `agent:99@${uniqueMachine()}`,
      excerpt: 'Approve the schema change?',
    });
    if (!piled.ok) throw new Error('pile failed');

    const res = await fetch(
      `http://127.0.0.1:${config.port}/api/rework/${piled.item.id}/redispatch`,
      { method: 'POST' },
    );
    const body = (await res.json()) as { ok: boolean; reason?: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('not-redispatchable');
  });
});
