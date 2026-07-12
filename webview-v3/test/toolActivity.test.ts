import { describe, expect, it } from 'vitest';

import type { ServerMessage } from '../../core/src/messages.js';
import {
  currentActiveTool,
  deriveToolName,
  detectToolNameChanges,
  EMPTY_TOOL_ACTIVITY,
  RECENT_TOOLS_MAX,
  reduceToolActivity,
  sortedSubagents,
  toolNameSnapshot,
  type ToolActivityMap,
} from '../src/state/toolActivity';

function start(overrides: Partial<Extract<ServerMessage, { type: 'agentToolStart' }>> = {}) {
  return {
    type: 'agentToolStart' as const,
    id: 1,
    toolId: 't1',
    status: 'Reading foo.ts',
    ...overrides,
  };
}

function done(overrides: Partial<Extract<ServerMessage, { type: 'agentToolDone' }>> = {}) {
  return { type: 'agentToolDone' as const, id: 1, toolId: 't1', ...overrides };
}

function clear(overrides: Partial<Extract<ServerMessage, { type: 'agentToolsClear' }>> = {}) {
  return { type: 'agentToolsClear' as const, id: 1, ...overrides };
}

function subStart(overrides: Partial<Extract<ServerMessage, { type: 'subagentToolStart' }>> = {}) {
  return {
    type: 'subagentToolStart' as const,
    id: 1,
    parentToolId: 'p1',
    toolId: 's1',
    status: 'Editing bar.ts',
    ...overrides,
  };
}

function subDone(overrides: Partial<Extract<ServerMessage, { type: 'subagentToolDone' }>> = {}) {
  return {
    type: 'subagentToolDone' as const,
    id: 1,
    parentToolId: 'p1',
    toolId: 's1',
    ...overrides,
  };
}

function subClear(overrides: Partial<Extract<ServerMessage, { type: 'subagentClear' }>> = {}) {
  return { type: 'subagentClear' as const, id: 1, parentToolId: 'p1', ...overrides };
}

function subPermission(
  overrides: Partial<Extract<ServerMessage, { type: 'subagentToolPermission' }>> = {},
) {
  return { type: 'subagentToolPermission' as const, id: 1, parentToolId: 'p1', ...overrides };
}

describe('deriveToolName', () => {
  it('maps a known status prefix to its tool name', () => {
    expect(deriveToolName('Reading src/App.tsx')).toBe('Read');
    expect(deriveToolName('Running npm test')).toBe('Bash');
    expect(deriveToolName('Task: spawn scout')).toBe('Task');
  });

  it('falls back to the first token for an unrecognized status, never empty', () => {
    expect(deriveToolName('MysteryVerb: something')).toBe('MysteryVerb');
    expect(deriveToolName('')).toBe('');
  });
});

