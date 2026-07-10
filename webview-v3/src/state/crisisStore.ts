/**
 * Crisis STATE (fires + debris) reduced from the live agent map — the v3
 * equivalent of webview-ui's per-character computeCrisisUpdate applied
 * across the whole roster in one pure pass.
 *
 * Anchoring rules (all real, hard rule 5):
 * - A needs-input fire keeps the EARLIEST honest anchor: the server's
 *   poll transition time when available, otherwise client first-seen.
 * - Debris spawns on the failed/stopped TRANSITION, captures identity TEXT
 *   at spawn (survives the agent despawning), and persists until ACKed or
 *   the agent recovers (keeping debris for a recovered agent would lie).
 * - Fires die with their agent (a closed session is no longer waiting);
 *   debris outlives its agent by design (cleanup is still owed).
 */

import { agentIdentity, type AgentMap } from '../net/agentStore';
import { AgentVisualState, deriveVisualState, freshPoll } from './visualState';

export interface FireRecord {
  /** Epoch ms when the blocked state began (server-anchored if poll-driven). */
  since: number;
}

export interface DebrisRecord {
  /** Stable key: `${agentId}:${kind}`. */
  key: string;
  agentId: number;
  kind: 'failed' | 'stopped';
  /** Identity TEXT captured at spawn time. */
  label: string;
  since: number;
}

export interface CrisisState {
  fires: ReadonlyMap<number, FireRecord>;
  debris: ReadonlyMap<string, DebrisRecord>;
  /** Previous visual state per live agent — transition edge detection. */
  lastState: ReadonlyMap<number, AgentVisualState>;
}

export const EMPTY_CRISIS_STATE: CrisisState = {
  fires: new Map(),
  debris: new Map(),
  lastState: new Map(),
};

export function debrisKey(agentId: number, kind: 'failed' | 'stopped'): string {
  return `${String(agentId)}:${kind}`;
}

/** One pure tick of the crisis state machine over the current roster. */
export function reduceCrisisState(prev: CrisisState, agents: AgentMap, now: number): CrisisState {
  const fires = new Map<number, FireRecord>();
  const debris = new Map(prev.debris);
  const lastState = new Map<number, AgentVisualState>();

  for (const [id, record] of agents) {
    const vState = deriveVisualState(record, now);
    const prevVState = prev.lastState.get(id);
    lastState.set(id, vState);

    if (vState === AgentVisualState.NEEDS_INPUT) {
      const poll = freshPoll(record, now);
      const anchor = poll?.state === 'blocked' ? poll.since : now;
      const existing = prev.fires.get(id);
      fires.set(id, { since: existing ? Math.min(existing.since, anchor) : anchor });
    }

    const wasDown =
      prevVState === AgentVisualState.FAILED || prevVState === AgentVisualState.STOPPED;
    if (vState === AgentVisualState.FAILED && prevVState !== AgentVisualState.FAILED) {
      const key = debrisKey(id, 'failed');
      if (!debris.has(key)) {
        debris.set(key, {
          key,
          agentId: id,
          kind: 'failed',
          label: agentIdentity(record),
          since: now,
        });
      }
    } else if (vState === AgentVisualState.STOPPED && prevVState !== AgentVisualState.STOPPED) {
      const key = debrisKey(id, 'stopped');
      if (!debris.has(key)) {
        debris.set(key, {
          key,
          agentId: id,
          kind: 'stopped',
          label: agentIdentity(record),
          since: now,
        });
      }
    } else if (
      wasDown &&
      vState !== AgentVisualState.FAILED &&
      vState !== AgentVisualState.STOPPED
    ) {
      // Recovered — the wreck cleaned itself up; keeping debris would lie.
      debris.delete(debrisKey(id, 'failed'));
      debris.delete(debrisKey(id, 'stopped'));
    }
  }

  return { fires, debris, lastState };
}

/** ACK commit — remove one debris record (the ackUndo window's terminal). */
export function acknowledgeDebris(state: CrisisState, key: string): CrisisState {
  if (!state.debris.has(key)) return state;
  const debris = new Map(state.debris);
  debris.delete(key);
  return { ...state, debris };
}

/** Open crisis rows right now (board count, mood chip, wing warns). */
export function openCrisisCount(state: CrisisState): number {
  return state.fires.size + state.debris.size;
}
