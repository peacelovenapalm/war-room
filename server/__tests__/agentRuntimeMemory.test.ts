import { beforeEach, describe, expect, it, vi } from 'vitest';

const { distillEndedSessionMock } = vi.hoisted(() => ({
  distillEndedSessionMock: vi.fn(() => ({ outcome: 'disabled', receiptId: null })),
}));

vi.mock('../src/memoryDistiller.js', () => ({
  distillEndedSession: distillEndedSessionMock,
}));

import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import type { AgentState } from '../src/types.js';

function makeAgent(isExternal = true): AgentState {
  return {
    id: 1,
    sessionId: 'session-memory-trigger',
    isExternal,
    projectDir: '/tmp/project',
    jsonlFile: '/tmp/session-memory-trigger.jsonl',
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
  };
}

beforeEach(() => {
  distillEndedSessionMock.mockClear();
});

describe('AgentRuntime V7 session-end trigger', () => {
  it('manifest/stale removal distills before the agent disappears', () => {
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store, claudeProvider);
    store.set(1, makeAgent());
    runtime.removeAgent(1);
    expect(distillEndedSessionMock).toHaveBeenCalledOnce();
    expect(distillEndedSessionMock).toHaveBeenCalledWith({
      sessionId: 'session-memory-trigger',
      transcriptPath: '/tmp/session-memory-trigger.jsonl',
      model: 'deterministic-v1',
    });
    expect(store.has(1)).toBe(false);
    runtime.dispose();
  });

  it('dedupes hook SessionEnd followed by the external-agent removal path', () => {
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store, claudeProvider);
    store.set(1, makeAgent());
    runtime.registerAgent('session-memory-trigger', 1);
    runtime.handleHookEvent('claude', {
      hook_event_name: 'SessionEnd',
      session_id: 'session-memory-trigger',
      reason: 'exit',
    });
    expect(distillEndedSessionMock).toHaveBeenCalledOnce();
    expect(store.has(1)).toBe(false);
    runtime.dispose();
  });
});
