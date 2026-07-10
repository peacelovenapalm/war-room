/**
 * WS wiring tests for the live output tail (KICKOFF-v2.0 Phase 2 slice 2.3
 * — subscription-gated fan-out). outputRingStore.ts's own ring semantics
 * are covered by outputRingStore.test.ts; this file exercises what
 * httpServer.ts + clientMessageHandler.ts wire on top of it: tailSubscribe
 * registration + replay-to-that-socket-only, tailUnsubscribe/socket-close
 * unregistration, chunk delivery ONLY to subscribed sockets, the
 * backpressure fire-and-forget guarantee, and ring eviction when a dispatch
 * reaches a terminal status.
 *
 * Every test uses unique (source, id) keys — outputRingStore is a
 * process-wide singleton shared with the in-process server.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

// Isolated temp HOME, same rationale as dispatchRoutes.test.ts (the server
// persists dispatch state under ~/.pixel-agents/ by default).
let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

const { PixelAgentsServer } = await import('../src/server.js');
const { AgentStateStore } = await import('../src/agentStateStore.js');
const { handleClientMessage } = await import('../src/clientMessageHandler.js');
const { OutputRingStore, outputRingStore, outputStreamKey } =
  await import('../src/outputRingStore.js');

function uniqueId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function uniqueMachine(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`.toUpperCase();
}

interface TailClient {
  ws: WebSocket;
  /** Received outputChunk messages, in arrival order. */
  chunks: Array<{ source: string; id: string; seq: number; chunk: string; truncated: boolean }>;
  close: () => void;
}

async function connectClient(port: number): Promise<TailClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const chunks: TailClient['chunks'] = [];
  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (msg.type === 'outputChunk') {
        chunks.push(msg as unknown as TailClient['chunks'][number]);
      }
    } catch {
      /* ignore non-JSON */
    }
  });
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
  return { ws, chunks, close: () => ws.close() };
}

function tailSubscribe(client: TailClient, source: string, id: string): void {
  client.ws.send(JSON.stringify({ type: 'tailSubscribe', source, id }));
}

function tailUnsubscribe(client: TailClient, source: string, id: string): void {
  client.ws.send(JSON.stringify({ type: 'tailUnsubscribe', source, id }));
}

const settle = (ms = 75) => new Promise((resolve) => setTimeout(resolve, ms));

