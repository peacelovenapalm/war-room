/**
 * Unit tests for the M4 needs-input poll ingest (pollStateHandler).
 *
 * Covers: body validation (parsePollBody), entry→agent matching (sessionId
 * exact / short-id prefix / unique-cwd), per-tick clearing, machine scoping,
 * change-only broadcasts, and the staleness sweep.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import {
  applyPollStates,
  parsePollBody,
  POLL_STATE_TTL_MS,
  startPollStateSweep,
} from '../src/pollStateHandler.js';
import type { AgentState } from '../src/types.js';

function createTestAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 1,
    sessionId: 'sess-1',
    terminalRef: undefined,
    isExternal: true,
    projectDir: '/test',
    jsonlFile: '/test/session.jsonl',
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
    ...overrides,
  } as AgentState;
}

describe('parsePollBody', () => {
  it('rejects unusable body shapes with null', () => {
    expect(parsePollBody(null)).toBeNull();
    expect(parsePollBody('str')).toBeNull();
    expect(parsePollBody({})).toBeNull();
    expect(parsePollBody({ agents: 'nope' })).toBeNull();
  });

  it('accepts a valid body and drops invalid entries', () => {
    const entries = parsePollBody({
      agents: [
        { id: 'a1', state: 'blocked', waitingFor: 'Permission: Bash', cwd: '/x', junk: 1 },
        { id: 'a2', state: 'sleeping' }, // invalid state
        { state: 'blocked' }, // missing id
        null,
        'garbage',
        { id: 'a3', state: 'working', sessionId: 'a3-full-uuid' },
      ],
    });
    expect(entries).not.toBeNull();
    expect(entries!.map((e) => e.id)).toEqual(['a1', 'a3']);
    expect(entries![0].waitingFor).toBe('Permission: Bash');
    expect(entries![1].sessionId).toBe('a3-full-uuid');
    expect('junk' in entries![0]).toBe(false);
  });

  it('caps waitingFor length', () => {
    const entries = parsePollBody({
      agents: [{ id: 'a1', state: 'blocked', waitingFor: 'x'.repeat(1000) }],
    });
    expect(entries![0].waitingFor!.length).toBe(200);
  });
});

describe('applyPollStates', () => {
  let store: AgentStateStore;
  let broadcasts: Array<Record<string, unknown>>;

  beforeEach(() => {
    store = new AgentStateStore();
    broadcasts = [];
    store.on('broadcast', (msg: Record<string, unknown>) => broadcasts.push(msg));
  });

  it('matches by exact sessionId and broadcasts agentPollState', () => {
    store.set(1, createTestAgent({ id: 1, sessionId: '824af38a-f0ed-43ee-afb4-568e9b97c5ee' }));
    const result = applyPollStates(store, 'MACBOOK', 'MACBOOK', [
      {
        id: '824af38a',
        sessionId: '824af38a-f0ed-43ee-afb4-568e9b97c5ee',
        state: 'blocked',
        waitingFor: 'Permission: Edit',
      },
    ]);
    expect(result).toEqual({ matched: 1, cleared: 0 });
    expect(store.get(1)!.pollState?.state).toBe('blocked');
    expect(broadcasts).toEqual([
      { type: 'agentPollState', id: 1, state: 'blocked', waitingFor: 'Permission: Edit' },
    ]);
  });

  it('matches short poll id as a sessionId prefix (2.1.202 short-hash ids)', () => {
    store.set(2, createTestAgent({ id: 2, sessionId: 'd2e92995-fa67-486f-9f6f-d77534c2ee98' }));
    const result = applyPollStates(store, 'MACBOOK', 'MACBOOK', [
      { id: 'd2e92995', state: 'failed' },
    ]);
    expect(result.matched).toBe(1);
    expect(store.get(2)!.pollState?.state).toBe('failed');
  });

  it('falls back to cwd only when unambiguous', () => {
    // hooks-only remote agent: projectDir IS the remote cwd
    store.set(3, createTestAgent({ id: 3, sessionId: 'unknown-a', projectDir: '/remote/proj' }));
    // local JSONL agent: projectDir is ~/.claude/projects/<normalized>
    store.set(
      4,
      createTestAgent({
        id: 4,
        sessionId: 'unknown-b',
        projectDir: '/Users/x/.claude/projects/-Users-x-code-alpha',
      }),
    );
    const result = applyPollStates(store, 'MACBOOK', 'MACBOOK', [
      { id: 'zzzz9999', state: 'blocked', cwd: '/remote/proj' },
      { id: 'yyyy8888', state: 'blocked', cwd: '/Users/x/code/alpha' },
    ]);
    expect(result.matched).toBe(2);
    expect(store.get(3)!.pollState?.state).toBe('blocked');
    expect(store.get(4)!.pollState?.state).toBe('blocked');
  });

  it('never guesses on ambiguous cwd (two agents in one project)', () => {
    store.set(5, createTestAgent({ id: 5, sessionId: 'amb-1', projectDir: '/same/dir' }));
    store.set(6, createTestAgent({ id: 6, sessionId: 'amb-2', projectDir: '/same/dir' }));
    const result = applyPollStates(store, 'MACBOOK', 'MACBOOK', [
      { id: 'nope0000', state: 'blocked', cwd: '/same/dir' },
    ]);
    expect(result.matched).toBe(0);
    expect(store.get(5)!.pollState).toBeUndefined();
    expect(store.get(6)!.pollState).toBeUndefined();
  });

  it('scopes matching AND clearing to the posting machine', () => {
    store.set(7, createTestAgent({ id: 7, sessionId: 'mini-sess-1', machine: 'MINI' }));
    store.set(8, createTestAgent({ id: 8, sessionId: 'mac-sess-1' })); // local (MACBOOK)
    // MINI's poller reports its agent blocked
    applyPollStates(store, 'MINI', 'MACBOOK', [{ id: 'mini-sess-1', state: 'blocked' }]);
    expect(store.get(7)!.pollState?.state).toBe('blocked');
    // MACBOOK's poller reports nothing — must NOT clear MINI's state
    const result = applyPollStates(store, 'MACBOOK', 'MACBOOK', []);
    expect(result.cleared).toBe(0);
    expect(store.get(7)!.pollState?.state).toBe('blocked');
    // MINI's next tick omits the session → cleared, clear broadcast sent
    broadcasts.length = 0;
    const result2 = applyPollStates(store, 'MINI', 'MACBOOK', []);
    expect(result2.cleared).toBe(1);
    expect(store.get(7)!.pollState).toBeUndefined();
    expect(broadcasts).toEqual([{ type: 'agentPollState', id: 7 }]);
  });

  it('broadcasts only on change, refreshes timestamp on every tick', () => {
    store.set(9, createTestAgent({ id: 9, sessionId: 'stable-sess' }));
    applyPollStates(store, 'MACBOOK', 'MACBOOK', [{ id: 'stable-sess', state: 'blocked' }], 1000);
    expect(broadcasts.length).toBe(1);
    applyPollStates(store, 'MACBOOK', 'MACBOOK', [{ id: 'stable-sess', state: 'blocked' }], 2000);
    expect(broadcasts.length).toBe(1); // unchanged → no re-broadcast
    expect(store.get(9)!.pollState?.at).toBe(2000); // but freshness updated
    applyPollStates(
      store,
      'MACBOOK',
      'MACBOOK',
      [{ id: 'stable-sess', state: 'blocked', waitingFor: 'now with detail' }],
      3000,
    );
    expect(broadcasts.length).toBe(2); // waitingFor change → broadcast
  });
});

describe('startPollStateSweep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears poll states older than the TTL and broadcasts the clear', () => {
    const store = new AgentStateStore();
    const broadcasts: Array<Record<string, unknown>> = [];
    store.on('broadcast', (msg: Record<string, unknown>) => broadcasts.push(msg));
    store.set(1, createTestAgent({ id: 1, sessionId: 's1' }));
    store.get(1)!.pollState = { state: 'blocked', at: Date.now() };

    const timer = startPollStateSweep(store);
    try {
      vi.advanceTimersByTime(POLL_STATE_TTL_MS / 2);
      expect(store.get(1)!.pollState).toBeDefined(); // still fresh
      vi.advanceTimersByTime(POLL_STATE_TTL_MS + 60_000);
      expect(store.get(1)!.pollState).toBeUndefined();
      expect(broadcasts).toContainEqual({ type: 'agentPollState', id: 1 });
    } finally {
      clearInterval(timer);
    }
  });
});
