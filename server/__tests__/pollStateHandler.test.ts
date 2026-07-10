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
  SERVER_ROOM_CASH_BONUS_PCT,
  WAR_ROOM_CRISIS_XP_BONUS_PCT,
} from '../src/economyConstants.js';
import type { Employee } from '../src/employeeStore.js';
import type { OfficeLayout, PlacedFurniture, PlacedRoom } from '../src/officeLayoutTypes.js';
import { RoomType, TileType } from '../src/officeLayoutTypes.js';
import {
  applyPollStates,
  parsePollBody,
  POLL_STATE_TTL_MS,
  startPollStateSweep,
} from '../src/pollStateHandler.js';
import type { AgentState } from '../src/types.js';

// Building buffs (G2, GAME-DESIGN §5.4/§5.5): applyPollStates reads the
// office layout via officeLayoutStore.ts's getOfficeLayout() at the moment
// a crisis resolves. Stub the module boundary only (keep every other real
// export, same `vi.importActual` idiom economyStore.test.ts/
// employeeStore.test.ts use for `os`) so buffsForDesk/globalBuffs — the
// real, unmocked computation — run against a layout fixture we control.
vi.mock('../src/officeLayoutStore.js', async () => {
  const actual = await vi.importActual<typeof import('../src/officeLayoutStore.js')>(
    '../src/officeLayoutStore.js',
  );
  return { ...actual, getOfficeLayout: vi.fn() };
});
const { getOfficeLayout } = await import('../src/officeLayoutStore.js');

/** Mirrors buildingBuffs.test.ts's fixture-construction style. */
function baseLayout(overrides: Partial<OfficeLayout> = {}): OfficeLayout {
  const cols = 20;
  const rows = 11;
  const tiles = new Array(cols * rows).fill(TileType.FLOOR_1);
  return { version: 1, cols, rows, tiles, furniture: [], rooms: [], ...overrides };
}
function desk(uid: string, col: number, row: number): PlacedFurniture {
  return { uid, type: 'DESK_FRONT', col, row };
}
function room(
  type: RoomType,
  colStart: number,
  rowStart: number,
  colEnd: number,
  rowEnd: number,
): PlacedRoom {
  return { uid: `room-${type}`, type, colStart, rowStart, colEnd, rowEnd, createdAt: 0 };
}

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
      { type: 'agentPollState', id: 1, state: 'blocked', waitingFor: 'Permission: Edit', ageMs: 0 },
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
    expect(broadcasts.length).toBe(1); // unchanged, not yet due → no re-broadcast
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

  it('preserves `since` across refreshes and waitingFor changes; resets it on state change', () => {
    store.set(10, createTestAgent({ id: 10, sessionId: 'aging-sess' }));
    applyPollStates(store, 'MACBOOK', 'MACBOOK', [{ id: 'aging-sess', state: 'blocked' }], 1000);
    expect(store.get(10)!.pollState?.since).toBe(1000);
    // refresh tick — same state, since anchored to the transition
    applyPollStates(store, 'MACBOOK', 'MACBOOK', [{ id: 'aging-sess', state: 'blocked' }], 9000);
    expect(store.get(10)!.pollState?.since).toBe(1000);
    // waitingFor-only change — still the same blocked episode
    applyPollStates(
      store,
      'MACBOOK',
      'MACBOOK',
      [{ id: 'aging-sess', state: 'blocked', waitingFor: 'Permission: Bash' }],
      12_000,
    );
    expect(store.get(10)!.pollState?.since).toBe(1000);
    expect(broadcasts.at(-1)).toMatchObject({ id: 10, ageMs: 11_000 });
    // state change — new episode, since resets
    applyPollStates(store, 'MACBOOK', 'MACBOOK', [{ id: 'aging-sess', state: 'working' }], 15_000);
    expect(store.get(10)!.pollState?.since).toBe(15_000);
    expect(broadcasts.at(-1)).toMatchObject({ id: 10, state: 'working', ageMs: 0 });
  });

  it('rebroadcasts an UNCHANGED state once the rebroadcast interval elapses (keeps client TTL alive)', () => {
    store.set(11, createTestAgent({ id: 11, sessionId: 'long-block' }));
    applyPollStates(store, 'MACBOOK', 'MACBOOK', [{ id: 'long-block', state: 'blocked' }], 1000);
    expect(broadcasts.length).toBe(1);
    // 15s later: unchanged, under the interval → silent refresh
    applyPollStates(store, 'MACBOOK', 'MACBOOK', [{ id: 'long-block', state: 'blocked' }], 16_000);
    expect(broadcasts.length).toBe(1);
    // 21s after the first broadcast: due → rebroadcast with the true age
    applyPollStates(store, 'MACBOOK', 'MACBOOK', [{ id: 'long-block', state: 'blocked' }], 22_000);
    expect(broadcasts.length).toBe(2);
    expect(broadcasts.at(-1)).toEqual({
      type: 'agentPollState',
      id: 11,
      state: 'blocked',
      waitingFor: undefined,
      ageMs: 21_000,
    });
    // the throttle re-arms from the rebroadcast, not the first broadcast
    applyPollStates(store, 'MACBOOK', 'MACBOOK', [{ id: 'long-block', state: 'blocked' }], 30_000);
    expect(broadcasts.length).toBe(2);
  });

  it('awards progression XP only for an OBSERVED transition away from blocked, never for a silent poller-drop clear', () => {
    const recordCrisisResolved = vi.fn();
    store.set(20, createTestAgent({ id: 20, sessionId: 'xp-sess' }));
    applyPollStates(
      store,
      'MACBOOK',
      'MACBOOK',
      [{ id: 'xp-sess', state: 'blocked' }],
      1000,
      undefined,
      { recordCrisisResolved },
    );
    expect(recordCrisisResolved).not.toHaveBeenCalled();
    // Observed transition: the poller explicitly reports a new, non-blocked state.
    applyPollStates(
      store,
      'MACBOOK',
      'MACBOOK',
      [{ id: 'xp-sess', state: 'working' }],
      2000,
      undefined,
      { recordCrisisResolved },
    );
    expect(recordCrisisResolved).toHaveBeenCalledTimes(1);
    expect(recordCrisisResolved).toHaveBeenCalledWith('crisis:agent:20@1000', 2000);
    // Re-block, then let the poller silently stop reporting it (ambiguous —
    // never a positive observation) — must NOT award XP.
    applyPollStates(
      store,
      'MACBOOK',
      'MACBOOK',
      [{ id: 'xp-sess', state: 'blocked' }],
      3000,
      undefined,
      { recordCrisisResolved },
    );
    applyPollStates(store, 'MACBOOK', 'MACBOOK', [], 4000, undefined, { recordCrisisResolved });
    expect(recordCrisisResolved).toHaveBeenCalledTimes(1); // still just the one observed resolution
  });
});

