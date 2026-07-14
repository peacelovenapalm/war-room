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

import type { ServerMessage } from '../../../core/src/messages.js';
import { agentIdentity, type AgentMap } from '../net/agentStore';
import type { AckState } from './ackUndo';
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

  const firesUnchanged =
    fires.size === prev.fires.size &&
    [...fires].every(([id, fire]) => prev.fires.get(id)?.since === fire.since);
  const debrisUnchanged =
    debris.size === prev.debris.size &&
    [...debris].every(([key, record]) => prev.debris.get(key) === record);
  const lastStateUnchanged =
    lastState.size === prev.lastState.size &&
    [...lastState].every(([id, state]) => prev.lastState.get(id) === state);
  if (firesUnchanged && debrisUnchanged && lastStateUnchanged) return prev;
  return {
    fires: firesUnchanged ? prev.fires : fires,
    debris: debrisUnchanged ? prev.debris : debris,
    lastState: lastStateUnchanged ? prev.lastState : lastState,
  };
}

/**
 * `existingAgents` starts a reconnect telemetry epoch. Its deliberately empty
 * ephemeral fields are only a staging state until the server's explicit poll
 * replay arrives, so they must not be mistaken for a real agent recovery.
 */
export function reduceCrisisAfterAgentMessage(
  prev: CrisisState,
  agents: AgentMap,
  message: ServerMessage,
  now: number,
): CrisisState {
  return message.type === 'existingAgents' ? prev : reduceCrisisState(prev, agents, now);
}

export interface AckSweepResult {
  crisis: CrisisState;
  acks: AckState;
}

/**
 * One tick of the ACK-undo sweep, instance-aware (panel finding,
 * crisisStore.ts:47): a pending ack commits at window lapse ONLY against
 * the SAME debris instance it was aimed at (matched on `since`). An ack
 * whose debris was deleted (recovery) or replaced (a NEW failure reusing
 * the `agentId:kind` key) is dropped without touching the board — a
 * brand-new, never-acted-on crisis is never swept by a stale ack.
 * Same-reference returns on both maps when nothing changed.
 */
export function sweepAcks(crisis: CrisisState, acks: AckState, now: number): AckSweepResult {
  let nextCrisis = crisis;
  let acksChanged = false;
  const nextAcks = new Map(acks);
  for (const [key, pending] of acks) {
    const debris = crisis.debris.get(key);
    if (debris === undefined || debris.since !== pending.since) {
      nextAcks.delete(key);
      acksChanged = true;
      continue;
    }
    if (now >= pending.undoUntil) {
      nextCrisis = acknowledgeDebris(nextCrisis, key);
      nextAcks.delete(key);
      acksChanged = true;
    }
  }
  return { crisis: nextCrisis, acks: acksChanged ? nextAcks : acks };
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
