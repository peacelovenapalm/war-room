/**
 * STOP ALL kill switch tests (v2 mechanic G3, GAME-DESIGN.md §7.5). Covers:
 * stop-all mid-chain never enqueues the next step, resume restores exactly
 * the previously-enabled order set (never a manually-disabled one), and a
 * manual CallModal dispatch still succeeds while automation is stopped.
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

function uniqueMachine(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`.toUpperCase();
}

async function poll(port: number, token: string, machine: string) {
  const res = await fetch(`http://127.0.0.1:${port}/api/dispatch/poll`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Machine': machine,
    },
    body: JSON.stringify({ providers: ['claude'], roots: ['/tmp'], focus: false }),
  });
  const body = (await res.json()) as { pending: Array<{ id: string }> };
  return body.pending;
}

describe('STOP ALL (real HTTP round trip)', () => {
  let server: InstanceType<typeof PixelAgentsServer>;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-stop-all-'));
    fs.mkdirSync(path.join(tmpBase, '.pixel-agents'), { recursive: true });
    server = new PixelAgentsServer();
  });

  afterEach(() => {
    server?.stop();
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('stop-all mid-chain halts the run; the in-flight step finishing never enqueues the next step', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machine = uniqueMachine('MACBOOK');

    const defRes = await fetch(`http://127.0.0.1:${config.port}/api/chains/defs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'x',
        steps: [
          { id: 's1', machine, provider: 'claude', cwd: '/tmp/proj', prompt: 'first' },
          { id: 's2', machine, provider: 'claude', cwd: '/tmp/proj', prompt: 'second' },
        ],
      }),
    });
    const defBody = (await defRes.json()) as { def: { id: string } };

    const runRes = await fetch(
      `http://127.0.0.1:${config.port}/api/chains/defs/${defBody.def.id}/run`,
      { method: 'POST' },
    );
    const runBody = (await runRes.json()) as { run: { id: string } };
    const runId = runBody.run.id;

    // Step 1 is in flight (dispatched, not yet terminal).
    const pending1 = await poll(config.port, config.token, machine);
    expect(pending1).toHaveLength(1);
    const step1Id = pending1[0].id;

    const stopRes = await fetch(`http://127.0.0.1:${config.port}/api/automation/stop-all`, {
      method: 'POST',
    });
    const stopBody = (await stopRes.json()) as { ok: boolean; haltedRuns: number };
    expect(stopBody.ok).toBe(true);
    expect(stopBody.haltedRuns).toBe(1);

    const runsAfterStop = (await (
      await fetch(`http://127.0.0.1:${config.port}/api/chains/runs`)
    ).json()) as Array<{ id: string; status: string }>;
    expect(runsAfterStop.find((r) => r.id === runId)?.status).toBe('halted');

    // The already-dispatched step 1 finishes on its own (already spent) —
    // this must NOT resurrect the run or enqueue step 2.
    await fetch(`http://127.0.0.1:${config.port}/api/dispatch/${step1Id}/decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'accept' }),
    });
    await fetch(`http://127.0.0.1:${config.port}/api/dispatch/${step1Id}/status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'exited', exitCode: 0 }),
    });

    const runsAfterExit = (await (
      await fetch(`http://127.0.0.1:${config.port}/api/chains/runs`)
    ).json()) as Array<{ id: string; status: string }>;
    expect(runsAfterExit.find((r) => r.id === runId)?.status).toBe('halted'); // unchanged

    const pendingAfterExit = await poll(config.port, config.token, machine);
    expect(pendingAfterExit).toHaveLength(0); // step 2 never enqueued
  });

  it('resume restores exactly the previously-enabled order set — never a manually-disabled one', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machine = uniqueMachine('MACBOOK');

    const createA = await fetch(`http://127.0.0.1:${config.port}/api/standing-orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'a',
        schedule: { kind: 'interval', everyMs: 1000 },
        machine,
        provider: 'claude',
        cwd: '/tmp',
        prompt: 'go',
      }),
    });
    const aBody = (await createA.json()) as { order: { id: string } };

    // Buy Second Shift so a SECOND order fits under the cap, then disable
    // it manually BEFORE STOP ALL — resume must not resurrect it.
    await fetch(`http://127.0.0.1:${config.port}/api/economy`, { method: 'GET' });
    const { economyStore } = await import('../src/economyStore.js');
    economyStore.addCash(500, { label: 'test-seed', sourceEventRefs: ['test:test-seed'] });
    const buyRes = await fetch(`http://127.0.0.1:${config.port}/api/economy/perks/buy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'secondShift' }),
    });
    expect(((await buyRes.json()) as { ok: boolean }).ok).toBe(true);

    const createB = await fetch(`http://127.0.0.1:${config.port}/api/standing-orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'b',
        schedule: { kind: 'interval', everyMs: 1000 },
        machine,
        provider: 'claude',
        cwd: '/tmp',
        prompt: 'go',
      }),
    });
    const bBody = (await createB.json()) as { order: { id: string } };
    await fetch(`http://127.0.0.1:${config.port}/api/standing-orders/${bBody.order.id}/enabled`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    await fetch(`http://127.0.0.1:${config.port}/api/automation/stop-all`, { method: 'POST' });
    const afterStop = (await (
      await fetch(`http://127.0.0.1:${config.port}/api/standing-orders`)
    ).json()) as Array<{ id: string; enabled: boolean }>;
    expect(afterStop.find((o) => o.id === aBody.order.id)?.enabled).toBe(false);
    expect(afterStop.find((o) => o.id === bBody.order.id)?.enabled).toBe(false);

    const resumeRes = await fetch(`http://127.0.0.1:${config.port}/api/automation/resume`, {
      method: 'POST',
    });
    const resumeBody = (await resumeRes.json()) as { ok: boolean; resumedOrders: number };
    expect(resumeBody.ok).toBe(true);
    expect(resumeBody.resumedOrders).toBe(1); // only A, never B

    const afterResume = (await (
      await fetch(`http://127.0.0.1:${config.port}/api/standing-orders`)
    ).json()) as Array<{ id: string; enabled: boolean }>;
    expect(afterResume.find((o) => o.id === aBody.order.id)?.enabled).toBe(true);
    expect(afterResume.find((o) => o.id === bBody.order.id)?.enabled).toBe(false); // still off
  });

  it('a manual CallModal dispatch still succeeds while automation is stopped', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machine = uniqueMachine('MACBOOK');

    await fetch(`http://127.0.0.1:${config.port}/api/automation/stop-all`, { method: 'POST' });

    const ws = new WebSocket(`ws://127.0.0.1:${config.port}/ws`);
    await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
    ws.send(
      JSON.stringify({
        type: 'dispatchRequest',
        action: 'dispatch',
        machine,
        provider: 'claude',
        cwd: '/tmp',
        prompt: 'manual send while stopped',
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    const pending = await poll(config.port, config.token, machine);
    expect(pending).toHaveLength(1); // succeeded — STOP ALL targets autonomy, not the human
    ws.close();
  });

  it('broadcasts automationStopped on stop-all', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const ws = new WebSocket(`ws://127.0.0.1:${config.port}/ws`);
    await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
    const messages: Array<Record<string, unknown>> = [];
    ws.addEventListener('message', (event) => {
      messages.push(JSON.parse(event.data as string));
    });

    await fetch(`http://127.0.0.1:${config.port}/api/automation/stop-all`, { method: 'POST' });

    await vi.waitFor(() => {
      expect(messages.some((m) => m.type === 'automationStopped')).toBe(true);
    });
    ws.close();
  });
});
