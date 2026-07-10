/**
 * Pure agent-state reducer over the real server WS plane, typed by the
 * core/ GENERATED message bindings (asyncapi.yaml is the source of truth —
 * hard rule 11; this workspace only imports, never edits).
 *
 * One-tap-real groundwork: everything here is a verbatim mirror of server
 * messages — no synthesized states. Until a live agentStatus arrives an
 * agent shows WAITING (the conservative truth), never a guessed ACTIVE.
 */

import type { ServerMessage } from '../../../core/src/messages.js';
import type { Occupant } from '../engine/world';

export interface AgentRecord {
  id: number;
  name: string;
  machine?: string;
  provider?: string;
  status: 'active' | 'waiting';
  awaitingInput: boolean;
}

export type AgentMap = ReadonlyMap<number, AgentRecord>;

export const EMPTY_AGENTS: AgentMap = new Map<number, AgentRecord>();

function fallbackName(id: number): string {
  return `AGENT ${String(id)}`;
}

/**
 * Reduce one server message into the agent map. Returns the SAME reference
 * when the message is irrelevant, so React state updates stay cheap.
 */
export function reduceAgents(agents: AgentMap, message: ServerMessage): AgentMap {
  switch (message.type) {
    case 'existingAgents': {
      const next = new Map<number, AgentRecord>();
      for (const id of message.agents) {
        const key = String(id);
        next.set(id, {
          id,
          name: message.folderNames[key] ?? fallbackName(id),
          machine: message.machines?.[key],
          provider: message.providers?.[key],
          status: 'waiting',
          awaitingInput: false,
        });
      }
      return next;
    }
    case 'agentCreated': {
      const next = new Map(agents);
      next.set(message.id, {
        id: message.id,
        name: message.folderName ?? fallbackName(message.id),
        machine: message.machine,
        provider: message.provider,
        status: 'waiting',
        awaitingInput: false,
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
    default:
      return agents;
  }
}

const NAME_MAX = 14;

/**
 * Desk occupants in ascending-id order (deterministic seat assignment).
 * Status is shape + word (colorblind hard rule): ✋ INPUT beats the base
 * ▶ ACTIVE / ⏸ WAITING because a human answer is the scarcer resource.
 */
export function toOccupants(agents: AgentMap): Occupant[] {
  return [...agents.values()]
    .sort((a, b) => a.id - b.id)
    .map((agent) => {
      const name =
        agent.name.length > NAME_MAX ? `${agent.name.slice(0, NAME_MAX - 1)}…` : agent.name;
      if (agent.awaitingInput) {
        return { name, statusGlyph: '✋', statusWord: 'INPUT' };
      }
      if (agent.status === 'active') {
        return { name, statusGlyph: '▶', statusWord: 'ACTIVE' };
      }
      return { name, statusGlyph: '⏸', statusWord: 'WAITING' };
    });
}
