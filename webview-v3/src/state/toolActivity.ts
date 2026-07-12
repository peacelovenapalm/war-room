/**
 * T1c (FACE-MERGE-PLAN.md) — live tool-call / subagent activity, ported
 * from webview-ui's canvas-character rendering into a pure v3 fact store.
 * Consumes the SAME wire messages the old face used (`agentToolStart` /
 * `agentToolDone` / `agentToolsClear` / `subagentToolStart` /
 * `subagentToolDone` / `subagentClear` / `subagentToolPermission` —
 * server/src/hookEventHandler.ts already broadcasts all seven; this store
 * only reads them) — no new server types, no server-side change.
 *
 * This is ambient telemetry, not a log: each agent keeps its CURRENT tool
 * (name + start time + background flag) plus a capped tail of recently
 * completed tool names. Nothing here is a full transcript — FloorFeed/
 * TailSheet already own that job.
 */

import type { ServerMessage } from '../../../core/src/messages.js';

/** Cap on retained completed-tool history per agent/subagent — ambient
 *  telemetry, not a log. */
export const RECENT_TOOLS_MAX = 3;

/** Map status-string prefixes back to tool names for messages that omit
 *  `toolName` (background-tool re-announce on turn-end restore never
 *  includes it — server/src/transcriptParser.ts:407, timerManager.ts:43).
 *  Mirrors webview-ui/src/office/toolUtils.ts's STATUS_TO_TOOL table so the
 *  two faces show the same name for the same status text; duplicated
 *  rather than imported (workspaces don't cross — hard rule: webview-v3
 *  never imports webview-ui). */
const STATUS_TO_TOOL: Record<string, string> = {
  Reading: 'Read',
  Searching: 'Grep',
  Globbing: 'Glob',
  Fetching: 'WebFetch',
  'Searching web': 'WebSearch',
  Writing: 'Write',
  Editing: 'Edit',
  Running: 'Bash',
  Task: 'Task',
};

/** Recover a tool name from a status string when the message carries no
 *  explicit `toolName` field. Never returns empty — an unrecognized status
 *  still yields its own first token, which is honest (the real status
 *  text), never a fabricated placeholder. */
export function deriveToolName(status: string): string {
  for (const [prefix, tool] of Object.entries(STATUS_TO_TOOL)) {
    if (status.startsWith(prefix)) return tool;
  }
  const first = status.split(/[\s:]/)[0];
  return first || status;
}

export interface ActiveTool {
  toolId: string;
  name: string;
  startedAt: number;
  runInBackground: boolean;
}

/** One subagent's own activity, keyed by its parent tool's id (the same
 *  id the server uses to correlate subagentToolStart/Done/Clear — stable
 *  for the subagent's lifetime). */
export interface SubagentToolActivity {
  /** == parentToolId; kept on the record itself so callers rendering a
   *  flattened list don't need the map key threaded separately. */
  id: string;
  /** Ordered oldest→newest; the LAST entry is "current" (see
   *  currentActiveTool below) — a subagent only ever has one tool call
   *  outstanding at a time in practice, but the ordering survives even if
   *  that assumption is ever violated. */
  active: readonly ActiveTool[];
  recentDone: readonly string[];
  /** True between subagentToolPermission and this subagent's next
   *  start/done — a permission prompt has no toolId of its own to key
   *  off, so this is the honest amount of state worth keeping for it. */
  permissionWait: boolean;
}

export interface AgentToolActivity {
  active: readonly ActiveTool[];
  recentDone: readonly string[];
  /** Keyed by parentToolId (== SubagentToolActivity.id). */
  subagents: ReadonlyMap<string, SubagentToolActivity>;
}

export type ToolActivityMap = ReadonlyMap<number, AgentToolActivity>;

export const EMPTY_TOOL_ACTIVITY: ToolActivityMap = new Map();

const EMPTY_AGENT_ACTIVITY: AgentToolActivity = {
  active: [],
  recentDone: [],
  subagents: new Map(),
};

/** The tool currently running, if any — the last-started entry still in
 *  `active`. Shared shape for both agent- and subagent-level activity. */
export function currentActiveTool(
  activity: Pick<AgentToolActivity, 'active'> | Pick<SubagentToolActivity, 'active'> | undefined,
): ActiveTool | undefined {
  if (!activity || activity.active.length === 0) return undefined;
  return activity.active[activity.active.length - 1];
}

function pushRecent(recent: readonly string[], name: string): readonly string[] {
  const next = [...recent, name];
  return next.length > RECENT_TOOLS_MAX ? next.slice(next.length - RECENT_TOOLS_MAX) : next;
}

/**
 * Reduce one server message into the tool-activity map. Returns the SAME
 * reference when the message is irrelevant (matches net/agentStore.ts's
 * reduceAgents convention so React state updates stay cheap).
 *
 * Unknown-agent tolerance: `agentToolStart` creates a fresh record for an
 * id this store hasn't seen yet (the agent roster and this store are
 * reduced independently off the same WS stream — order between
 * `existingAgents`/`agentCreated` and the first tool event isn't
 * guaranteed). Every OTHER message type (`Done`/`Clear`/`Permission`) is a
 * no-op against an unknown agent — there is nothing to update, and
 * fabricating a record from a teardown message would be dishonest.
 */
