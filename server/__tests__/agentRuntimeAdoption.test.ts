import { describe, expect, it } from 'vitest';

import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';

function confirmTextSession(
  runtime: AgentRuntime,
  sessionId: string,
  managedLaunch: boolean,
): void {
  runtime.handleHookEvent('claude', {
    hook_event_name: 'SessionStart',
    session_id: sessionId,
    source: 'startup',
    cwd: '/untracked/managed-project',
    __managedLaunch: managedLaunch,
  });
  runtime.handleHookEvent('claude', {
    hook_event_name: 'UserPromptSubmit',
    session_id: sessionId,
    __managedLaunch: managedLaunch,
  });
}

describe('AgentRuntime external adoption provenance', () => {
  it('bypasses the tracked-directory gate for a War Room-managed launch', () => {
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store, claudeProvider);
    confirmTextSession(runtime, 'managed-session', true);
    expect([...store.values()].map((agent) => agent.sessionId)).toContain('managed-session');
    runtime.dispose();
  });

  it('rejects an untracked local session without recursively dispatching it', () => {
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store, claudeProvider);
    confirmTextSession(runtime, 'unmanaged-session', false);
    expect(store.size).toBe(0);
    runtime.dispose();
  });
});