describe('reduceToolActivity — agentToolStart/Done/Clear ordering', () => {
  it('start creates a current tool, using the explicit toolName when present', () => {
    const next = reduceToolActivity(EMPTY_TOOL_ACTIVITY, start({ toolName: 'Read' }), 1000);
    const current = currentActiveTool(next.get(1));
    expect(current).toEqual({
      toolId: 't1',
      name: 'Read',
      startedAt: 1000,
      runInBackground: false,
    });
  });

  it('start derives the name from status when toolName is omitted (background re-announce shape)', () => {
    const next = reduceToolActivity(EMPTY_TOOL_ACTIVITY, start({ status: 'Editing x.ts' }), 1000);
    expect(currentActiveTool(next.get(1))?.name).toBe('Edit');
  });

  it('carries runInBackground through', () => {
    const next = reduceToolActivity(
      EMPTY_TOOL_ACTIVITY,
      start({ toolName: 'Bash', runInBackground: true }),
      1000,
    );
    expect(currentActiveTool(next.get(1))?.runInBackground).toBe(true);
  });

  it('ignores a duplicate start for the same toolId (returns same reference)', () => {
    const once = reduceToolActivity(EMPTY_TOOL_ACTIVITY, start({ toolName: 'Read' }), 1000);
    const twice = reduceToolActivity(once, start({ toolName: 'Read' }), 2000);
    expect(twice).toBe(once);
  });

  it('a SECOND concurrent tool becomes current; done falls back to the first', () => {
    let agents: ToolActivityMap = EMPTY_TOOL_ACTIVITY;
    agents = reduceToolActivity(agents, start({ toolId: 't1', toolName: 'Read' }), 1000);
    agents = reduceToolActivity(
      agents,
      start({ toolId: 't2', toolName: 'Bash', runInBackground: true }),
      1500,
    );
    expect(currentActiveTool(agents.get(1))?.name).toBe('Bash');
    agents = reduceToolActivity(agents, done({ toolId: 't2' }), 2000);
    expect(currentActiveTool(agents.get(1))?.name).toBe('Read');
    expect(agents.get(1)?.recentDone).toEqual(['Bash']);
  });

  it('done removes the matching tool and appends its name to recentDone, capped at RECENT_TOOLS_MAX', () => {
    let agents: ToolActivityMap = EMPTY_TOOL_ACTIVITY;
    const names = ['Read', 'Grep', 'Glob', 'Write'];
    names.forEach((name, i) => {
      agents = reduceToolActivity(agents, start({ toolId: `t${String(i)}`, toolName: name }), i);
      agents = reduceToolActivity(agents, done({ toolId: `t${String(i)}` }), i + 1);
    });
    expect(currentActiveTool(agents.get(1))).toBeUndefined();
    expect(agents.get(1)?.recentDone).toHaveLength(RECENT_TOOLS_MAX);
    // Oldest ('Read') dropped, most recent 3 kept in order.
    expect(agents.get(1)?.recentDone).toEqual(['Grep', 'Glob', 'Write']);
  });

  it('done for an unknown toolId on a known agent is a no-op (same reference)', () => {
    const started = reduceToolActivity(EMPTY_TOOL_ACTIVITY, start({ toolName: 'Read' }), 1000);
    const next = reduceToolActivity(started, done({ toolId: 'nope' }), 2000);
    expect(next).toBe(started);
  });

  it('agentToolsClear drops all active tools and the subagent map', () => {
    let agents: ToolActivityMap = EMPTY_TOOL_ACTIVITY;
    agents = reduceToolActivity(agents, start({ toolName: 'Read' }), 1000);
    agents = reduceToolActivity(agents, subStart(), 1100);
    agents = reduceToolActivity(agents, clear(), 2000);
    expect(currentActiveTool(agents.get(1))).toBeUndefined();
    expect(sortedSubagents(agents.get(1))).toEqual([]);
  });

  it('agentToolsClear on an agent with nothing tracked is a no-op (same reference)', () => {
    const empty = reduceToolActivity(EMPTY_TOOL_ACTIVITY, start({ toolName: 'Read' }), 1000);
    const cleared = reduceToolActivity(empty, clear(), 2000);
    const clearedAgain = reduceToolActivity(cleared, clear(), 3000);
    expect(clearedAgain).toBe(cleared);
  });
});