describe('applyPollStates — building buffs on crisis resolution (G2, GAME-DESIGN §5.4/§5.5, F2)', () => {
  let store: AgentStateStore;

  beforeEach(() => {
    store = new AgentStateStore();
    vi.mocked(getOfficeLayout).mockReturnValue(null);
  });

  it('War Room: a resolver seated at a War Room desk gets WAR_ROOM_CRISIS_XP_BONUS_PCT; a non-War-Room desk gets 0 — same layout', () => {
    const layout = baseLayout({
      furniture: [desk('war-desk', 1, 1), desk('plain-desk', 15, 8)],
      rooms: [room(RoomType.WAR_ROOM, 0, 0, 4, 4)],
    });
    vi.mocked(getOfficeLayout).mockReturnValue(layout);
    const recordCrisisResolved = vi.fn();
    const employeeSinkFor = (assignedRoomId: string | undefined) => ({
      recordCrisisResolved,
      getById: vi.fn(() => ({ assignedRoomId }) as unknown as Employee),
    });

    // War-Room-seated employee.
    store.set(
      1,
      createTestAgent({ id: 1, sessionId: 'war-sess', machine: 'MACBOOK', projectDir: '/war' }),
    );
    applyPollStates(store, 'MACBOOK', 'MACBOOK', [{ id: 'war-sess', state: 'blocked' }], 1000);
    applyPollStates(
      store,
      'MACBOOK',
      'MACBOOK',
      [{ id: 'war-sess', state: 'working' }],
      2000,
      undefined,
      undefined,
      employeeSinkFor('war-desk'),
    );
    expect(recordCrisisResolved).toHaveBeenCalledWith(
      'MACBOOK',
      '/war',
      2000,
      WAR_ROOM_CRISIS_XP_BONUS_PCT,
    );

    // Non-War-Room-seated employee, identical layout — neutral 0% bonus.
    recordCrisisResolved.mockClear();
    store.set(
      2,
      createTestAgent({ id: 2, sessionId: 'plain-sess', machine: 'MACBOOK', projectDir: '/plain' }),
    );
    applyPollStates(store, 'MACBOOK', 'MACBOOK', [{ id: 'plain-sess', state: 'blocked' }], 3000);
    applyPollStates(
      store,
      'MACBOOK',
      'MACBOOK',
      [{ id: 'plain-sess', state: 'working' }],
      4000,
      undefined,
      undefined,
      employeeSinkFor('plain-desk'),
    );
    expect(recordCrisisResolved).toHaveBeenCalledWith('MACBOOK', '/plain', 4000, 0);
  });

  it('Server Room: economySink gets SERVER_ROOM_CASH_BONUS_PCT only when qualifying furniture sits inside the Server Room', () => {
    const economyRecordCrisisResolved = vi.fn();

    // No Server Room in the layout at all.
    vi.mocked(getOfficeLayout).mockReturnValue(baseLayout());
    store.set(1, createTestAgent({ id: 1, sessionId: 'no-server-sess', machine: 'MACBOOK' }));
    applyPollStates(
      store,
      'MACBOOK',
      'MACBOOK',
      [{ id: 'no-server-sess', state: 'blocked' }],
      1000,
    );
    applyPollStates(
      store,
      'MACBOOK',
      'MACBOOK',
      [{ id: 'no-server-sess', state: 'working' }],
      2000,
      undefined,
      undefined,
      undefined,
      { recordCrisisResolved: economyRecordCrisisResolved },
    );
    expect(economyRecordCrisisResolved).toHaveBeenCalledWith(
      expect.stringMatching(/^crisis:agent:\d+@1000$/),
      2000,
      0,
    );

    // Server Room with a qualifying PC_* furniture piece placed inside.
    economyRecordCrisisResolved.mockClear();
    const layoutWithServerRoom = baseLayout({
      furniture: [{ uid: 'pc-1', type: 'PC_FRONT_ON_1', col: 1, row: 1 }],
      rooms: [room(RoomType.SERVER_ROOM, 0, 0, 4, 4)],
    });
    vi.mocked(getOfficeLayout).mockReturnValue(layoutWithServerRoom);
    store.set(2, createTestAgent({ id: 2, sessionId: 'server-sess', machine: 'MACBOOK' }));
    applyPollStates(store, 'MACBOOK', 'MACBOOK', [{ id: 'server-sess', state: 'blocked' }], 3000);
    applyPollStates(
      store,
      'MACBOOK',
      'MACBOOK',
      [{ id: 'server-sess', state: 'working' }],
      4000,
      undefined,
      undefined,
      undefined,
      { recordCrisisResolved: economyRecordCrisisResolved },
    );
    expect(economyRecordCrisisResolved).toHaveBeenCalledWith(
      expect.stringMatching(/^crisis:agent:\d+@3000$/),
      4000,
      SERVER_ROOM_CASH_BONUS_PCT,
    );
  });

  it('a missing layout degrades to neutral (0% / no bonus), never throws', () => {
    vi.mocked(getOfficeLayout).mockReturnValue(null);
    const employeeRecordCrisisResolved = vi.fn();
    const economyRecordCrisisResolved = vi.fn();
    store.set(1, createTestAgent({ id: 1, sessionId: 'no-layout-sess', machine: 'MACBOOK' }));
    applyPollStates(
      store,
      'MACBOOK',
      'MACBOOK',
      [{ id: 'no-layout-sess', state: 'blocked' }],
      1000,
    );
    expect(() =>
      applyPollStates(
        store,
        'MACBOOK',
        'MACBOOK',
        [{ id: 'no-layout-sess', state: 'working' }],
        2000,
        undefined,
        undefined,
        { recordCrisisResolved: employeeRecordCrisisResolved, getById: vi.fn() },
        { recordCrisisResolved: economyRecordCrisisResolved },
      ),
    ).not.toThrow();
    expect(employeeRecordCrisisResolved).toHaveBeenCalledWith('MACBOOK', '/test', 2000, 0);
    expect(economyRecordCrisisResolved).toHaveBeenCalledWith(
      expect.stringMatching(/^crisis:agent:\d+@1000$/),
      2000,
      0,
    );
  });
});