export function reduceToolActivity(
  agents: ToolActivityMap,
  message: ServerMessage,
  now = Date.now(),
): ToolActivityMap {
  switch (message.type) {
    case 'agentToolStart': {
      const existing = agents.get(message.id) ?? EMPTY_AGENT_ACTIVITY;
      if (existing.active.some((t) => t.toolId === message.toolId)) return agents;
      const name = message.toolName ?? deriveToolName(message.status);
      const entry: ActiveTool = {
        toolId: message.toolId,
        name,
        startedAt: now,
        runInBackground: message.runInBackground ?? false,
      };
      const next = new Map(agents);
      next.set(message.id, { ...existing, active: [...existing.active, entry] });
      return next;
    }
    case 'agentToolDone': {
      const existing = agents.get(message.id);
      if (!existing) return agents;
      const tool = existing.active.find((t) => t.toolId === message.toolId);
      if (!tool) return agents;
      const next = new Map(agents);
      next.set(message.id, {
        ...existing,
        active: existing.active.filter((t) => t.toolId !== message.toolId),
        recentDone: pushRecent(existing.recentDone, tool.name),
      });
      return next;
    }
    case 'agentToolsClear': {
      const existing = agents.get(message.id);
      if (!existing) return agents;
      if (existing.active.length === 0 && existing.subagents.size === 0) return agents;
      const next = new Map(agents);
      // Turn-end clear: drop in-flight tools (any still-running background
      // tool is re-announced via a fresh agentToolStart right after this,
      // server-side — see transcriptParser.ts/timerManager.ts) and the
      // subagent map (subagents only exist for within-turn Task/Agent
      // subtasks, which end with their parent's turn).
      next.set(message.id, { ...existing, active: [], subagents: new Map() });
      return next;
    }
    case 'subagentToolStart': {
      const existing = agents.get(message.id);
      if (!existing) return agents;
      const parent = existing.subagents.get(message.parentToolId) ?? {
        id: message.parentToolId,
        active: [],
        recentDone: [],
        permissionWait: false,
      };
      if (parent.active.some((t) => t.toolId === message.toolId)) return agents;
      const entry: ActiveTool = {
        toolId: message.toolId,
        name: deriveToolName(message.status),
        startedAt: now,
        runInBackground: false,
      };
      const nextParent: SubagentToolActivity = {
        ...parent,
        active: [...parent.active, entry],
        permissionWait: false,
      };
      const nextSubagents = new Map(existing.subagents);
      nextSubagents.set(message.parentToolId, nextParent);
      const next = new Map(agents);
      next.set(message.id, { ...existing, subagents: nextSubagents });
      return next;
    }
    case 'subagentToolDone': {
      const existing = agents.get(message.id);
      const parent = existing?.subagents.get(message.parentToolId);
      if (!existing || !parent) return agents;
      const tool = parent.active.find((t) => t.toolId === message.toolId);
      if (!tool) return agents;
      const nextParent: SubagentToolActivity = {
        ...parent,
        active: parent.active.filter((t) => t.toolId !== message.toolId),
        recentDone: pushRecent(parent.recentDone, tool.name),
      };
      const nextSubagents = new Map(existing.subagents);
      nextSubagents.set(message.parentToolId, nextParent);
      const next = new Map(agents);
      next.set(message.id, { ...existing, subagents: nextSubagents });
      return next;
    }
    case 'subagentClear': {
      const existing = agents.get(message.id);
      if (!existing || !existing.subagents.has(message.parentToolId)) return agents;
      const nextSubagents = new Map(existing.subagents);
      nextSubagents.delete(message.parentToolId);
      const next = new Map(agents);
      next.set(message.id, { ...existing, subagents: nextSubagents });
      return next;
    }
    case 'subagentToolPermission': {
      const existing = agents.get(message.id);
      const parent = existing?.subagents.get(message.parentToolId);
      if (!existing || !parent || parent.permissionWait) return agents;
      const nextSubagents = new Map(existing.subagents);
      nextSubagents.set(message.parentToolId, { ...parent, permissionWait: true });
      const next = new Map(agents);
      next.set(message.id, { ...existing, subagents: nextSubagents });
      return next;
    }
    default:
      return agents;
  }
}

/** Subagents in a stable order for rendering (insertion order is already
 *  spawn order; re-exported as an array so components don't need to know
 *  the map is the storage detail). */
export function sortedSubagents(activity: AgentToolActivity | undefined): SubagentToolActivity[] {
  if (!activity) return [];
  return [...activity.subagents.values()];
}

/**
 * Rising-edge diff: agents whose CURRENT tool NAME changed since the last
 * snapshot — i.e. a genuinely new tool started, not a repeat of the same
 * tool nor a name-preserving active/inactive toggle. This is the ONE
 * signal speech bubbles / FloorFeed lines key off (rate-limit: bubble on
 * tool-name change, never on every call) — pure diff, unit-testable
 * without a rendering harness (same convention as
 * state/speechBubbles.ts's detectNewlyLoudAgents).
 */
export function detectToolNameChanges(
  prevNames: ReadonlyMap<number, string | undefined>,
  next: ToolActivityMap,
): { agentId: number; toolName: string }[] {
  const out: { agentId: number; toolName: string }[] = [];
  for (const [agentId, activity] of next) {
    const name = currentActiveTool(activity)?.name;
    if (name === undefined) continue;
    if (prevNames.get(agentId) !== name) out.push({ agentId, toolName: name });
  }
  return out;
}

/** Current id→current-tool-name snapshot — callers carry this forward as
 *  next tick's `prevNames` for detectToolNameChanges. */
export function toolNameSnapshot(agents: ToolActivityMap): Map<number, string | undefined> {
  const snapshot = new Map<number, string | undefined>();
  for (const [agentId, activity] of agents)
    snapshot.set(agentId, currentActiveTool(activity)?.name);
  return snapshot;
}
