/**
 * T2 remote-answer plane + T4 session launch — server side
 * (REMOTE-ANSWER-DESIGN.md, approved 2026-07-11).
 *
 * Unit tests pin DispatchStore's new surface (session action validation,
 * managed-session advertisement + TTL, answer queue/nonce/outcome/receipts/
 * expiry); route tests exercise the wired planes end-to-end: poll
 * advertisement → managed flag broadcast → answer request → drain →
 * runner outcome → receipt.
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

const { DispatchStore, ANSWER_TEXT_MAX_CHARS } = await import('../src/dispatchStore.js');
const { PixelAgentsServer } = await import('../src/server.js');
const { AgentStateStore } = await import('../src/agentStateStore.js');
import type { AgentState } from '../src/types.js';

function uniqueMachine(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`.toUpperCase();
}

function makeAgent(id: number, machine: string, pid: number): AgentState {
  return {
    id,
    sessionId: `session-${id}`,
    terminalRef: undefined,
    isExternal: true,
    projectDir: '/tmp',
    jsonlFile: `/tmp/agent-${id}.jsonl`,
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
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    inputTokens: 0,
    outputTokens: 0,
    machine,
    pid,
  } as AgentState;
}

beforeEach(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-answer-test-'));
  fs.mkdirSync(path.join(tmpBase, '.pixel-agents'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

// ── DispatchStore unit surface ─────────────────────────────────────

describe('DispatchStore: session action', () => {
  it('enqueues a session WITHOUT a prompt (optional opening brief)', () => {
    const store = new DispatchStore();
    const result = store.enqueue({
      action: 'session',
      machine: 'M1',
      provider: 'claude',
      cwd: '/tmp',
    });
    expect(result.ok).toBe(true);
    const pending = store.pendingFor('M1');
    expect(pending).toHaveLength(1);
    expect(pending[0].action).toBe('session');
    expect(pending[0].provider).toBe('claude');
    expect(pending[0].prompt).toBeUndefined();
  });

  it('carries prompt/model/effort but REJECTS timeoutSec (no cap plane for interactive)', () => {
    const store = new DispatchStore();
    const ok = store.enqueue({
      action: 'session',
      machine: 'M1',
      provider: 'claude',
      cwd: '/tmp',
      prompt: 'opening brief',
      model: 'fable',
      effort: 'high',
    });
    expect(ok.ok).toBe(true);
    const item = store.pendingFor('M1')[0];
    expect(item.prompt).toBe('opening brief');
    expect(item.model).toBe('fable');

    const capped = store.enqueue({
      action: 'session',
      machine: 'M1',
      provider: 'claude',
      cwd: '/tmp',
      timeoutSec: 60,
    });
    expect(capped).toEqual({ ok: false, reason: 'timeout-unsupported-for-session' });
  });

  it('validates provider/cwd exactly like dispatch', () => {
    const store = new DispatchStore();
    expect(
      store.enqueue({ action: 'session', machine: 'M1', provider: 'nope', cwd: '/t' }),
    ).toEqual({ ok: false, reason: 'invalid-provider' });
    expect(store.enqueue({ action: 'session', machine: 'M1', provider: 'claude' })).toEqual({
      ok: false,
      reason: 'missing-cwd',
    });
  });
});

describe('DispatchStore: managed advertisement + answer plane', () => {
  const AD = [{ dispatchId: 'sess-1', tmuxSession: 'war-room-sess-1', panePid: 4242 }];

  it('requestAnswer denies not-managed without a live advertisement', () => {
    const store = new DispatchStore();
    expect(store.requestAnswer('M1', 4242, 'hello')).toEqual({
      ok: false,
      reason: 'not-managed',
    });
  });

  it('resolves (machine,pid) → managed ref, mints a unique nonce, drains at-most-once', () => {
    const store = new DispatchStore();
    store.recordManagedSessions('M1', AD);
    const a = store.requestAnswer('M1', 4242, 'yes — option 2');
    const b = store.requestAnswer('M1', 4242, 'second answer');
    expect(a.ok && b.ok).toBe(true);

    const drained = store.drainAnswersFor('M1');
    expect(drained).toHaveLength(2);
    expect(drained[0].managedSessionRef).toBe('sess-1');
    expect(drained[0].text).toBe('yes — option 2');
    expect(drained[0].nonce).toBeTruthy();
    expect(drained[0].nonce).not.toBe(drained[1].nonce);
    expect(store.drainAnswersFor('M1')).toHaveLength(0);
  });

  it('a stale advertisement stops resolving (TTL) and sweepStaleManaged reports it', () => {
    const store = new DispatchStore();
    const t0 = Date.now();
    store.recordManagedSessions('M1', AD, t0);
    expect(store.getManagedFor('M1', t0 + 1_000)).toHaveLength(1);
    expect(store.getManagedFor('M1', t0 + 60_000)).toHaveLength(0);
    expect(store.requestAnswer('M1', 4242, 'late', t0 + 60_000)).toEqual({
      ok: false,
      reason: 'not-managed',
    });
    expect(store.sweepStaleManaged(t0 + 60_000)).toEqual(['M1']);
    // Second sweep is a no-op (already cleared).
    expect(store.sweepStaleManaged(t0 + 61_000)).toEqual([]);
  });

  it('rejects control chars / overlong / empty text server-side', () => {
    const store = new DispatchStore();
    store.recordManagedSessions('M1', AD);
    expect(store.requestAnswer('M1', 4242, 'a\nb')).toEqual({
      ok: false,
      reason: 'control-chars-rejected',
    });
    expect(store.requestAnswer('M1', 4242, 'x'.repeat(ANSWER_TEXT_MAX_CHARS + 1))).toEqual({
      ok: false,
      reason: 'text-too-long',
    });
    expect(store.requestAnswer('M1', 4242, '   ')).toEqual({ ok: false, reason: 'invalid-text' });
  });

  it('first outcome report wins; duplicates are dropped (server-side replay half)', () => {
    const store = new DispatchStore();
    store.recordManagedSessions('M1', AD);
    const req = store.requestAnswer('M1', 4242, 'ok');
    if (!req.ok) throw new Error('expected ok');
    expect(store.getAnswerStatus(req.id)).toEqual({
      found: true,
      status: 'pending',
      reason: undefined,
    });
    store.reportAnswerStatus(req.id, 'delivered', undefined);
    // A late duplicate (even a contradicting one) must not re-transition.
    store.reportAnswerStatus(req.id, 'denied', 'nonce-replayed');
    expect(store.getAnswerStatus(req.id)).toEqual({
      found: true,
      status: 'delivered',
      reason: undefined,
    });
    expect(store.getAnswerStatus('unknown')).toEqual({ found: false });
  });

  it('pending answers expire to a terminal denied/expired; receipts carry verbatim text', () => {
    const store = new DispatchStore();
    const t0 = Date.now();
    store.recordManagedSessions('M1', AD, t0);
    const req = store.requestAnswer('M1', 4242, 'verbatim — $(kept) as-is', t0);
    if (!req.ok) throw new Error('expected ok');
    expect(store.sweepExpiredAnswers(t0 + 1_000)).toBe(0);
    expect(store.sweepExpiredAnswers(t0 + 700_000)).toBe(1);
    expect(store.getAnswerStatus(req.id)).toEqual({
      found: true,
      status: 'denied',
      reason: 'expired',
    });
    const receipts = store.getAnswerReceipts('M1');
    expect(receipts).toHaveLength(1);
    expect(receipts[0].text).toBe('verbatim — $(kept) as-is');
    expect(receipts[0].managedSessionRef).toBe('sess-1');
    expect(store.getAnswerReceipts('M1', 'other-ref')).toHaveLength(0);
  });
});

// ── Route-level (wired server) ─────────────────────────────────────

describe('answer plane HTTP routes', () => {
  let server: InstanceType<typeof PixelAgentsServer>;

  beforeEach(() => {
    server = new PixelAgentsServer();
  });

  afterEach(async () => {
    await server.stop();
  });

  async function poll(
    port: number,
    token: string,
    machine: string,
    extra: Record<string, unknown> = {},
  ) {
    const res = await fetch(`http://127.0.0.1:${port}/api/dispatch/poll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Machine': machine,
      },
      body: JSON.stringify({ providers: ['claude'], roots: ['/tmp'], focus: false, ...extra }),
    });
    return (await res.json()) as {
      pending: Array<Record<string, unknown>>;
      stop: unknown[];
      answer: Array<{ id: string; managedSessionRef: string; text: string; nonce: string }>;
    };
  }

  it('end-to-end: advertisement → managed flag broadcast → answer → drain → outcome → receipt', async () => {
    const machine = uniqueMachine('MACBOOK');
    const agentStore = new AgentStateStore();
    agentStore.set(7, makeAgent(7, machine, 4242));
    const config = await server.start({ embedded: false, store: agentStore });

    // Watch for the managed-flag transition broadcast.
    const ws = new WebSocket(`ws://127.0.0.1:${config.port}/ws`);
    await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
    const managedUpdates: Array<{ id: number; managed: boolean }> = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data)) as { type: string; id?: number; managed?: boolean };
      if (msg.type === 'agentManagedUpdate') {
        managedUpdates.push({ id: msg.id as number, managed: msg.managed as boolean });
      }
    });

    // Runner advertises a live managed session covering the agent's pid.
    const managedSessions = [
      { dispatchId: 'sess-e2e', tmuxSession: 'war-room-sess-e2e', panePid: 4242 },
    ];
    await poll(config.port, config.token, machine, { sessions: true, managedSessions });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(managedUpdates).toContainEqual({ id: 7, managed: true });

    // GET /api/dispatch/machines carries the sessions capability.
    const machines = (await (
      await fetch(`http://127.0.0.1:${config.port}/api/dispatch/machines`)
    ).json()) as Array<{ machine: string; sessions?: boolean }>;
    expect(machines.find((m) => m.machine === machine)?.sessions).toBe(true);

    // Board queues an answer by (machine, pid).
    const answerRes = (await (
      await fetch(`http://127.0.0.1:${config.port}/api/agents/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machine, pid: 4242, text: 'yes — proceed with option 2' }),
      })
    ).json()) as { ok: boolean; id: string };
    expect(answerRes.ok).toBe(true);

    // Next poll drains the instruction with a minted nonce.
    const second = await poll(config.port, config.token, machine, {
      sessions: true,
      managedSessions,
    });
    expect(second.answer).toHaveLength(1);
    expect(second.answer[0].managedSessionRef).toBe('sess-e2e');
    expect(second.answer[0].text).toBe('yes — proceed with option 2');
    expect(second.answer[0].nonce).toBeTruthy();

    // At-most-once: a third poll carries nothing.
    const third = await poll(config.port, config.token, machine, {
      sessions: true,
      managedSessions,
    });
    expect(third.answer).toHaveLength(0);

    // Runner reports delivered (Bearer) — outcome + receipt readable.
    const statusRes = await fetch(
      `http://127.0.0.1:${config.port}/api/answers/${second.answer[0].id}/status`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
        body: JSON.stringify({ event: 'delivered' }),
      },
    );
    expect(statusRes.status).toBe(200);
    const outcome = (await (
      await fetch(`http://127.0.0.1:${config.port}/api/agents/answer/${second.answer[0].id}`)
    ).json()) as { status: string };
    expect(outcome.status).toBe('delivered');

    const receipts = (await (
      await fetch(
        `http://127.0.0.1:${config.port}/api/agents/answers?machine=${encodeURIComponent(machine)}`,
      )
    ).json()) as { answers: Array<{ text: string; status: string }> };
    expect(receipts.answers).toHaveLength(1);
    expect(receipts.answers[0].text).toBe('yes — proceed with option 2');
    expect(receipts.answers[0].status).toBe('delivered');

    // Advertisement without the session (it died) clears the flag honestly.
    await poll(config.port, config.token, machine, { sessions: true, managedSessions: [] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(managedUpdates).toContainEqual({ id: 7, managed: false });

    ws.close();
  });

  it('answering an unmanaged pid denies honestly; the outcome route requires Bearer', async () => {
    const machine = uniqueMachine('MACBOOK');
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const res = (await (
      await fetch(`http://127.0.0.1:${config.port}/api/agents/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machine, pid: 999, text: 'hello' }),
      })
    ).json()) as { ok: boolean; reason?: string };
    expect(res).toEqual({ ok: false, reason: 'not-managed' });

    const unauth = await fetch(`http://127.0.0.1:${config.port}/api/answers/some-id/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'delivered' }),
    });
    expect(unauth.status).toBe(401);
  });

  it('a session dispatchRequest reaches the runner poll with prompt optional', async () => {
    const machine = uniqueMachine('MINI');
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const ws = new WebSocket(`ws://127.0.0.1:${config.port}/ws`);
    await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
    ws.send(
      JSON.stringify({
        type: 'dispatchRequest',
        action: 'session',
        machine,
        provider: 'claude',
        cwd: '/tmp',
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const body = await poll(config.port, config.token, machine);
    expect(body.pending).toHaveLength(1);
    expect(body.pending[0].action).toBe('session');
    expect(body.pending[0].prompt).toBeUndefined();
    ws.close();
  });
});
