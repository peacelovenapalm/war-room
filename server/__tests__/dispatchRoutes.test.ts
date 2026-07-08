/**
 * HTTP + WebSocket wiring tests for the dispatch queue (v1 mechanic #6b).
 *
 * dispatchStore.ts's own transitions/caps/TTL/persistence are covered by
 * dispatchStore.test.ts; this file exercises the routes and WS plane wired
 * in httpServer.ts + clientMessageHandler.ts on top of it: auth, the
 * always-2xx decision plane, and the dispatchUpdate broadcast/replay.
 *
 * Every test uses a unique machine label (dispatchStore is a process-wide
 * singleton) so tests never see each other's queue entries.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Isolated temp HOME, same rationale as server.test.ts (dispatchStore persists
// under ~/.pixel-agents/ by default).
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

async function pollDispatch(
  port: number,
  token: string,
  machine: string,
  body: Record<string, unknown> = { providers: ['claude'], roots: ['/tmp'], focus: false },
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/dispatch/poll`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Machine': machine,
    },
    body: JSON.stringify(body),
  });
}

describe('dispatch HTTP routes', () => {
  let server: InstanceType<typeof PixelAgentsServer>;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-dispatch-test-'));
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

  it('poll requires Bearer auth', async () => {
    const config = await server.start();
    const res = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/poll`, {
      method: 'POST',
      body: '{}',
    });
    expect(res.status).toBe(401);
  });

  it('poll requires a valid X-Machine header', async () => {
    const config = await server.start();
    const res = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/poll`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
  });

  it('poll advertises the machine and returns its pending requests', async () => {
    const config = await server.start();
    const machine = uniqueMachine('MACBOOK');
    const res = await pollDispatch(config.port, config.token, machine);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pending: unknown[] };
    expect(body.pending).toEqual([]);

    const machinesRes = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/machines`);
    const machines = (await machinesRes.json()) as Array<{ machine: string }>;
    expect(machines.some((m) => m.machine === machine)).toBe(true);
  });

  it('GET /api/dispatch/machines is unauthenticated (tailnet-only server, like /api/briefing)', async () => {
    const config = await server.start();
    const res = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/machines`);
    expect(res.status).toBe(200);
  });

  it('a machine absent from recent polls is honestly absent from the machine list', async () => {
    const config = await server.start();
    const machinesRes = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/machines`);
    const machines = (await machinesRes.json()) as Array<{ machine: string }>;
    expect(machines.some((m) => m.machine === uniqueMachine('GHOST'))).toBe(false);
  });

  it('decision endpoint requires Bearer auth', async () => {
    const config = await server.start();
    const res = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/some-id/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'deny' }),
    });
    expect(res.status).toBe(401);
  });

  it('decision on an unknown id is 2xx, never 404', async () => {
    const config = await server.start();
    const res = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/nonexistent/decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'deny', reason: 'path-not-allowlisted' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('decision endpoint rejects a malformed body with 400', async () => {
    const config = await server.start();
    const res = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/some-id/decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'maybe' }),
    });
    expect(res.status).toBe(400);
  });

  it('status endpoint requires Bearer auth', async () => {
    const config = await server.start();
    const res = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/some-id/status`, {
      method: 'POST',
      body: JSON.stringify({ event: 'exited', exitCode: 0 }),
    });
    expect(res.status).toBe(401);
  });

  it('status on an unknown id is 2xx, never 404', async () => {
    const config = await server.start();
    const res = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/nonexistent/status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'exited', exitCode: 1 }),
    });
    expect(res.status).toBe(200);
  });

  it('an optional model/effort on dispatchRequest reaches the runner poll item', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machine = uniqueMachine('MACBOOK');
    const ws = new WebSocket(`ws://127.0.0.1:${config.port}/ws`);
    await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
    ws.send(
      JSON.stringify({
        type: 'dispatchRequest',
        action: 'dispatch',
        machine,
        provider: 'claude',
        cwd: '/tmp',
        prompt: 'list files',
        model: 'fable',
        effort: 'high',
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    const pollRes = await pollDispatch(config.port, config.token, machine);
    const pollBody = (await pollRes.json()) as {
      pending: Array<{ model?: string; effort?: string }>;
    };
    expect(pollBody.pending[0].model).toBe('fable');
    expect(pollBody.pending[0].effort).toBe('high');
    ws.close();
  });

  it('GET /api/dispatch/recent is unauthenticated and reflects a reported resultTail', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machine = uniqueMachine('MACBOOK');

    const ws = new WebSocket(`ws://127.0.0.1:${config.port}/ws`);
    await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
    ws.send(
      JSON.stringify({
        type: 'dispatchRequest',
        action: 'dispatch',
        machine,
        provider: 'claude',
        cwd: '/tmp',
        prompt: 'list files',
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    const pollRes = await pollDispatch(config.port, config.token, machine);
    const pollBody = (await pollRes.json()) as { pending: Array<{ id: string }> };
    const id = pollBody.pending[0].id;

    await fetch(`http://127.0.0.1:${config.port}/api/dispatch/${id}/decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'accept', pid: 4242 }),
    });
    await fetch(`http://127.0.0.1:${config.port}/api/dispatch/${id}/status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'exited', exitCode: 0, resultTail: 'CODEX DISPATCH OK\n' }),
    });

    const recentRes = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/recent`);
    expect(recentRes.status).toBe(200);
    const recent = (await recentRes.json()) as Array<{ id: string; resultTail?: string }>;
    expect(recent.find((r) => r.id === id)?.resultTail).toBe('CODEX DISPATCH OK\n');
    ws.close();
  });

  it('a full poll -> decide -> status round trip clears the machine pending queue', async () => {
    // Standalone (embedded: false) — WS is unauthenticated, matching the
    // production deployment that actually exercises the dispatch runner.
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machine = uniqueMachine('MINI');

    // Seed a request via the WS client-message path (webview -> dispatchRequest).
    const ws = new WebSocket(`ws://127.0.0.1:${config.port}/ws`);
    await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
    ws.send(
      JSON.stringify({
        type: 'dispatchRequest',
        action: 'dispatch',
        machine,
        provider: 'claude',
        cwd: '/tmp',
        prompt: 'list files',
      }),
    );
    // Give the message a tick to be handled.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const pollRes = await pollDispatch(config.port, config.token, machine);
    const pollBody = (await pollRes.json()) as {
      pending: Array<{ id: string; prompt?: string; model?: string; effort?: string }>;
    };
    expect(pollBody.pending).toHaveLength(1);
    expect(pollBody.pending[0].prompt).toBe('list files');
    const id = pollBody.pending[0].id;

    const decisionRes = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/${id}/decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'accept', pid: 4242 }),
    });
    expect(decisionRes.status).toBe(200);

    const secondPoll = await pollDispatch(config.port, config.token, machine);
    const secondBody = (await secondPoll.json()) as { pending: unknown[] };
    expect(secondBody.pending).toHaveLength(0); // answered -- no longer ringing

    const statusRes = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/${id}/status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'exited', exitCode: 0 }),
    });
    expect(statusRes.status).toBe(200);
    ws.close();
  });
});

describe('dispatch WebSocket broadcast + replay', () => {
  let server: InstanceType<typeof PixelAgentsServer>;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-dispatch-ws-test-'));
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

  it('broadcasts a dispatchUpdate to a connected client when a dispatchRequest is enqueued', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machine = uniqueMachine('MACBOOK');
    const ws = new WebSocket(`ws://127.0.0.1:${config.port}/ws`);
    await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

    const messages: Array<Record<string, unknown>> = [];
    ws.addEventListener('message', (event) => {
      messages.push(JSON.parse(event.data as string));
    });

    ws.send(
      JSON.stringify({
        type: 'dispatchRequest',
        action: 'dispatch',
        machine,
        provider: 'codex',
        cwd: '/tmp',
        prompt: 'x'.repeat(200),
      }),
    );

    await vi.waitFor(() => {
      expect(messages.some((m) => m.type === 'dispatchUpdate' && m.machine === machine)).toBe(true);
    });
    const update = messages.find((m) => m.type === 'dispatchUpdate' && m.machine === machine)!;
    expect(update.status).toBe('ringing');
    expect((update.promptPreview as string).length).toBe(120);
    expect('prompt' in update).toBe(false); // full prompt never broadcast
    ws.close();
  });

  it('replays a still-ringing entry to a freshly connected client', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machine = uniqueMachine('MINI');

    const firstClient = new WebSocket(`ws://127.0.0.1:${config.port}/ws`);
    await new Promise((resolve) => firstClient.addEventListener('open', resolve, { once: true }));
    firstClient.send(
      JSON.stringify({
        type: 'dispatchRequest',
        action: 'focus',
        machine,
        sessionId: 'sess-replay-test',
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    firstClient.close();

    const secondClient = new WebSocket(`ws://127.0.0.1:${config.port}/ws`);
    const messages: Array<Record<string, unknown>> = [];
    secondClient.addEventListener('message', (event) => {
      messages.push(JSON.parse(event.data as string));
    });
    await new Promise((resolve) => secondClient.addEventListener('open', resolve, { once: true }));

    await vi.waitFor(() => {
      expect(messages.some((m) => m.type === 'dispatchUpdate' && m.machine === machine)).toBe(true);
    });
    secondClient.close();
  });
});