describe('reduceToolActivity — subagentToolStart/Done/Clear/Permission', () => {
  it('subagentToolStart is a no-op for an agent this store has never seen (unknown-agent tolerance)', () => {
    const next = reduceToolActivity(EMPTY_TOOL_ACTIVITY, subStart(), 1000);
    expect(next).toBe(EMPTY_TOOL_ACTIVITY);
  });

  it('subagentToolStart creates the subagent bucket once the parent agent exists', () => {
    let agents: ToolActivityMap = EMPTY_TOOL_ACTIVITY;
    agents = reduceToolActivity(agents, start({ toolName: 'Task' }), 1000);
    agents = reduceToolActivity(agents, subStart(), 1100);
    const subs = sortedSubagents(agents.get(1));
    expect(subs).toHaveLength(1);
    expect(subs[0].id).toBe('p1');
    expect(currentActiveTool(subs[0])?.name).toBe('Edit');
  });

  it('subagentToolDone clears the subagent current tool and records recentDone', () => {
    let agents: ToolActivityMap = EMPTY_TOOL_ACTIVITY;
    agents = reduceToolActivity(agents, start({ toolName: 'Task' }), 1000);
    agents = reduceToolActivity(agents, subStart(), 1100);
    agents = reduceToolActivity(agents, subDone(), 1200);
    const subs = sortedSubagents(agents.get(1));
    expect(currentActiveTool(subs[0])).toBeUndefined();
    expect(subs[0].recentDone).toEqual(['Edit']);
  });

  it('subagentClear removes the subagent bucket entirely', () => {
    let agents: ToolActivityMap = EMPTY_TOOL_ACTIVITY;
    agents = reduceToolActivity(agents, start({ toolName: 'Task' }), 1000);
    agents = reduceToolActivity(agents, subStart(), 1100);
    agents = reduceToolActivity(agents, subClear(), 1200);
    expect(sortedSubagents(agents.get(1))).toEqual([]);
  });

  it('subagentToolPermission marks permissionWait, cleared by the next start', () => {
    let agents: ToolActivityMap = EMPTY_TOOL_ACTIVITY;
    agents = reduceToolActivity(agents, start({ toolName: 'Task' }), 1000);
    agents = reduceToolActivity(agents, subStart(), 1100);
    agents = reduceToolActivity(agents, subDone(), 1150);
    agents = reduceToolActivity(agents, subPermission(), 1200);
    expect(sortedSubagents(agents.get(1))[0].permissionWait).toBe(true);
    agents = reduceToolActivity(
      agents,
      subStart({ toolId: 's2', status: 'Running npm build' }),
      1300,
    );
    expect(sortedSubagents(agents.get(1))[0].permissionWait).toBe(false);
  });

  it('subagentToolDone/Clear/Permission on an unknown parentToolId is a no-op (same reference)', () => {
    const withAgent = reduceToolActivity(EMPTY_TOOL_ACTIVITY, start({ toolName: 'Task' }), 1000);
    expect(reduceToolActivity(withAgent, subDone({ parentToolId: 'ghost' }), 2000)).toBe(withAgent);
    expect(reduceToolActivity(withAgent, subClear({ parentToolId: 'ghost' }), 2000)).toBe(
      withAgent,
    );
    expect(reduceToolActivity(withAgent, subPermission({ parentToolId: 'ghost' }), 2000)).toBe(
      withAgent,
    );
  });
});

describe('reduceToolActivity — unrelated messages', () => {
  it('returns the SAME reference for a message type it does not handle', () => {
    const msg: ServerMessage = { type: 'agentStatus', id: 1, status: 'active' };
    expect(reduceToolActivity(EMPTY_TOOL_ACTIVITY, msg)).toBe(EMPTY_TOOL_ACTIVITY);
  });
});

describe('detectToolNameChanges — rate-limit for speech bubbles/FloorFeed', () => {
  it('fires once when a tool starts, not again for a same-name second call', () => {
    let agents: ToolActivityMap = EMPTY_TOOL_ACTIVITY;
    let prev = toolNameSnapshot(agents);
    agents = reduceToolActivity(agents, start({ toolId: 't1', toolName: 'Read' }), 1000);
    let changes = detectToolNameChanges(prev, agents);
    expect(changes).toEqual([{ agentId: 1, toolName: 'Read' }]);
    prev = toolNameSnapshot(agents);

    // Done + a second Read call: name unchanged end-to-end, so no bubble.
    agents = reduceToolActivity(agents, done({ toolId: 't1' }), 1100);
    agents = reduceToolActivity(agents, start({ toolId: 't2', toolName: 'Read' }), 1200);
    changes = detectToolNameChanges(prev, agents);
    expect(changes).toEqual([]);
  });

  it('fires again when the tool name actually changes', () => {
    let agents: ToolActivityMap = EMPTY_TOOL_ACTIVITY;
    let prev = toolNameSnapshot(agents);
    agents = reduceToolActivity(agents, start({ toolId: 't1', toolName: 'Read' }), 1000);
    prev = toolNameSnapshot(agents);
    agents = reduceToolActivity(agents, done({ toolId: 't1' }), 1100);
    agents = reduceToolActivity(agents, start({ toolId: 't2', toolName: 'Bash' }), 1200);
    const changes = detectToolNameChanges(prev, agents);
    expect(changes).toEqual([{ agentId: 1, toolName: 'Bash' }]);
  });
});
