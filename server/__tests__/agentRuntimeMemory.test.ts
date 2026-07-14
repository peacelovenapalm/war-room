import { beforeEach, describe, expect, it, vi } from 'vitest';

const { distillFromSessionEndMock } = vi.hoisted(() => ({
  distillFromSessionEndMock: vi.fn(() => ({ outcome: 'disabled', receiptId: null })),
}));

vi.mock('../src/memoryDistiller.js', () => ({
  distillFromSessionEnd: distillFromSessionEndMock,
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
  distillFromSessionEndMock.mockClear();
});

describe('AgentRuntime V7/V8 session-end trigger', () => {
  it('manifest/stale removal distills before the agent disappears', () => {
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store, claudeProvider);
    store.set(1, makeAgent());
    runtime.removeAgent(1);
    expect(distillFromSessionEndMock).toHaveBeenCalledOnce();
    expect(distillFromSessionEndMock).toHaveBeenCalledWith({
      sessionId: 'session-memory-trigger',
      transcriptPath: '/tmp/session-memory-trigger.jsonl',
      model: 'deterministic-v1',
      clientDistill: undefined,
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
    expect(distillFromSessionEndMock).toHaveBeenCalledOnce();
    expect(store.has(1)).toBe(false);
    runtime.dispose();
  });

  it('passes a client-distilled note from the SessionEnd hook payload through to distillFromSessionEnd', () => {
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store, claudeProvider);
    store.set(1, makeAgent());
    runtime.registerAgent('session-memory-trigger', 1);
    const note = {
      sessionId: 'session-memory-trigger',
      date: '2026-07-13',
      model: 'deterministic-v1',
      distilledAt: '2026-07-13T12:00:00.000Z',
      confidence: 'EXTRACTED',
      decisions: [],
      facts: [],
      openThreads: [],
      links: [],
    };
    runtime.handleHookEvent('claude', {
      hook_event_name: 'SessionEnd',
      session_id: 'session-memory-trigger',
      reason: 'exit',
      distilledNote: note,
    });
    expect(distillFromSessionEndMock).toHaveBeenCalledOnce();
    expect(distillFromSessionEndMock).toHaveBeenCalledWith({
      sessionId: 'session-memory-trigger',
      transcriptPath: '/tmp/session-memory-trigger.jsonl',
      model: 'deterministic-v1',
      clientDistill: {
        distilledNote: note,
        distillSkipped: undefined,
        distillFailed: undefined,
        distillFailReason: undefined,
      },
    });
    runtime.dispose();
  });
});
