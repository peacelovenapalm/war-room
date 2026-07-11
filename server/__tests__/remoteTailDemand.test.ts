/**
 * Remote tail-instruction plane (T1 remote live-tail, S2 —
 * .planning/v2/REMOTE-TAILER-DESIGN.md "Steering"). Two planes:
 *
 *   1. remoteTailDemand.ts unit coverage — refcount aggregation across
 *      multiple "sockets" (each a direct noteTailSubscribe call, exactly
 *      what the WS wiring in clientMessageHandler.ts does per subscriber),
 *      the fromStart-once contract, no-transcript-path honest absence,
 *      the local-agent no-op, agentRemoved cleanup, and the queue bound.
 *   2. POST /api/tailer/poll route coverage — auth, the at-most-once drain,
 *      and reconcileAdvertisement's two re-issue directions.
 *
 * remoteTailDemand/remoteTranscriptPaths are process-wide singletons —
 * every test uses a unique numeric agent id / machine / sessionId.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: { activeTerminal: undefined, terminals: [] },
}));

let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

const { AgentStateStore } = await import('../src/agentStateStore.js');
const { PixelAgentsServer } = await import('../src/server.js');
const { handleClientMessage } = await import('../src/clientMessageHandler.js');
const remoteTailDemand = await import('../src/remoteTailDemand.js');
const { retainRemoteTranscriptPath } = await import('../src/remoteTranscriptPaths.js');

import type { AgentState as AgentStateType } from '../src/types.js';

function uniqueMachine(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`.toUpperCase();
}

let nextTestAgentId = 930_000;
function newAgentId(): number {
  return nextTestAgentId++;
}

function makeAgent(id: number, sessionId: string, machine: string | undefined): AgentStateType {
  return {
    id,
    sessionId,
    terminalRef: undefined,
    isExternal: true,
    projectDir: '/tmp/proj',
    jsonlFile: '',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    hookDelivered: false,
    lastDataAt: Date.now(),
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    inputTokens: 0,
    outputTokens: 0,
    machine,
  };
}

describe('remoteTailDemand (unit)', () => {
  it('refcount aggregation: two subscribers -> ONE tail-on; one unsubscribes -> nothing; last -> tail-off', () => {
    const store = new AgentStateStore();
    const own = uniqueMachine('LOCALHOST');
    const machine = uniqueMachine('REMOTE');
    const sessionId = crypto.randomUUID();
    const agentId = newAgentId();
    store.set(agentId, makeAgent(agentId, sessionId, machine));
    retainRemoteTranscriptPath(machine, sessionId, '/remote/path/session.jsonl');

    // Socket A subscribes.
    remoteTailDemand.noteTailSubscribe(store, agentId, own);
    // Socket B subscribes to the SAME agent.
    remoteTailDemand.noteTailSubscribe(store, agentId, own);

    const drained1 = remoteTailDemand.drainTailQueueFor(machine);
    expect(drained1).toEqual([
      {
        kind: 'tail-on',
        sessionId,
        transcriptPath: '/remote/path/session.jsonl',
        fromStart: true,
      },
    ]);

    // Socket A unsubscribes — B still holds demand, nothing queued.
    remoteTailDemand.noteTailUnsubscribe(agentId);
    expect(remoteTailDemand.drainTailQueueFor(machine)).toEqual([]);

    // Socket B (the last one) unsubscribes — tail-off queued.
    remoteTailDemand.noteTailUnsubscribe(agentId);
    expect(remoteTailDemand.drainTailQueueFor(machine)).toEqual([
      { kind: 'tail-off', sessionId, transcriptPath: '/remote/path/session.jsonl' },
    ]);
  });

  it('fromStart is true only on the first-ever tail-on for an agent; a re-subscribe after tail-off is false', () => {
    const store = new AgentStateStore();
    const own = uniqueMachine('LOCALHOST');
    const machine = uniqueMachine('REMOTE');
    const sessionId = crypto.randomUUID();
    const agentId = newAgentId();
    store.set(agentId, makeAgent(agentId, sessionId, machine));
    retainRemoteTranscriptPath(machine, sessionId, '/remote/path/a.jsonl');

    remoteTailDemand.noteTailSubscribe(store, agentId, own);
    expect(remoteTailDemand.drainTailQueueFor(machine)[0]).toMatchObject({
      kind: 'tail-on',
      fromStart: true,
    });

    remoteTailDemand.noteTailUnsubscribe(agentId); // refcount -> 0, tail-off queued
    remoteTailDemand.drainTailQueueFor(machine); // drain the tail-off

    remoteTailDemand.noteTailSubscribe(store, agentId, own); // re-subscribe: SAME agent
    expect(remoteTailDemand.drainTailQueueFor(machine)[0]).toMatchObject({
      kind: 'tail-on',
      fromStart: false,
    });
  });

  it('a demand with no retained transcript path enqueues nothing (honestly absent)', () => {
    const store = new AgentStateStore();
    const own = uniqueMachine('LOCALHOST');
    const machine = uniqueMachine('REMOTE');
    const sessionId = crypto.randomUUID();
    const agentId = newAgentId();
    store.set(agentId, makeAgent(agentId, sessionId, machine));
    // Deliberately no retainRemoteTranscriptPath call.

    remoteTailDemand.noteTailSubscribe(store, agentId, own);
    expect(remoteTailDemand.drainTailQueueFor(machine)).toEqual([]);
  });

  it('a local-machine agent (machine === own label, or undefined) is a total no-op', () => {
    const store = new AgentStateStore();
    const own = uniqueMachine('LOCALHOST');
    const localAgentId = newAgentId();
    const undefinedMachineAgentId = newAgentId();
    const sessionId1 = crypto.randomUUID();
    const sessionId2 = crypto.randomUUID();
    store.set(localAgentId, makeAgent(localAgentId, sessionId1, own));
    store.set(undefinedMachineAgentId, makeAgent(undefinedMachineAgentId, sessionId2, undefined));
    retainRemoteTranscriptPath(own, sessionId1, '/should/never/be/used.jsonl');

    remoteTailDemand.noteTailSubscribe(store, localAgentId, own);
    remoteTailDemand.noteTailSubscribe(store, undefinedMachineAgentId, own);

    expect(remoteTailDemand.drainTailQueueFor(own)).toEqual([]);
  });

  it('onAgentRemoved issues a final tail-off for live demand and clears the record (a later re-subscribe is fromStart:true again)', () => {
    const store = new AgentStateStore();
    const own = uniqueMachine('LOCALHOST');
    const machine = uniqueMachine('REMOTE');
    const sessionId = crypto.randomUUID();
    const agentId = newAgentId();
    store.set(agentId, makeAgent(agentId, sessionId, machine));
    retainRemoteTranscriptPath(machine, sessionId, '/remote/path/b.jsonl');

    remoteTailDemand.noteTailSubscribe(store, agentId, own);
    remoteTailDemand.drainTailQueueFor(machine); // drain the tail-on

    remoteTailDemand.onAgentRemoved(agentId);
    expect(remoteTailDemand.drainTailQueueFor(machine)).toEqual([
      { kind: 'tail-off', sessionId, transcriptPath: '/remote/path/b.jsonl' },
    ]);

    // A further unsubscribe for the same (now-cleared) agentId is a no-op.
    expect(() => remoteTailDemand.noteTailUnsubscribe(agentId)).not.toThrow();
    expect(remoteTailDemand.drainTailQueueFor(machine)).toEqual([]);

    // A brand-new agent reusing the same numeric id (new session) starts fresh.
    const newSessionId = crypto.randomUUID();
    store.set(agentId, makeAgent(agentId, newSessionId, machine));
    retainRemoteTranscriptPath(machine, newSessionId, '/remote/path/c.jsonl');
    remoteTailDemand.noteTailSubscribe(store, agentId, own);
    expect(remoteTailDemand.drainTailQueueFor(machine)[0]).toMatchObject({
      sessionId: newSessionId,
      fromStart: true,
    });
    remoteTailDemand.onAgentRemoved(agentId);
    remoteTailDemand.drainTailQueueFor(machine);
  });

  it('onAgentRemoved with no live demand (or no record at all) is a safe no-op', () => {
    const machine = uniqueMachine('REMOTE');
    expect(() => remoteTailDemand.onAgentRemoved(newAgentId())).not.toThrow();
    expect(remoteTailDemand.drainTailQueueFor(machine)).toEqual([]);
  });

  it("a machine's queue is bounded (defensive oldest-first eviction)", () => {
    const store = new AgentStateStore();
    const own = uniqueMachine('LOCALHOST');
    const machine = uniqueMachine('REMOTE');
    const agentIds: number[] = [];

    // Push well past MAX_TAIL_QUEUE_PER_MACHINE (200) worth of tail-on/off
    // pairs via repeated subscribe/unsubscribe cycles on distinct agents,
    // each with its own resolvable path.
    for (let i = 0; i < 250; i++) {
      const agentId = newAgentId();
      const sessionId = crypto.randomUUID();
      agentIds.push(agentId);
      store.set(agentId, makeAgent(agentId, sessionId, machine));
      retainRemoteTranscriptPath(machine, sessionId, `/remote/path/${i}.jsonl`);
      remoteTailDemand.noteTailSubscribe(store, agentId, own);
    }

    const drained = remoteTailDemand.drainTailQueueFor(machine);
    expect(drained.length).toBeLessThanOrEqual(200);
    expect(drained.length).toBeGreaterThan(0);

    for (const id of agentIds) remoteTailDemand.onAgentRemoved(id);
    remoteTailDemand.drainTailQueueFor(machine);
  });
});

describe('tailSubscribe/tailUnsubscribe WS wiring (clientMessageHandler.ts)', () => {
  it('two tailSubscribe calls for the same remote agent (two sockets) still enqueue ONE tail-on', () => {
    const store = new AgentStateStore();
    const own = uniqueMachine('LOCALHOST');
    const machine = uniqueMachine('REMOTE');
    const sessionId = crypto.randomUUID();
    const agentId = newAgentId();
    store.set(agentId, makeAgent(agentId, sessionId, machine));
    retainRemoteTranscriptPath(machine, sessionId, '/remote/path/wired.jsonl');

    const socketA = new Set<string>();
    const socketB = new Set<string>();
    const sentA: Array<Record<string, unknown>> = [];
    const sentB: Array<Record<string, unknown>> = [];
    const ctx = { store, cache: null, machineLabel: own };

    handleClientMessage(
      { type: 'tailSubscribe', source: 'agent', id: String(agentId) },
      (m) => sentA.push(m),
      { ...ctx, tailSubscriptions: socketA },
    );
    handleClientMessage(
      { type: 'tailSubscribe', source: 'agent', id: String(agentId) },
      (m) => sentB.push(m),
      { ...ctx, tailSubscriptions: socketB },
    );

    expect(remoteTailDemand.drainTailQueueFor(machine)).toEqual([
      { kind: 'tail-on', sessionId, transcriptPath: '/remote/path/wired.jsonl', fromStart: true },
    ]);

    // A re-sent tailSubscribe from the SAME socket for the same key must
    // never double the refcount (the isNewSubscription guard).
    handleClientMessage(
      { type: 'tailSubscribe', source: 'agent', id: String(agentId) },
      (m) => sentA.push(m),
      { ...ctx, tailSubscriptions: socketA },
    );
    expect(remoteTailDemand.drainTailQueueFor(machine)).toEqual([]);

    // Explicit tailUnsubscribe from socket A: B still holds demand.
    handleClientMessage(
      { type: 'tailUnsubscribe', source: 'agent', id: String(agentId) },
      (m) => sentA.push(m),
      { ...ctx, tailSubscriptions: socketA },
    );
    expect(remoteTailDemand.drainTailQueueFor(machine)).toEqual([]);

    handleClientMessage(
      { type: 'tailUnsubscribe', source: 'agent', id: String(agentId) },
      (m) => sentB.push(m),
      { ...ctx, tailSubscriptions: socketB },
    );
    expect(remoteTailDemand.drainTailQueueFor(machine)).toEqual([
      { kind: 'tail-off', sessionId, transcriptPath: '/remote/path/wired.jsonl' },
    ]);
  });

  it('WS socket close releases remote tail demand exactly like an explicit tailUnsubscribe', async () => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-tail-wiring-test-'));
    fs.mkdirSync(path.join(tmpBase, '.pixel-agents'), { recursive: true });
    const store = new AgentStateStore();
    const ownMachine = uniqueMachine('LOCALHOST');
    const server = new PixelAgentsServer();
    try {
      const config = await server.start({ embedded: false, store, machineLabel: ownMachine });
      const machine = uniqueMachine('REMOTE');
      const sessionId = crypto.randomUUID();
      const agentId = newAgentId();
      store.set(agentId, makeAgent(agentId, sessionId, machine));
      retainRemoteTranscriptPath(machine, sessionId, '/remote/path/closed.jsonl');

      const ws = new WebSocket(`ws://127.0.0.1:${config.port}/ws`);
      await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
      ws.send(JSON.stringify({ type: 'tailSubscribe', source: 'agent', id: String(agentId) }));
      await new Promise((resolve) => setTimeout(resolve, 75));

      expect(remoteTailDemand.drainTailQueueFor(machine)).toEqual([
        {
          kind: 'tail-on',
          sessionId,
          transcriptPath: '/remote/path/closed.jsonl',
          fromStart: true,
        },
      ]);

      ws.close();
      await new Promise((resolve) => setTimeout(resolve, 75));

      // The socket never sent tailUnsubscribe — closing it must still
      // release the demand, so a tail-off is queued.
      expect(remoteTailDemand.drainTailQueueFor(machine)).toEqual([
        { kind: 'tail-off', sessionId, transcriptPath: '/remote/path/closed.jsonl' },
      ]);

      remoteTailDemand.onAgentRemoved(agentId);
      remoteTailDemand.drainTailQueueFor(machine);
    } finally {
      server.stop();
      try {
        fs.rmSync(tmpBase, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });
});

describe('POST /api/tailer/poll', () => {
  let store: InstanceType<typeof AgentStateStore>;
  let server: InstanceType<typeof PixelAgentsServer>;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-tailer-poll-test-'));
    fs.mkdirSync(path.join(tmpBase, '.pixel-agents'), { recursive: true });
    store = new AgentStateStore();
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

  function pollTailer(
    port: number,
    body: Record<string, unknown>,
    opts: { token?: string; machine?: string } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.token !== undefined) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.machine !== undefined) headers['X-Machine'] = opts.machine;
    return fetch(`http://127.0.0.1:${port}/api/tailer/poll`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  it('requires Bearer auth (401 without / with a wrong token)', async () => {
    const config = await server.start({ embedded: false, store });
    const machine = uniqueMachine('M');

    const noAuth = await pollTailer(config.port, {}, { machine });
    expect(noAuth.status).toBe(401);
    const badAuth = await pollTailer(config.port, {}, { machine, token: 'wrong' });
    expect(badAuth.status).toBe(401);
  });

  it('missing/invalid X-Machine is a 400 (mirrors /api/dispatch/poll, not the tolerant poll-state fallback)', async () => {
    const config = await server.start({ embedded: false, store });

    const missing = await pollTailer(config.port, {}, { token: config.token });
    expect(missing.status).toBe(400);
    const invalid = await pollTailer(
      config.port,
      {},
      { token: config.token, machine: 'not a valid label!!' },
    );
    expect(invalid.status).toBe(400);
  });

  it('at-most-once drain: queued instructions come back exactly once', async () => {
    const ownMachine = uniqueMachine('LOCALHOST');
    const config = await server.start({ embedded: false, store, machineLabel: ownMachine });
    const machine = uniqueMachine('REMOTE');
    const agentId = newAgentId();
    const sessionId = crypto.randomUUID();
    store.set(agentId, makeAgent(agentId, sessionId, machine));
    retainRemoteTranscriptPath(machine, sessionId, '/remote/path/poll.jsonl');
    remoteTailDemand.noteTailSubscribe(store, agentId, ownMachine);

    const first = await pollTailer(config.port, { active: [] }, { token: config.token, machine });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { tail: Array<Record<string, unknown>> };
    expect(firstBody.tail).toEqual([
      { kind: 'tail-on', sessionId, transcriptPath: '/remote/path/poll.jsonl', fromStart: true },
    ]);

    // Second poll: the tailer now advertises the session it just started,
    // so there is nothing new to drain and nothing to reconcile.
    const second = await pollTailer(
      config.port,
      { active: [sessionId] },
      { token: config.token, machine },
    );
    const secondBody = (await second.json()) as { tail: unknown[] };
    expect(secondBody.tail).toEqual([]);

    remoteTailDemand.onAgentRemoved(agentId);
    remoteTailDemand.drainTailQueueFor(machine);
  });

  it('reconciliation: a demanded session missing from active gets a re-issued tail-on (tailer-restart recovery)', async () => {
    const ownMachine = uniqueMachine('LOCALHOST');
    const config = await server.start({ embedded: false, store, machineLabel: ownMachine });
    const machine = uniqueMachine('REMOTE');
    const agentId = newAgentId();
    const sessionId = crypto.randomUUID();
    store.set(agentId, makeAgent(agentId, sessionId, machine));
    retainRemoteTranscriptPath(machine, sessionId, '/remote/path/restart.jsonl');
    remoteTailDemand.noteTailSubscribe(store, agentId, ownMachine);

    // Drain the original tail-on OUTSIDE the poll route (simulating a
    // tailer that received it, then crashed before ever advertising).
    expect(remoteTailDemand.drainTailQueueFor(machine)).toHaveLength(1);

    // Restarted tailer polls with an empty advertisement.
    const res = await pollTailer(config.port, { active: [] }, { token: config.token, machine });
    const body = (await res.json()) as { tail: Array<Record<string, unknown>> };
    expect(body.tail).toEqual([
      {
        kind: 'tail-on',
        sessionId,
        transcriptPath: '/remote/path/restart.jsonl',
        fromStart: false, // everIssued was already true before the restart
      },
    ]);

    remoteTailDemand.onAgentRemoved(agentId);
    remoteTailDemand.drainTailQueueFor(machine);
  });

  it('reconciliation: an active session with no live demand gets a tail-off', async () => {
    const config = await server.start({
      embedded: false,
      store,
      machineLabel: uniqueMachine('LOCALHOST'),
    });
    const machine = uniqueMachine('REMOTE');
    const orphanSessionId = crypto.randomUUID();
    retainRemoteTranscriptPath(machine, orphanSessionId, '/remote/path/orphan.jsonl');
    // No subscribe call at all — nobody demands this session.

    const res = await pollTailer(
      config.port,
      { active: [orphanSessionId] },
      { token: config.token, machine },
    );
    const body = (await res.json()) as { tail: Array<Record<string, unknown>> };
    expect(body.tail).toEqual([
      { kind: 'tail-off', sessionId: orphanSessionId, transcriptPath: '/remote/path/orphan.jsonl' },
    ]);
  });
});
