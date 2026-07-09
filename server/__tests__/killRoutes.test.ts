/**
 * Worker session kill HTTP route tests (KICKOFF v1.1 item 3 — the first
 * server->runner IMPERATIVE channel). dispatchStore.ts's own
 * requestStop/drainStopsFor/reportStatus('killed')/pid-kill transitions are
 * covered by dispatchStore.test.ts; chainOrchestrator.test.ts covers the
 * chain-halt semantics against real stores with no HTTP layer. This file
 * exercises the routes wired in httpServer.ts on top of both: the
 * dispatch-id kill route, the observed-pid kill routes, cross-machine
 * containment (a stop instruction can NEVER be spoofed onto the wrong
 * machine's poll response), and that STOP ALL still works end-to-end after
 * an individual kill has already happened.
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

async function poll(
  port: number,
  token: string,
  machine: string,
): Promise<{ pending: Array<{ id: string }>; stop: Array<Record<string, unknown>> }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/dispatch/poll`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Machine': machine,
    },
    body: JSON.stringify({ providers: ['claude'], roots: ['/tmp'], focus: false }),
  });
  return (await res.json()) as {
    pending: Array<{ id: string }>;
    stop: Array<Record<string, unknown>>;
  };
}

async function dispatchOne(
  port: number,
  token: string,
  machine: string,
  prompt: string,
): Promise<string> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
  ws.send(
    JSON.stringify({
      type: 'dispatchRequest',
      action: 'dispatch',
      machine,
      provider: 'claude',
      cwd: '/tmp',
      prompt,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  ws.close();
  const body = await poll(port, token, machine);
  return body.pending[body.pending.length - 1].id;
}

describe('worker session kill — dispatch-id route', () => {
  let server: InstanceType<typeof PixelAgentsServer>;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-kill-test-'));
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

  it('two concurrent dispatches: killing one attaches a stop instruction to ITS machine only, and reporting "killed" leaves the other dispatch\'s eventual "exited" untouched', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machine = uniqueMachine('MACBOOK');

    const idA = await dispatchOne(config.port, config.token, machine, 'first');
    const idB = await dispatchOne(config.port, config.token, machine, 'second');
    expect(idA).not.toBe(idB);

    // Both must be accepted (answered) before they're "in flight" and
    // therefore killable — accept both via the decision route (simulating
    // the runner's own accept, same as the real poll->decide flow).
    for (const id of [idA, idB]) {
      const res = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/${id}/decision`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'accept', pid: id === idA ? 1111 : 2222 }),
      });
      expect(res.status).toBe(200);
    }

    // Kill A via the webview-facing route.
    const killRes = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/${idA}/kill`, {
      method: 'POST',
    });
    expect(killRes.status).toBe(200);
    expect(((await killRes.json()) as { ok: boolean }).ok).toBe(true);

    // The NEXT poll for that machine carries the stop instruction for A only.
    const polled = await poll(config.port, config.token, machine);
    expect(polled.stop).toEqual([{ kind: 'dispatch', id: idA }]);

    // Simulate the runner acting on it: SIGTERM sent, process exits, runner
    // reports the DISTINCT "killed" event (never "exited").
    const statusRes = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/${idA}/status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'killed', exitCode: -1 }),
    });
    expect(statusRes.status).toBe(200);

    // B completes normally, unaffected.
    const statusResB = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/${idB}/status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'exited', exitCode: 0 }),
    });
    expect(statusResB.status).toBe(200);

    const recent = (await (
      await fetch(`http://127.0.0.1:${config.port}/api/dispatch/recent`)
    ).json()) as Array<{ id: string; status: string }>;
    expect(recent.find((r) => r.id === idA)?.status).toBe('killed'); // DISTINCT terminal state
    expect(recent.find((r) => r.id === idB)?.status).toBe('exited'); // untouched, normal completion
  });

  it("a stop instruction is NEVER delivered to the wrong machine's poll response (cross-machine containment)", async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machineA = uniqueMachine('MACBOOK');
    const machineB = uniqueMachine('MINI');

    const id = await dispatchOne(config.port, config.token, machineA, 'only on A');
    await fetch(`http://127.0.0.1:${config.port}/api/dispatch/${id}/decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'accept', pid: 1111 }),
    });
    await fetch(`http://127.0.0.1:${config.port}/api/dispatch/${id}/kill`, { method: 'POST' });

    // Machine B (an entirely different, unrelated machine) polls first —
    // it must NEVER see A's stop instruction, no matter what.
    const polledB = await poll(config.port, config.token, machineB);
    expect(polledB.stop).toEqual([]);

    // Machine A still sees it, untouched by B's poll.
    const polledA = await poll(config.port, config.token, machineA);
    expect(polledA.stop).toEqual([{ kind: 'dispatch', id }]);
  });

  it('killing a dispatch belonging to a chain step halts that run, and the killed step gets a distinct terminal status', async () => {
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

    const pending = await poll(config.port, config.token, machine);
    expect(pending.pending).toHaveLength(1);
    const stepId = pending.pending[0].id;
    await fetch(`http://127.0.0.1:${config.port}/api/dispatch/${stepId}/decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'accept', pid: 1111 }),
    });

    const killRes = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/${stepId}/kill`, {
      method: 'POST',
    });
    expect(((await killRes.json()) as { ok: boolean }).ok).toBe(true);

    await fetch(`http://127.0.0.1:${config.port}/api/dispatch/${stepId}/status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'killed', exitCode: -1 }),
    });

    const runsAfter = (await (
      await fetch(`http://127.0.0.1:${config.port}/api/chains/runs`)
    ).json()) as Array<{ id: string; status: string; steps: Array<{ status: string }> }>;
    const run = runsAfter.find((r) => r.id === runBody.run.id);
    expect(run?.status).toBe('halted'); // same terminal semantics as STOP ALL, never 'failed'
    expect(run?.steps[0]?.status).toBe('killed');
    expect(await poll(config.port, config.token, machine).then((p) => p.pending)).toHaveLength(0); // step 2 never enqueued
  });

  it('STOP ALL still halts everything end-to-end even after an individual kill already happened', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machineKilled = uniqueMachine('MACBOOK');
    const machineOther = uniqueMachine('MINI');

    const defKilled = await fetch(`http://127.0.0.1:${config.port}/api/chains/defs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'killed-chain',
        steps: [{ id: 's1', machine: machineKilled, provider: 'claude', cwd: '/tmp', prompt: 'a' }],
      }),
    });
    const defKilledBody = (await defKilled.json()) as { def: { id: string } };
    const runKilledRes = await fetch(
      `http://127.0.0.1:${config.port}/api/chains/defs/${defKilledBody.def.id}/run`,
      { method: 'POST' },
    );
    const runKilled = (await runKilledRes.json()) as { run: { id: string } };

    const defOther = await fetch(`http://127.0.0.1:${config.port}/api/chains/defs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'other-chain',
        steps: [{ id: 's1', machine: machineOther, provider: 'claude', cwd: '/tmp', prompt: 'b' }],
      }),
    });
    const defOtherBody = (await defOther.json()) as { def: { id: string } };
    const runOtherRes = await fetch(
      `http://127.0.0.1:${config.port}/api/chains/defs/${defOtherBody.def.id}/run`,
      { method: 'POST' },
    );
    const runOther = (await runOtherRes.json()) as { run: { id: string } };

    const pendingKilled = await poll(config.port, config.token, machineKilled);
    const killedStepId = pendingKilled.pending[0].id;
    await fetch(`http://127.0.0.1:${config.port}/api/dispatch/${killedStepId}/decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'accept', pid: 1111 }),
    });
    await fetch(`http://127.0.0.1:${config.port}/api/dispatch/${killedStepId}/kill`, {
      method: 'POST',
    });
    await fetch(`http://127.0.0.1:${config.port}/api/dispatch/${killedStepId}/status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'killed', exitCode: -1 }),
    });

    const runsAfterKill = (await (
      await fetch(`http://127.0.0.1:${config.port}/api/chains/runs`)
    ).json()) as Array<{ id: string; status: string }>;
    expect(runsAfterKill.find((r) => r.id === runKilled.run.id)?.status).toBe('halted');
    expect(runsAfterKill.find((r) => r.id === runOther.run.id)?.status).toBe('running'); // still running

    const stopRes = await fetch(`http://127.0.0.1:${config.port}/api/automation/stop-all`, {
      method: 'POST',
    });
    expect(((await stopRes.json()) as { ok: boolean }).ok).toBe(true);

    const runsAfterStopAll = (await (
      await fetch(`http://127.0.0.1:${config.port}/api/chains/runs`)
    ).json()) as Array<{ id: string; status: string }>;
    expect(runsAfterStopAll.find((r) => r.id === runOther.run.id)?.status).toBe('halted');
    expect(runsAfterStopAll.find((r) => r.id === runKilled.run.id)?.status).toBe('halted'); // still halted, untouched
  });

  it('POST /api/dispatch/:id/kill on an unknown id is a rejected decision, never a 404/500', async () => {
    const config = await server.start();
    const res = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/nonexistent/kill`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; reason?: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('unknown-id');
  });

  it('POST /api/dispatch/:id/status accepts event "killed" and requires Bearer auth like the other events', async () => {
    const config = await server.start();
    const unauthed = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/some-id/status`, {
      method: 'POST',
      body: JSON.stringify({ event: 'killed' }),
    });
    expect(unauthed.status).toBe(401);

    const authed = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/some-id/status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'killed', killOutcome: 'not-found' }),
    });
    expect(authed.status).toBe(200);
  });
});

describe('worker session kill — observed-pid routes', () => {
  let server: InstanceType<typeof PixelAgentsServer>;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-pidkill-test-'));
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

  it('POST /api/agents/kill validates machine+pid, queues a stop instruction, and GET /api/agents/kill/:id round-trips the reported outcome', async () => {
    const config = await server.start();
    const machine = uniqueMachine('MACBOOK');

    const missing = await fetch(`http://127.0.0.1:${config.port}/api/agents/kill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ machine }), // no pid
    });
    expect(((await missing.json()) as { ok: boolean }).ok).toBe(false);

    const res = await fetch(`http://127.0.0.1:${config.port}/api/agents/kill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ machine, pid: 4242 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; id?: string };
    expect(body.ok).toBe(true);
    if (!body.id) throw new Error('unreachable');

    const pending = await poll(config.port, config.token, machine);
    expect(pending.stop).toEqual([{ kind: 'pid', id: body.id, pid: 4242 }]);

    const beforeReport = await fetch(`http://127.0.0.1:${config.port}/api/agents/kill/${body.id}`);
    expect((await beforeReport.json()) as { status: string }).toMatchObject({ status: 'pending' });

    // Runner-facing report (Bearer-authed) — requires auth, unlike the two above.
    const unauthedReport = await fetch(
      `http://127.0.0.1:${config.port}/api/pid-kills/${body.id}/status`,
      { method: 'POST', body: JSON.stringify({ event: 'killed' }) },
    );
    expect(unauthedReport.status).toBe(401);

    const authedReport = await fetch(
      `http://127.0.0.1:${config.port}/api/pid-kills/${body.id}/status`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'killed' }),
      },
    );
    expect(authedReport.status).toBe(200);

    const afterReport = await fetch(`http://127.0.0.1:${config.port}/api/agents/kill/${body.id}`);
    expect((await afterReport.json()) as { status: string }).toMatchObject({ status: 'killed' });
  });

  it('GET /api/agents/kill/:id on an unknown id is honestly 404, never a fabricated status', async () => {
    const config = await server.start();
    const res = await fetch(`http://127.0.0.1:${config.port}/api/agents/kill/ghost`);
    expect(res.status).toBe(404);
  });

  it('a denial (e.g. not-a-claude-process) round-trips its reason to the webview poll', async () => {
    const config = await server.start();
    const machine = uniqueMachine('MACBOOK');
    const res = await fetch(`http://127.0.0.1:${config.port}/api/agents/kill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ machine, pid: 9999 }),
    });
    const body = (await res.json()) as { id: string };

    await fetch(`http://127.0.0.1:${config.port}/api/pid-kills/${body.id}/status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'denied', reason: 'not-a-claude-process' }),
    });

    const afterReport = await fetch(`http://127.0.0.1:${config.port}/api/agents/kill/${body.id}`);
    expect((await afterReport.json()) as { status: string; reason?: string }).toMatchObject({
      status: 'denied',
      reason: 'not-a-claude-process',
    });
  });
});
