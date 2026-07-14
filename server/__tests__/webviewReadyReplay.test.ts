/**
 * webviewReady replay tests (panel finding, agentStore.ts:82 / M4 pattern):
 * a reconnecting client rebuilds every agent record with the conservative
 * defaults (status 'waiting', awaitingInput false, toolPermission false) and
 * NO new event will ever fire for state that changed while offline — so the
 * server must replay every ephemeral channel, including explicit defaults,
 * after the client's existingAgents epoch reset.
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

describe('webviewReady authoritative telemetry replay', () => {
  it('omits legacy inline assets and layout for the spritesheet-driven v3 face', () => {
    const store = new AgentStateStore();
    const sent: Record<string, unknown>[] = [];
    const cache = {
      characters: { characters: [] },
      pets: { pets: [], manifests: [] },
      floorTiles: [],
      wallTiles: [],
      furniture: { catalog: [], sprites: new Map() },
      defaultLayout: { version: 1 },
    };

    handleClientMessage(
      { type: 'webviewReady', client: 'webview-v3' },
      (message) => sent.push(message),
      { store, cache },
    );

    expect(sent.some((message) => message.type === 'characterSpritesLoaded')).toBe(false);
    expect(sent.some((message) => message.type === 'petSpritesLoaded')).toBe(false);
    expect(sent.some((message) => message.type === 'floorTilesLoaded')).toBe(false);
    expect(sent.some((message) => message.type === 'wallTilesLoaded')).toBe(false);
    expect(sent.some((message) => message.type === 'furnitureAssetsLoaded')).toBe(false);
    expect(sent.some((message) => message.type === 'layoutLoaded')).toBe(false);
    expect(sent.some((message) => message.type === 'settingsLoaded')).toBe(true);
    expect(sent.some((message) => message.type === 'existingAgents')).toBe(true);
  });

  it('keeps sending inline assets and layout to untagged legacy clients', () => {
    const store = new AgentStateStore();
    const sent: Record<string, unknown>[] = [];
    const cache = {
      characters: { characters: [] },
      pets: { pets: [], manifests: [] },
      floorTiles: [],
      wallTiles: [],
      furniture: { catalog: [], sprites: new Map() },
      defaultLayout: { version: 1 },
    };

    handleClientMessage({ type: 'webviewReady' }, (message) => sent.push(message), {
      store,
      cache,
    });

    expect(sent.some((message) => message.type === 'characterSpritesLoaded')).toBe(true);
    expect(sent.some((message) => message.type === 'petSpritesLoaded')).toBe(true);
    expect(sent.some((message) => message.type === 'floorTilesLoaded')).toBe(true);
    expect(sent.some((message) => message.type === 'wallTilesLoaded')).toBe(true);
    expect(sent.some((message) => message.type === 'furnitureAssetsLoaded')).toBe(true);
    expect(sent).toContainEqual({ type: 'layoutLoaded', layout: { version: 1 } });
  });

  it('replays explicit default and active status, permission, poll, token, and tool values', () => {
    const store = new AgentStateStore();
    // #1: a REAL pending tool-permission gate (permissionSent still true).
    store.set(1, makeAgent(1, { permissionSent: true }));
    // #2: genuinely waiting FOR USER INPUT (idle_prompt).
    store.set(2, makeAgent(2, { awaitingInput: true }));
    // #3: mid-turn (active).
    store.set(
      3,
      makeAgent(3, {
        isWaiting: false,
        inputTokens: 12,
        outputTokens: 4,
        activeToolIds: new Set(['tool-3']),
        activeToolStatuses: new Map([['tool-3', 'Running tests']]),
        activeToolNames: new Map([['tool-3', 'Bash']]),
        activeSubagentToolIds: new Map([['tool-3', new Set(['sub-3'])]]),
        activeSubagentToolNames: new Map([['tool-3', new Map([['sub-3', 'review']])]]),
      }),
    );
    // #4: plain done/waiting — defaults must still be sent explicitly.
    store.set(4, makeAgent(4));

    const sent: Record<string, unknown>[] = [];
    handleClientMessage({ type: 'webviewReady' }, (m) => sent.push(m), { store, cache: null });

    const statuses = sent.filter((m) => m.type === 'agentStatus');
    const permissions = sent.filter(
      (m) => m.type === 'agentToolPermission' || m.type === 'agentToolPermissionClear',
    );
    const polls = sent.filter((m) => m.type === 'agentPollState');

    expect(permissions).toEqual([
      { type: 'agentToolPermission', id: 1 },
      { type: 'agentToolPermissionClear', id: 2 },
      { type: 'agentToolPermissionClear', id: 3 },
      { type: 'agentToolPermissionClear', id: 4 },
    ]);
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
    expect(statuses).toContainEqual({
      type: 'agentStatus',
      id: 4,
      status: 'waiting',
      awaitingInput: false,
    });
    expect(statuses).toContainEqual({
      type: 'agentStatus',
      id: 1,
      status: 'waiting',
      awaitingInput: false,
    });
    expect(polls).toHaveLength(4);
    expect(polls).toContainEqual({
      type: 'agentPollState',
      id: 4,
      state: undefined,
      waitingFor: undefined,
      ageMs: undefined,
    });
    expect(sent).toContainEqual({
      type: 'agentTokenUsage',
      id: 3,
      inputTokens: 12,
      outputTokens: 4,
    });
    expect(sent).toContainEqual({
      type: 'agentToolStart',
      id: 3,
      toolId: 'tool-3',
      status: 'Running tests',
      toolName: 'Bash',
      runInBackground: false,
    });
    expect(sent).toContainEqual({
      type: 'subagentToolStart',
      id: 3,
      parentToolId: 'tool-3',
      toolId: 'sub-3',
      status: 'Subtask: review',
    });
  });
});

describe('requestDiagnostics', () => {
  it('returns the shared agent diagnostic snapshot on the standalone message path', () => {
    const projectDir = path.join(tmpBase, 'project');
    const jsonlFile = path.join(projectDir, 'session.jsonl');
    fs.mkdirSync(projectDir);
    fs.writeFileSync(jsonlFile, 'one\ntwo\n');
    const store = new AgentStateStore();
    store.set(
      7,
      makeAgent(7, {
        projectDir,
        jsonlFile,
        fileOffset: 4,
        lastDataAt: 123_456,
        linesProcessed: 2,
      }),
    );
    const sent: Record<string, unknown>[] = [];

    handleClientMessage({ type: 'requestDiagnostics' }, (message) => sent.push(message), {
      store,
      cache: null,
    });

    expect(sent).toEqual([
      {
        type: 'agentDiagnostics',
        agents: [
          {
            id: 7,
            projectDir,
            projectDirExists: true,
            jsonlFile,
            jsonlExists: true,
            fileSize: 8,
            fileOffset: 4,
            lastDataAt: 123_456,
            linesProcessed: 2,
          },
        ],
      },
    ]);
  });
});
