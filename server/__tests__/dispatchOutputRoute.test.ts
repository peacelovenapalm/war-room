/**
 * Route tests for POST /api/dispatch/:id/output (KICKOFF-v2.0 Phase 2 slice
 * 2.5 — the runner forwarder's server side). Auth, payload validation, the
 * liveness gate (no ring resurrection after terminal status), the append
 * into the output ring, and one full integration round trip: real HTTP POST
 * → ring → subscription-gated WS delivery.
 *
 * dispatchStore + outputRingStore are process-wide singletons — every test
 * uses a unique machine label / dispatch id, mirroring dispatchRoutes.test.ts.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Isolated temp HOME, same rationale as dispatchRoutes.test.ts (dispatchStore
// persists under ~/.pixel-agents/ by default).
let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

const { PixelAgentsServer } = await import('../src/server.js');
const { AgentStateStore } = await import('../src/agentStateStore.js');
const { dispatchStore } = await import('../src/dispatchStore.js');
const { outputRingStore } = await import('../src/outputRingStore.js');

function uniqueMachine(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`.toUpperCase();
}

/** Enqueue + runner-accept one dispatch, returning its id (status 'answered'). */
async function liveDispatch(port: number, token: string, machine: string): Promise<string> {
  const result = dispatchStore.enqueue({
    action: 'dispatch',
    machine,
    provider: 'claude',
    cwd: '/tmp',
    prompt: 'stream me',
  });
  if (!result.ok) throw new Error(`enqueue failed: ${JSON.stringify(result)}`);
  const id = result.record.id;
  const res = await fetch(`http://127.0.0.1:${port}/api/dispatch/${id}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ decision: 'accept', pid: 4242 }),
  });
  expect(res.status).toBe(200);
  return id;
}

function postOutput(
  port: number,
  id: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/dispatch/${id}/output`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/dispatch/:id/output', () => {
  let server: InstanceType<typeof PixelAgentsServer>;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-output-route-test-'));
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

  it('requires Bearer auth (401 without / with a wrong token)', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machine = uniqueMachine('M');
    const id = await liveDispatch(config.port, config.token, machine);

    const noAuth = await postOutput(config.port, id, { stream: 'stdout', chunk: 'x' });
    expect(noAuth.status).toBe(401);
    const badAuth = await postOutput(config.port, id, { stream: 'stdout', chunk: 'x' }, 'wrong');
    expect(badAuth.status).toBe(401);
    expect(outputRingStore.replay('dispatch', id)).toEqual([]);
  });

  it('rejects a malformed payload with 400 (bad stream, missing/empty chunk, bad seq)', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machine = uniqueMachine('M');
    const id = await liveDispatch(config.port, config.token, machine);

    for (const body of [
      { stream: 'transcript', chunk: 'x' }, // transcript is agent-plane only
      { stream: 'stdout' }, // missing chunk
      { stream: 'stdout', chunk: '' }, // empty chunk
      { stream: 'stdout', chunk: 'x', seq: 'zero' }, // non-numeric seq
    ]) {
      const res = await postOutput(config.port, id, body, config.token);
      expect(res.status).toBe(400);
    }
    expect(outputRingStore.replay('dispatch', id)).toEqual([]);
  });

  it('appends a valid chunk into the ring (2xx, ok:true)', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machine = uniqueMachine('M');
    const id = await liveDispatch(config.port, config.token, machine);

    const res1 = await postOutput(
      config.port,
      id,
      { stream: 'stdout', chunk: 'line 1\n', seq: 0 },
      config.token,
    );
    expect(res1.status).toBe(200);
    expect(await res1.json()).toEqual({ ok: true });
    const res2 = await postOutput(
      config.port,
      id,
      { stream: 'stderr', chunk: 'warn\n', seq: 0 },
      config.token,
    );
    expect(res2.status).toBe(200);

    const chunks = outputRingStore.replay('dispatch', id);
    expect(chunks.map((c) => ({ stream: c.stream, chunk: c.chunk, seq: c.seq }))).toEqual([
      { stream: 'stdout', chunk: 'line 1\n', seq: 0 },
      { stream: 'stderr', chunk: 'warn\n', seq: 0 },
    ]);
    outputRingStore.evict('dispatch', id);
  });

  it('refuses unknown ids and post-terminal stragglers as a 2xx decision — no ring resurrection', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machine = uniqueMachine('M');

    // Unknown id: decision, never a 404.
    const unknown = await postOutput(
      config.port,
      crypto.randomUUID(),
      { stream: 'stdout', chunk: 'x' },
      config.token,
    );
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ ok: false, reason: 'unknown-or-terminal' });

    // Live dispatch accumulates output, then reaches terminal status.
    const id = await liveDispatch(config.port, config.token, machine);
    await postOutput(config.port, id, { stream: 'stdout', chunk: 'while alive' }, config.token);
    expect(outputRingStore.replay('dispatch', id)).toHaveLength(1);

    const status = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
      body: JSON.stringify({ event: 'exited', exitCode: 0 }),
    });
    expect(status.status).toBe(200);

    // Terminal status evicted the ring (slice 2.3's lifecycle hook)…
    expect(outputRingStore.replay('dispatch', id)).toEqual([]);

    // …and a straggler POST cannot resurrect it.
    const straggler = await postOutput(
      config.port,
      id,
      { stream: 'stdout', chunk: 'too late' },
      config.token,
    );
    expect(straggler.status).toBe(200);
    expect(await straggler.json()).toEqual({ ok: false, reason: 'unknown-or-terminal' });
    expect(outputRingStore.replay('dispatch', id)).toEqual([]);
  });

  it('integration: real HTTP POST → ring → subscription-gated WS delivery', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machine = uniqueMachine('M');
    const id = await liveDispatch(config.port, config.token, machine);

    // Subscribe one WS client to this dispatch's tail; a bystander stays silent.
    const chunksFor = (ws: WebSocket): Array<Record<string, unknown>> => {
      const received: Array<Record<string, unknown>> = [];
      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (msg.type === 'outputChunk') received.push(msg);
        } catch {
          /* ignore */
        }
      });
      return received;
    };
    const subscriber = new WebSocket(`ws://127.0.0.1:${config.port}/ws`);
    const bystander = new WebSocket(`ws://127.0.0.1:${config.port}/ws`);
    const subscriberChunks = chunksFor(subscriber);
    const bystanderChunks = chunksFor(bystander);
    await Promise.all(
      [subscriber, bystander].map(
        (ws) => new Promise((resolve) => ws.addEventListener('open', resolve, { once: true })),
      ),
    );
    subscriber.send(JSON.stringify({ type: 'tailSubscribe', source: 'dispatch', id }));
    await new Promise((resolve) => setTimeout(resolve, 75));

    const res = await postOutput(
      config.port,
      id,
      { stream: 'stdout', chunk: 'round trip\n', seq: 0 },
      config.token,
    );
    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 75));

    expect(subscriberChunks).toEqual([
      expect.objectContaining({
        type: 'outputChunk',
        source: 'dispatch',
        id,
        stream: 'stdout',
        chunk: 'round trip\n',
        seq: 0,
        truncated: false,
      }),
    ]);
    expect(bystanderChunks).toEqual([]);

    subscriber.close();
    bystander.close();
    outputRingStore.evict('dispatch', id);
  });
});
