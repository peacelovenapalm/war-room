/**
 * Route tests for POST /api/agents/output (T1 remote live-tail plane, S1 —
 * .planning/v2/REMOTE-TAILER-DESIGN.md). Server-side ingest only: auth,
 * body-shape validation + caps, the (machine, sessionId) resolution rule
 * (2xx-deny on a miss, never 4xx), the rendered append into the SAME ring
 * shape the local tap uses, the liveness gate, real token-usage accounting,
 * and the remote transcript-path retention map registerHookRoute maintains
 * for S2.
 *
 * outputRingStore/shiftStats are process-wide singletons — every test uses
 * a unique numeric agent id / machine label and evicts what it appends.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// fileWatcher.ts (pulled in transitively via server.ts) does
// `import * as vscode from 'vscode'` at module load; stub it like the other
// route test files that boot a real PixelAgentsServer.
vi.mock('vscode', () => ({
  window: { activeTerminal: undefined, terminals: [] },
}));

// Isolated temp HOME (dispatchStore/server.json persist under ~/.pixel-agents/
// by default) — same rationale as dispatchOutputRoute.test.ts.
let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

const { AgentStateStore } = await import('../src/agentStateStore.js');
const { PixelAgentsServer } = await import('../src/server.js');
const { outputRingStore } = await import('../src/outputRingStore.js');
const { shiftStats } = await import('../src/shiftStats.js');
const { getRemoteTranscriptPath } = await import('../src/httpServer.js');

import type { AgentState as AgentStateType } from '../src/types.js';

function uniqueMachine(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`.toUpperCase();
}

let nextTestAgentId = 920_000;
function newAgentId(): number {
  return nextTestAgentId++;
}

function makeAgent(id: number, sessionId: string, machine: string): AgentStateType {
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

const assistantText = (text: string) =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });

const assistantUsage = (text: string, inputTokens: number, outputTokens: number) =>
  JSON.stringify({
    type: 'assistant',
    message: {
      content: [{ type: 'text', text }],
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    },
  });

function postOutput(
  port: number,
  body: Record<string, unknown>,
  opts: { token?: string; machine?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token !== undefined) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.machine !== undefined) headers['X-Machine'] = opts.machine;
  return fetch(`http://127.0.0.1:${port}/api/agents/output`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/agents/output', () => {
  let store: InstanceType<typeof AgentStateStore>;
  let server: InstanceType<typeof PixelAgentsServer>;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-agent-output-route-test-'));
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

  it('requires Bearer auth (401 without / with a wrong token)', async () => {
    const config = await server.start({ embedded: false, store });
    const machine = uniqueMachine('M');

    const noAuth = await postOutput(config.port, { sessionId: 's', lines: ['x'] }, { machine });
    expect(noAuth.status).toBe(401);
    const badAuth = await postOutput(
      config.port,
      { sessionId: 's', lines: ['x'] },
      { machine, token: 'wrong' },
    );
    expect(badAuth.status).toBe(401);
  });

  it('missing/invalid X-Machine is a 2xx deny, never a 4xx', async () => {
    const config = await server.start({ embedded: false, store });

    const missing = await postOutput(
      config.port,
      { sessionId: 's', lines: ['x'] },
      { token: config.token },
    );
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({ ok: false, reason: 'missing-machine' });

    const invalid = await postOutput(
      config.port,
      { sessionId: 's', lines: ['x'] },
      { token: config.token, machine: 'not a valid label!!' },
    );
    expect(invalid.status).toBe(200);
    expect(await invalid.json()).toEqual({ ok: false, reason: 'missing-machine' });
  });

  it('rejects unusable body shapes with 400 (missing sessionId, missing/empty/oversized lines)', async () => {
    const config = await server.start({ embedded: false, store });
    const machine = uniqueMachine('M');

    for (const body of [
      { lines: ['x'] }, // missing sessionId
      { sessionId: '', lines: ['x'] }, // empty sessionId
      { sessionId: 's' }, // missing lines
      { sessionId: 's', lines: [] }, // empty lines
      { sessionId: 's', lines: 'not-an-array' },
      { sessionId: 's', lines: [1, 2] }, // non-string line
      { sessionId: 's', lines: Array.from({ length: 201 }, () => 'x') }, // over MAX_AGENT_OUTPUT_LINES_PER_POST
      { sessionId: 's', lines: ['x'.repeat(16_385)] }, // over MAX_AGENT_OUTPUT_LINE_BYTES
    ]) {
      const res = await postOutput(config.port, body, { token: config.token, machine });
      expect(res.status).toBe(400);
    }
  });

  it('unresolvable session is a 2xx deny — no ring entry created', async () => {
    const config = await server.start({ embedded: false, store });
    const machine = uniqueMachine('M');

    const res = await postOutput(
      config.port,
      { sessionId: 'no-such-session', lines: [assistantText('hi')] },
      { token: config.token, machine },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: 'unknown-session' });
  });

  it('resolved lines render and append into the same ring shape the local tap uses', async () => {
    const config = await server.start({ embedded: false, store });
    const machine = uniqueMachine('M');
    const agentId = newAgentId();
    const sessionId = crypto.randomUUID();
    store.set(agentId, makeAgent(agentId, sessionId, machine));

    const res = await postOutput(
      config.port,
      { sessionId, lines: [assistantText('remote hello'), 'not json', assistantText('  ')] },
      { token: config.token, machine },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    // Only the one non-blank assistant-text line renders; malformed/blank
    // lines are silently skipped, same as renderTranscriptLine's contract.
    const chunks = outputRingStore.replay('agent', String(agentId));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      source: 'agent',
      id: String(agentId),
      stream: 'transcript',
      chunk: 'remote hello\n',
    });
    outputRingStore.evict('agent', String(agentId));
  });

  it('liveness gate: a session with no live agent (post-removal) is a deny — ring never resurrected', async () => {
    const config = await server.start({ embedded: false, store });
    const machine = uniqueMachine('M');
    const agentId = newAgentId();
    const sessionId = crypto.randomUUID();
    store.set(agentId, makeAgent(agentId, sessionId, machine));

    const live = await postOutput(
      config.port,
      { sessionId, lines: [assistantText('while alive')] },
      { token: config.token, machine },
    );
    expect(await live.json()).toEqual({ ok: true });
    expect(outputRingStore.replay('agent', String(agentId))).toHaveLength(1);

    store.delete(agentId); // 'agentRemoved' choke point evicts the ring entry
    expect(outputRingStore.replay('agent', String(agentId))).toEqual([]);

    const straggler = await postOutput(
      config.port,
      { sessionId, lines: [assistantText('too late')] },
      { token: config.token, machine },
    );
    expect(straggler.status).toBe(200);
    expect(await straggler.json()).toEqual({ ok: false, reason: 'unknown-session' });
    expect(outputRingStore.replay('agent', String(agentId))).toEqual([]);
  });

  it('usage accounting updates agent tokens, shiftStats, and broadcasts agentTokenUsage', async () => {
    const config = await server.start({ embedded: false, store });
    const machine = uniqueMachine('M');
    const agentId = newAgentId();
    const sessionId = crypto.randomUUID();
    const agent = makeAgent(agentId, sessionId, machine);
    store.set(agentId, agent);

    const broadcasts: Array<Record<string, unknown>> = [];
    store.on('broadcast', (msg) => broadcasts.push(msg));

    const before = shiftStats.getReport();

    const res = await postOutput(
      config.port,
      { sessionId, lines: [assistantUsage('remote usage', 100, 40)] },
      { token: config.token, machine },
    );
    expect(await res.json()).toEqual({ ok: true });

    expect(agent.inputTokens).toBe(100);
    expect(agent.outputTokens).toBe(40);

    const after = shiftStats.getReport();
    expect(after.tokensIn - before.tokensIn).toBe(100);
    expect(after.tokensOut - before.tokensOut).toBe(40);

    expect(broadcasts).toContainEqual({
      type: 'agentTokenUsage',
      id: agentId,
      inputTokens: 100,
      outputTokens: 40,
    });

    outputRingStore.evict('agent', String(agentId));
  });
});

describe('remote transcript-path retention (registerHookRoute)', () => {
  let store: InstanceType<typeof AgentStateStore>;
  let server: InstanceType<typeof PixelAgentsServer>;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-transcript-retention-test-'));
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

  function postHook(
    port: number,
    token: string,
    machine: string | undefined,
    event: Record<string, unknown>,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
    if (machine !== undefined) headers['X-Machine'] = machine;
    return fetch(`http://127.0.0.1:${port}/api/hooks/claude`, {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
    });
  }

  it('retains transcript_path for a remote machine, keyed by (machine, sessionId), and links it to the agent it creates', async () => {
    const ownMachine = uniqueMachine('LOCALHOST');
    const remoteMachine = uniqueMachine('REMOTE');
    const config = await server.start({ embedded: false, store, machineLabel: ownMachine });

    const agentId = newAgentId();
    const sessionId = crypto.randomUUID();
    server.onHookEvent((_providerId, event) => {
      // Stand in for hookEventHandler's agent creation/matching (out of
      // scope here — this test only proves the retention+linking contract).
      if (event.session_id === sessionId && !store.has(agentId)) {
        store.set(agentId, makeAgent(agentId, sessionId, remoteMachine));
      }
    });

    const res = await postHook(config.port, config.token, remoteMachine, {
      session_id: sessionId,
      hook_event_name: 'SessionStart',
      transcript_path: '/home/remote-user/.claude/projects/x/session.jsonl',
    });
    expect(res.status).toBe(200);

    expect(getRemoteTranscriptPath(remoteMachine, sessionId)).toBe(
      '/home/remote-user/.claude/projects/x/session.jsonl',
    );

    store.delete(agentId); // 'agentRemoved' choke point
    expect(getRemoteTranscriptPath(remoteMachine, sessionId)).toBeUndefined();
  });

  it("never retains a transcript path for the server's own machine", async () => {
    const ownMachine = uniqueMachine('LOCALHOST');
    const config = await server.start({ embedded: false, store, machineLabel: ownMachine });
    const sessionId = crypto.randomUUID();

    const res = await postHook(config.port, config.token, ownMachine, {
      session_id: sessionId,
      hook_event_name: 'SessionStart',
      transcript_path: '/local/path/session.jsonl',
    });
    expect(res.status).toBe(200);
    expect(getRemoteTranscriptPath(ownMachine, sessionId)).toBeUndefined();
  });

  it('never retains a transcript path when X-Machine is absent (local hook delivery, no header)', async () => {
    const ownMachine = uniqueMachine('LOCALHOST');
    const config = await server.start({ embedded: false, store, machineLabel: ownMachine });
    const sessionId = crypto.randomUUID();

    const res = await postHook(config.port, config.token, undefined, {
      session_id: sessionId,
      hook_event_name: 'SessionStart',
      transcript_path: '/local/path/session2.jsonl',
    });
    expect(res.status).toBe(200);
    expect(getRemoteTranscriptPath('', sessionId)).toBeUndefined();
  });
});
