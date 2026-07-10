import { describe, expect, it } from 'vitest';

import type { ServerMessage } from '../../core/src/messages.js';
import { type AgentMap, EMPTY_AGENTS, reduceAgents } from '../src/net/agentStore';
import {
  acknowledgeDebris,
  debrisKey,
  EMPTY_CRISIS_STATE,
  openCrisisCount,
  reduceCrisisState,
} from '../src/state/crisisStore';

const NOW = 20_000_000;

const EXISTING: ServerMessage = {
  type: 'existingAgents',
  agents: [1, 2],
  agentMeta: {},
  folderNames: { '1': 'war-room', '2': 'turffinder' },
  externalAgents: {},
  machines: { '1': 'MACBOOK', '2': 'NEXUS' },
};

/** Poll messages are reduced 10s before NOW — inside the 60s poll TTL, so
 *  the crisis machine still sees them as fresh at NOW. */
const RECEIPT_AT = NOW - 10_000;

function roster(...messages: ServerMessage[]): AgentMap {
  let agents = reduceAgents(EMPTY_AGENTS, EXISTING, RECEIPT_AT);
  for (const message of messages) agents = reduceAgents(agents, message, RECEIPT_AT);
  return agents;
}

describe('reduceCrisisState', () => {
  it('starts a fire for a needs-input agent, server-anchored via the poll', () => {
    const agents = roster({
      type: 'agentPollState',
      id: 1,
      state: 'blocked',
      waitingFor: 'Approve?',
      ageMs: 50_000,
    });
    const state = reduceCrisisState(EMPTY_CRISIS_STATE, agents, NOW);
    // agentPollState was reduced at RECEIPT_AT with ageMs 50_000.
    expect(state.fires.get(1)?.since).toBe(RECEIPT_AT - 50_000);
    expect(state.fires.has(2)).toBe(false);
  });

  it('anchors a hook-plane needs-input fire at client first-seen and keeps the earliest anchor', () => {
    const agents = roster({ type: 'agentStatus', id: 2, status: 'waiting', awaitingInput: true });
    const first = reduceCrisisState(EMPTY_CRISIS_STATE, agents, NOW);
    expect(first.fires.get(2)?.since).toBe(NOW);
    const later = reduceCrisisState(first, agents, NOW + 30_000);
    expect(later.fires.get(2)?.since).toBe(NOW);
  });

  it('puts the fire out when the agent stops needing input', () => {
    const burning = roster({ type: 'agentStatus', id: 1, status: 'waiting', awaitingInput: true });
    const withFire = reduceCrisisState(EMPTY_CRISIS_STATE, burning, NOW);
    expect(withFire.fires.has(1)).toBe(true);
    const calmed = roster({ type: 'agentStatus', id: 1, status: 'active' });
    const after = reduceCrisisState(withFire, calmed, NOW + 1_000);
    expect(after.fires.has(1)).toBe(false);
  });

  it('spawns debris on the failed transition, capturing identity text', () => {
    const healthy = roster();
    const seeded = reduceCrisisState(EMPTY_CRISIS_STATE, healthy, NOW - 1_000);
    const failed = roster({ type: 'agentPollState', id: 1, state: 'failed', ageMs: 0 });
    const state = reduceCrisisState(seeded, failed, NOW);
    const record = state.debris.get(debrisKey(1, 'failed'));
    expect(record).toBeDefined();
    expect(record?.label).toBe('#1 [MACBOOK] war-room');
    expect(record?.since).toBe(NOW);
    // Debris does not double as a fire.
    expect(state.fires.has(1)).toBe(false);
  });

  it('debris persists after the agent closes, and clears when the agent recovers', () => {
    const seeded = reduceCrisisState(EMPTY_CRISIS_STATE, roster(), NOW - 2_000);
    const stopped = roster({ type: 'agentPollState', id: 2, state: 'stopped', ageMs: 0 });
    const withDebris = reduceCrisisState(seeded, stopped, NOW - 1_000);
    expect(withDebris.debris.has(debrisKey(2, 'stopped'))).toBe(true);

    // Agent closes → debris stays (cleanup still owed).
    const closed = reduceAgents(stopped, { type: 'agentClosed', id: 2 }, NOW);
    const afterClose = reduceCrisisState(withDebris, closed, NOW);
    expect(afterClose.debris.has(debrisKey(2, 'stopped'))).toBe(true);
    expect(afterClose.fires.has(2)).toBe(false);

    // Recovery path: stopped → working clears the wreck (keeping it would lie).
    const recovered = roster({ type: 'agentPollState', id: 2, state: 'working', ageMs: 0 });
    const afterRecovery = reduceCrisisState(withDebris, recovered, NOW);
    expect(afterRecovery.debris.has(debrisKey(2, 'stopped'))).toBe(false);
  });

  it('acknowledgeDebris removes exactly one record; openCrisisCount sums fires+debris', () => {
    const seeded = reduceCrisisState(EMPTY_CRISIS_STATE, roster(), NOW - 2_000);
    const both = roster(
      { type: 'agentPollState', id: 1, state: 'failed', ageMs: 0 },
      { type: 'agentStatus', id: 2, status: 'waiting', awaitingInput: true },
    );
    const state = reduceCrisisState(seeded, both, NOW);
    expect(openCrisisCount(state)).toBe(2);
    const acked = acknowledgeDebris(state, debrisKey(1, 'failed'));
    expect(openCrisisCount(acked)).toBe(1);
    expect(acknowledgeDebris(acked, 'missing:key')).toBe(acked);
  });
});
