/**
 * webviewReady replay tests (panel finding, agentStore.ts:82 / M4 pattern):
 * a reconnecting client rebuilds every agent record with the conservative
 * defaults (status 'waiting', awaitingInput false, toolPermission false) and
 * NO new event will ever fire for a gate that is STILL pending — so the
 * server must replay deviating hook-plane state (agentStatus +
 * agentToolPermission) on webviewReady, exactly the way it already replays
 * agentPollState ("M4").
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentState } from '../src/types.js';

let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

const { AgentStateStore } = await import('../src/agentStateStore.js');
const { handleClientMessage } = await import('../src/clientMessageHandler.js');

function makeAgent(id: number, overrides: Partial<AgentState> = {}): AgentState {
  return {
    id,
    sessionId: `sess-${String(id)}`,
    isExternal: false,
    projectDir: `/tmp/project-${String(id)}`,
    jsonlFile: '',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: true,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    inputTokens: 0,
    outputTokens: 0,
    ...overrides,
  };
}

beforeEach(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'webview-ready-'));
});

afterEach(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

describe('webviewReady hook-plane replay (M4 extended)', () => {
  it('replays pending tool permission, awaitingInput, and active status — and stays silent for defaults', () => {
    const store = new AgentStateStore();
    // #1: a REAL pending tool-permission gate (permissionSent still true).
    store.set(1, makeAgent(1, { permissionSent: true }));
    // #2: genuinely waiting FOR USER INPUT (idle_prompt).
    store.set(2, makeAgent(2, { awaitingInput: true }));
    // #3: mid-turn (active).
    store.set(3, makeAgent(3, { isWaiting: false }));
    // #4: plain done/waiting — matches the client default, nothing to send.
    store.set(4, makeAgent(4));

    const sent: Record<string, unknown>[] = [];
    handleClientMessage({ type: 'webviewReady' }, (m) => sent.push(m), { store, cache: null });

    const statuses = sent.filter((m) => m.type === 'agentStatus');
    const permissions = sent.filter((m) => m.type === 'agentToolPermission');

    expect(permissions).toEqual([{ type: 'agentToolPermission', id: 1 }]);
    expect(statuses).toContainEqual({
      type: 'agentStatus',
      id: 2,
      status: 'waiting',
      awaitingInput: true,
    });
    expect(statuses).toContainEqual({
      type: 'agentStatus',
      id: 3,
      status: 'active',
      awaitingInput: false,
    });
    // Defaults are NOT rebroadcast (no message churn for calm agents).
    expect(statuses.some((m) => m.id === 4)).toBe(false);
    expect(statuses.some((m) => m.id === 1)).toBe(false);
  });
});