describe('tail subscription WS fan-out', () => {
  let server: InstanceType<typeof PixelAgentsServer>;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-tail-test-'));
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

  it('delivers live chunks ONLY to sockets subscribed to that (source, id)', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const id = uniqueId('run');
    const otherId = uniqueId('other');

    const subscribed = await connectClient(config.port);
    const otherKey = await connectClient(config.port);
    const notSubscribed = await connectClient(config.port);
    tailSubscribe(subscribed, 'dispatch', id);
    tailSubscribe(otherKey, 'dispatch', otherId);
    await settle();

    outputRingStore.append('dispatch', id, 'stdout', 'hello');
    outputRingStore.append('dispatch', id, 'stderr', 'oops');
    await settle();

    expect(subscribed.chunks.map((c) => c.chunk)).toEqual(['hello', 'oops']);
    expect(subscribed.chunks.every((c) => !c.truncated)).toBe(true);
    expect(otherKey.chunks).toEqual([]);
    expect(notSubscribed.chunks).toEqual([]);

    subscribed.close();
    otherKey.close();
    notSubscribed.close();
  });

  it('replays the ring buffer in order to the subscribing socket only', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const id = uniqueId('run');

    outputRingStore.append('agent', id, 'transcript', 'line-0');
    outputRingStore.append('agent', id, 'transcript', 'line-1');
    outputRingStore.append('agent', id, 'transcript', 'line-2');

    const late = await connectClient(config.port);
    const bystander = await connectClient(config.port);
    await settle();
    expect(late.chunks).toEqual([]); // nothing before subscribing

    tailSubscribe(late, 'agent', id);
    await settle();

    expect(late.chunks.map((c) => c.chunk)).toEqual(['line-0', 'line-1', 'line-2']);
    expect(late.chunks.map((c) => c.seq)).toEqual([0, 1, 2]);
    expect(bystander.chunks).toEqual([]);

    late.close();
    bystander.close();
  });

  it('tailUnsubscribe stops live delivery for that key only', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const id = uniqueId('run');

    const client = await connectClient(config.port);
    tailSubscribe(client, 'dispatch', id);
    await settle();

    outputRingStore.append('dispatch', id, 'stdout', 'before');
    await settle();
    tailUnsubscribe(client, 'dispatch', id);
    await settle();
    outputRingStore.append('dispatch', id, 'stdout', 'after');
    await settle();

    expect(client.chunks.map((c) => c.chunk)).toEqual(['before']);
    client.close();
  });

  it('a disconnected subscriber never blocks the append path or other subscribers', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const id = uniqueId('run');

    const doomed = await connectClient(config.port);
    const healthy = await connectClient(config.port);
    tailSubscribe(doomed, 'dispatch', id);
    tailSubscribe(healthy, 'dispatch', id);
    await settle();

    doomed.close();
    await settle();

    // The producing path is synchronous and must complete regardless.
    const appended = outputRingStore.append('dispatch', id, 'stdout', 'still-flowing');
    expect(appended.seq).toBe(0);
    await settle();

    expect(healthy.chunks.map((c) => c.chunk)).toEqual(['still-flowing']);
    expect(doomed.chunks).toEqual([]);
    healthy.close();
  });

  it('append completes even when a subscribed socket send throws (backpressure hard requirement)', () => {
    // The exact wiring contract registerWebSocketRoute installs per socket:
    // a gate on the subscription Set, then a fire-and-forget send. The send
    // here throws synchronously on every call — the worst-case subscriber.
    const store = new OutputRingStore();
    const id = uniqueId('run');
    const tailSubscriptions = new Set([outputStreamKey('dispatch', id)]);
    const deadSocket = {
      readyState: 1,
      send: () => {
        throw new Error('EPIPE: broken subscriber');
      },
    };
    const delivered: string[] = [];
    store.onChunk((chunk) => {
      if (!tailSubscriptions.has(outputStreamKey(chunk.source, chunk.id))) return;
      if (deadSocket.readyState === 1) deadSocket.send();
    });
    store.onChunk((chunk) => {
      if (!tailSubscriptions.has(outputStreamKey(chunk.source, chunk.id))) return;
      delivered.push(chunk.chunk);
    });

    expect(() => store.append('dispatch', id, 'stdout', 'chunk-0')).not.toThrow();
    expect(store.append('dispatch', id, 'stdout', 'chunk-1').seq).toBe(1);
    // The ring retained both writes and the healthy subscriber saw both —
    // the throwing socket cost nothing but its own delivery.
    expect(store.replay('dispatch', id).map((c) => c.chunk)).toEqual(['chunk-0', 'chunk-1']);
    expect(delivered).toEqual(['chunk-0', 'chunk-1']);
  });

  it('evicts the ring when a dispatch reaches a terminal status (replay after exit is empty)', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machine = uniqueMachine('MACBOOK');

    // Real dispatch lifecycle: enqueue via WS -> runner poll -> accept.
    const requester = await connectClient(config.port);
    requester.ws.send(
      JSON.stringify({
        type: 'dispatchRequest',
        action: 'dispatch',
        machine,
        provider: 'claude',
        cwd: '/tmp',
        prompt: 'stream me',
      }),
    );
    await settle();
    const pollRes = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/poll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
        'X-Machine': machine,
      },
      body: JSON.stringify({ providers: ['claude'], roots: ['/tmp'], focus: false }),
    });
    const pollBody = (await pollRes.json()) as { pending: Array<{ id: string }> };
    const dispatchId = pollBody.pending[0].id;
    await fetch(`http://127.0.0.1:${config.port}/api/dispatch/${dispatchId}/decision`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'accept', pid: 4242 }),
    });

    outputRingStore.append('dispatch', dispatchId, 'stdout', 'run output');

    // Positive control: while the run is live, a fresh subscriber gets replay.
    const during = await connectClient(config.port);
    tailSubscribe(during, 'dispatch', dispatchId);
    await settle();
    expect(during.chunks.map((c) => c.chunk)).toEqual(['run output']);

    // Terminal status -> lifecycle eviction (chunks are ephemeral telemetry).
    await fetch(`http://127.0.0.1:${config.port}/api/dispatch/${dispatchId}/status`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'exited', exitCode: 0 }),
    });
    await settle();
    expect(outputRingStore.replay('dispatch', dispatchId)).toEqual([]);

    // A post-terminal subscriber honestly gets nothing.
    const after = await connectClient(config.port);
    tailSubscribe(after, 'dispatch', dispatchId);
    await settle();
    expect(after.chunks).toEqual([]);

    requester.close();
    during.close();
    after.close();
  });
});

describe('tail subscription client-message handling (unit)', () => {
  it('ignores a tailSubscribe with an invalid source or missing id', () => {
    const tailSubscriptions = new Set<string>();
    const sent: Array<Record<string, unknown>> = [];
    const ctx = { store: new AgentStateStore(), cache: null, tailSubscriptions };
    handleClientMessage(
      { type: 'tailSubscribe', source: 'evil', id: 'x' },
      (m) => sent.push(m),
      ctx,
    );
    handleClientMessage(
      { type: 'tailSubscribe', source: 'agent', id: '' },
      (m) => sent.push(m),
      ctx,
    );
    handleClientMessage({ type: 'tailSubscribe', source: 'agent' }, (m) => sent.push(m), ctx);
    expect(tailSubscriptions.size).toBe(0);
    expect(sent).toEqual([]);
  });

  it('is a safe no-op when the connection has no subscription registry', () => {
    const sent: Array<Record<string, unknown>> = [];
    expect(() =>
      handleClientMessage(
        { type: 'tailSubscribe', source: 'agent', id: uniqueId('run') },
        (m) => sent.push(m),
        { store: new AgentStateStore(), cache: null },
      ),
    ).not.toThrow();
    expect(sent).toEqual([]);
  });

  it('tailSubscribe registers the key and replays buffered chunks through send', () => {
    const id = uniqueId('run');
    outputRingStore.append('agent', id, 'transcript', 'buffered-line');
    const tailSubscriptions = new Set<string>();
    const sent: Array<Record<string, unknown>> = [];
    handleClientMessage({ type: 'tailSubscribe', source: 'agent', id }, (m) => sent.push(m), {
      store: new AgentStateStore(),
      cache: null,
      tailSubscriptions,
    });
    expect(tailSubscriptions.has(outputStreamKey('agent', id))).toBe(true);
    expect(sent).toEqual([
      expect.objectContaining({ type: 'outputChunk', source: 'agent', id, chunk: 'buffered-line' }),
    ]);
    outputRingStore.evict('agent', id);
  });
});