describe('startPollStateSweep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('never matches a coworker agent by cwd (claude agents --json only reports Claude)', () => {
    const store = new AgentStateStore();
    store.set(
      12,
      createTestAgent({
        id: 12,
        sessionId: 'cw-1',
        projectDir: '/shared/proj',
        providerId: 'codex',
      }),
    );
    const result = applyPollStates(store, 'MACBOOK', 'MACBOOK', [
      { id: 'zzzz9999', state: 'blocked', cwd: '/shared/proj' },
    ]);
    expect(result.matched).toBe(0);
    expect(store.get(12)!.pollState).toBeUndefined();
  });

  it('clears poll states older than the TTL and broadcasts the clear', () => {
    const store = new AgentStateStore();
    const broadcasts: Array<Record<string, unknown>> = [];
    store.on('broadcast', (msg: Record<string, unknown>) => broadcasts.push(msg));
    store.set(1, createTestAgent({ id: 1, sessionId: 's1' }));
    store.get(1)!.pollState = {
      state: 'blocked',
      at: Date.now(),
      since: Date.now(),
      lastBroadcastAt: Date.now(),
    };

    const timer = startPollStateSweep(store);
    try {
      vi.advanceTimersByTime(POLL_STATE_TTL_MS / 2);
      expect(store.get(1)!.pollState).toBeDefined(); // still fresh
      vi.advanceTimersByTime(POLL_STATE_TTL_MS + 60_000);
      expect(store.get(1)!.pollState).toBeUndefined();
      // stale: poller silence, not an observed change — the webview drops the
      // badge without celebrating a resolution.
      expect(broadcasts).toContainEqual({ type: 'agentPollState', id: 1, stale: true });
    } finally {
      clearInterval(timer);
    }
  });
});
