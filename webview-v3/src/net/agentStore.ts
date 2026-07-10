/**
 * Pure agent-state reducer over the real server WS plane, typed by the
 * core/ GENERATED message bindings (asyncapi.yaml is the source of truth —
 * hard rule 11; this workspace only imports, never edits).
 *
 * One-tap-real groundwork: everything here is a verbatim mirror of server
 * messages — no synthesized states. Until live telemetry arrives an agent
 * shows WAITING (the conservative truth), never a guessed WORKING.
 *
 * Stage 2 expands the record to the full v1 drawer fact set: identity
 * (machine/provider/sessionId/cwd/pid), poll state (blocked/failed/stopped
 * + waitingFor + server-anchored transition time), tool-permission flag,
 * and token spend.
 */

import type { AgentPollStateValue, ServerMessage } from '../../../core/src/messages.js';
import type { Occupant } from '../engine/world';
import { deriveVisualState, STATE_CHIPS } from '../state/visualState';

/** Poll-driven state snapshot (needs-input poller via /api/agents/poll). */
export interface AgentPollSnapshot {
  state: AgentPollStateValue;
  waitingFor?: string;
  /** Epoch ms when the transition happened — server-anchored (receipt time
   *  minus the reported ageMs), so crisis ages are real, never client-made. */
  since: number;
  /** Epoch ms this snapshot arrived (freshness TTL — visualState.ts). */
  receivedAt: number;
  /** Server marked the poll row stale (poller silent too long). */
  stale: boolean;
}

export interface AgentRecord {
  id: number;
  name: string;
  machine?: string;
  provider?: string;
  sessionId?: string;
  cwd?: string;
  pid?: number;
  status: 'active' | 'waiting';
  awaitingInput: boolean;
  /** agentToolPermission … agentToolPermissionClear window. */
  toolPermission: boolean;
  poll?: AgentPollSnapshot;
  inputTokens: number;
  outputTokens: number;
}

export type AgentMap = ReadonlyMap<number, AgentRecord>;

export const EMPTY_AGENTS: AgentMap = new Map<number, AgentRecord>();

function fallbackName(id: number): string {
  return `AGENT ${String(id)}`;
}

function baseRecord(id: number, name: string): AgentRecord {
  return {
    id,
    name,
    status: 'waiting',
    awaitingInput: false,
    toolPermission: false,
    inputTokens: 0,
    outputTokens: 0,
  };
}

/** Identity TEXT for board rows / debris labels: "#id [MACHINE] name". */
export function agentIdentity(record: Pick<AgentRecord, 'id' | 'machine' | 'name'>): string {
  return `#${String(record.id)} [${record.machine ?? 'LOCAL'}] ${record.name}`;
}

/**
 * Reduce one server message into the agent map. Returns the SAME reference
 * when the message is irrelevant, so React state updates stay cheap.
 * `now` anchors poll ages (epoch ms) — injected for testability.
 */
export function reduceAgents(agents: AgentMap, message: ServerMessage, now = Date.now()): AgentMap {
  switch (message.type) {
    case 'existingAgents': {
      const next = new Map<number, AgentRecord>();
      for (const id of message.agents) {
        const key = String(id);
        next.set(id, {
          ...baseRecord(id, message.folderNames[key] ?? fallbackName(id)),
          machine: message.machines?.[key],
          provider: message.providers?.[key],
          sessionId: message.sessionIds?.[key],
          cwd: message.cwds?.[key],
          pid: message.pids?.[key],
        });
      }
      return next;
    }
    case 'agentCreated': {
      const next = new Map(agents);
      next.set(message.id, {
        ...baseRecord(message.id, message.folderName ?? fallbackName(message.id)),
        machine: message.machine,
        provider: message.provider,
        sessionId: message.sessionId,
        cwd: message.cwd,
        pid: message.pid,
      });
      return next;
    }
    case 'agentClosed': {
      if (!agents.has(message.id)) return agents;
      const next = new Map(agents);
      next.delete(message.id);
      return next;
    }
    case 'agentStatus': {
      const existing = agents.get(message.id);
      if (!existing) return agents;
      const next = new Map(agents);
      next.set(message.id, {
        ...existing,
        status: message.status,
        awaitingInput: message.awaitingInput ?? false,
      });
      return next;
    }
    case 'agentPollState': {
      const existing = agents.get(message.id);
      if (!existing) return agents;
      const next = new Map(agents);
      next.set(message.id, {
        ...existing,
        poll:
          message.state === undefined
            ? undefined
            : {
                state: message.state,
                waitingFor: message.waitingFor,
                since: now - (message.ageMs ?? 0),
                receivedAt: now,
                stale: message.stale ?? false,
              },
      });
      return next;
    }
    case 'agentTokenUsage': {
      const existing = agents.get(message.id);
      if (!existing) return agents;
      const next = new Map(agents);
      next.set(message.id, {
        ...existing,
        inputTokens: message.inputTokens,
        outputTokens: message.outputTokens,
      });
      return next;
    }
    case 'agentPidUpdate': {
      const existing = agents.get(message.id);
      if (!existing) return agents;
      const next = new Map(agents);
      next.set(message.id, { ...existing, pid: message.pid });
      return next;
    }
    case 'agentToolPermission': {
      const existing = agents.get(message.id);
      if (!existing || existing.toolPermission) return agents;
      const next = new Map(agents);
      next.set(message.id, { ...existing, toolPermission: true });
      return next;
    }
    case 'agentToolPermissionClear': {
      const existing = agents.get(message.id);
      if (!existing || !existing.toolPermission) return agents;
      const next = new Map(agents);
      next.set(message.id, { ...existing, toolPermission: false });
      return next;
    }
    default:
      return agents;
  }
}

const NAME_MAX = 14;

/** Agents in ascending-id order (deterministic seat assignment). */
export function sortedAgents(agents: AgentMap): AgentRecord[] {
  return [...agents.values()].sort((a, b) => a.id - b.id);
}

/**
 * Desk occupants in ascending-id order. Status is shape + word from the
 * shared STATE_CHIPS vocabulary (colorblind hard rule) — the same chip the
 * drawer and pin dock show, so one state never has two names.
 */
export function toOccupants(agents: AgentMap, now = Date.now()): Occupant[] {
  return sortedAgents(agents).map((agent) => {
    const name =
      agent.name.length > NAME_MAX ? `${agent.name.slice(0, NAME_MAX - 1)}…` : agent.name;
    const chip = STATE_CHIPS[deriveVisualState(agent, now)];
    return {
      agentId: agent.id,
      name,
      statusGlyph: chip.glyph,
      statusWord: chip.label,
      loud: chip.loud,
    };
  });
}
