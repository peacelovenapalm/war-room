/**
 * Unit tests for morningSurface.ts (V6-1 "board morning surface").
 * dispatchStore/autoExecutorStore are process-wide singletons (same
 * caveat opsAdvisor.test.ts documents) -- these tests avoid depending on
 * their live state and instead exercise morningJson parsing/staleness,
 * board.needsInput derivation (a real, disposable AgentStateStore), the
 * overnightWindow pure function, and the degraded/cache contract.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import {
  clearMorningSurfaceCache,
  getMorningSurface,
  overnightWindow,
} from '../src/morningSurface.js';
import type { AgentState } from '../src/types.js';

const savedEnv = process.env['WAR_ROOM_MORNING_JSON'];
let tmpDir: string;

function makeAgent(id: number, overrides: Partial<AgentState> = {}): AgentState {
  return {
    id,
    sessionId: `sess-${String(id)}`,
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
    ...overrides,
  } as AgentState;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'morning-surface-'));
  delete process.env['WAR_ROOM_MORNING_JSON'];
  clearMorningSurfaceCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (savedEnv === undefined) delete process.env['WAR_ROOM_MORNING_JSON'];
  else process.env['WAR_ROOM_MORNING_JSON'] = savedEnv;
  clearMorningSurfaceCache();
});

describe('getMorningSurface -- morningJson section', () => {
  it('is honestly unavailable and degraded when the env var is unset', () => {
    const store = new AgentStateStore();
    const surface = getMorningSurface(store, 1_000_000);
    expect(surface.morningJson.available).toBe(false);
    expect(surface.degraded).toBe(true);
    expect(surface.degradedReasons.some((r) => r.includes('unavailable'))).toBe(true);
  });

  it('reads a fresh morning.json and is not degraded', () => {
    const file = path.join(tmpDir, 'morning.json');
    const now = Date.parse('2026-07-13T06:05:00.000Z');
    fs.writeFileSync(
      file,
      JSON.stringify({
        date: '2026-07-13',
        generated_at: new Date(now - 60_000).toISOString(),
        top3: [{ n: 1, action: 'ship it', why: 'because', source: 'todo', tags: ['a'] }],
        flags: 'routine: summary',
        prs: { count: 1, list: [{ number: 42, title: 'fix thing', branch: 'lane/x' }] },
      }),
    );
    process.env['WAR_ROOM_MORNING_JSON'] = file;
    const store = new AgentStateStore();
    const surface = getMorningSurface(store, now);
    expect(surface.morningJson.available).toBe(true);
    expect(surface.morningJson.stale).toBe(false);
    expect(surface.morningJson.top3).toHaveLength(1);
    expect(surface.morningJson.prs.count).toBe(1);
    expect(surface.degraded).toBe(false);
  });

  it('flags a payload older than MORNING_JSON_STALE_MS as stale and degraded', () => {
    const file = path.join(tmpDir, 'morning.json');
    const now = Date.parse('2026-07-13T06:05:00.000Z');
    fs.writeFileSync(
      file,
      JSON.stringify({
        date: '2026-07-12',
        generated_at: new Date(now - 25 * 60 * 60_000).toISOString(),
        top3: [],
        flags: null,
        prs: { count: 0, list: [] },
      }),
    );
    process.env['WAR_ROOM_MORNING_JSON'] = file;
    const store = new AgentStateStore();
    const surface = getMorningSurface(store, now);
    expect(surface.morningJson.stale).toBe(true);
    expect(surface.degraded).toBe(true);
  });

  it('tolerates a malformed payload -- honest per-field ⊘, never a throw', () => {
    const file = path.join(tmpDir, 'morning.json');
    fs.writeFileSync(file, '{ not json');
    process.env['WAR_ROOM_MORNING_JSON'] = file;
    const store = new AgentStateStore();
    const surface = getMorningSurface(store, 1_000_000);
    expect(surface.morningJson.available).toBe(false);
    expect(surface.morningJson.top3).toEqual([]);
  });
});

describe('getMorningSurface -- board section', () => {
  it('counts blocked agents as needs-input, named honestly', () => {
    const store = new AgentStateStore();
    store.set(
      1,
      makeAgent(1, {
        pollState: { state: 'blocked', at: 1_000, since: 1_000, lastBroadcastAt: 1_000 },
        machine: 'MACBOOK',
      }),
    );
    store.set(
      2,
      makeAgent(2, {
        pollState: { state: 'working', at: 1_000, since: 1_000, lastBroadcastAt: 1_000 },
      }),
    );
    const surface = getMorningSurface(store, 2_000_000);
    expect(surface.board.needsInput.count).toBe(1);
    expect(surface.board.needsInput.names[0]).toContain('MACBOOK');
    expect(surface.needsYouCount).toBe(1);
  });
});

describe('getMorningSurface -- caching', () => {
  it('serves from cache within the TTL and recomputes after clearMorningSurfaceCache()', () => {
    const store = new AgentStateStore();
    const first = getMorningSurface(store, 1_000);
    store.set(
      1,
      makeAgent(1, {
        pollState: { state: 'blocked', at: 1_000, since: 1_000, lastBroadcastAt: 1_000 },
      }),
    );
    const stillCached = getMorningSurface(store, 1_000 + 5_000);
    expect(stillCached.board.needsInput.count).toBe(first.board.needsInput.count);

    clearMorningSurfaceCache();
    const recomputed = getMorningSurface(store, 1_000 + 5_000);
    expect(recomputed.board.needsInput.count).toBe(1);
  });
});

describe('overnightWindow', () => {
  it('anchors to last night 18:00 -> this morning 06:00 when called during the morning', () => {
    const now = new Date('2026-07-13T07:30:00');
    const { start, end } = overnightWindow(now.getTime());
    expect(new Date(start).getHours()).toBe(18);
    expect(new Date(start).getDate()).toBe(12);
    expect(new Date(end).getHours()).toBe(6);
    expect(new Date(end).getDate()).toBe(13);
  });

  it('anchors to tonight 18:00 -> tomorrow 06:00 when called during the evening', () => {
    const now = new Date('2026-07-13T20:00:00');
    const { start, end } = overnightWindow(now.getTime());
    expect(new Date(start).getHours()).toBe(18);
    expect(new Date(start).getDate()).toBe(13);
    expect(new Date(end).getHours()).toBe(6);
    expect(new Date(end).getDate()).toBe(14);
  });
});
