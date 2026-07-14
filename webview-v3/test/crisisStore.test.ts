import { describe, expect, it } from 'vitest';

import type { ServerMessage } from '../../core/src/messages.js';
import { type AgentMap, EMPTY_AGENTS, reduceAgents } from '../src/net/agentStore';
import { EMPTY_ACKS, requestAck } from '../src/state/ackUndo';
import {
  acknowledgeDebris,
  debrisKey,
  EMPTY_CRISIS_STATE,
  openCrisisCount,
  reduceCrisisState,
  sweepAcks,
} from '../src/state/crisisStore';
import { reconnectReplayDeadline, reduceReconnectReplay } from '../src/state/reconnectReplay';

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
  it('returns the same state when a reduction changes no crisis data', () => {
    const agents = roster();
    const first = reduceCrisisState(EMPTY_CRISIS_STATE, agents, NOW);
    expect(reduceCrisisState(first, agents, NOW + 1_000)).toBe(first);
  });

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

  it('RECONNECT: healthy agent replay before failed agent preserves the failure-age anchor', () => {
    // Regression: A is failed with old debris and B is healthy. The server
    // resets both via existingAgents, then B's poll replay lands before A's.
    // Reducing that partial roster invents an A recovery, deletes its debris,
    // and A's later replay respawns it at reconnect time.
    const T0 = NOW;
    const failed = roster({ type: 'agentPollState', id: 1, state: 'failed', ageMs: 0 });
    const seeded = reduceCrisisState(EMPTY_CRISIS_STATE, roster(), T0 - 1_000);
    const withDebris = reduceCrisisState(seeded, failed, T0);
    expect(withDebris.debris.get(debrisKey(1, 'failed'))?.since).toBe(T0);

    // T0+30s (inside the poll TTL): reconnect snapshot begins.
    const T1 = T0 + 30_000;
    let replay = reduceReconnectReplay(null, EXISTING, T1)!;
    const reconnected = reduceAgents(failed, EXISTING, T1);
    let crisis = withDebris;
    expect(crisis.debris.get(debrisKey(1, 'failed'))?.since).toBe(T0);

    // B's healthy replay arrives first. This is the ordering-dependent hole:
    // an eager crisis tick would erase A's real debris right here.
    const healthyB: ServerMessage = {
      type: 'agentPollState',
      id: 2,
      state: 'working',
      ageMs: 0,
    };
    replay = reduceReconnectReplay(replay, healthyB, T1 + 1)!;
    let replayedAgents = reduceAgents(reconnected, healthyB, T1 + 1);
    expect(reduceCrisisState(crisis, replayedAgents, T1 + 1).debris.has(debrisKey(1, 'failed'))).toBe(
      false,
    );
    expect(crisis.debris.get(debrisKey(1, 'failed'))?.since).toBe(T0);

    // A's own failed replay arrives later. Crisis is still frozen until the
    // shared replay transaction settles.
    const failedA: ServerMessage = {
      type: 'agentPollState',
      id: 1,
      state: 'failed',
      ageMs: T1 - RECEIPT_AT,
    };
    replay = reduceReconnectReplay(replay, failedA, T1 + 2)!;
    replayedAgents = reduceAgents(replayedAgents, failedA, T1 + 2);
    expect(crisis.debris.get(debrisKey(1, 'failed'))?.since).toBe(T0);

    expect(reconnectReplayDeadline(replay)).toBeGreaterThan(T1 + 2);
    crisis = reduceCrisisState(crisis, replayedAgents, reconnectReplayDeadline(replay));
    const record = crisis.debris.get(debrisKey(1, 'failed'));
    expect(record).toBeDefined();
    expect(record?.since).toBe(T0);
  });

  it('ACK-UNDO KEYING: a pending ack never sweeps a NEW failure instance reusing the key', () => {
    // Regression (panel finding, crisisStore.ts:47) — exact scenario:
    // t=0    agent 9's session fails → debris `9:failed` (since=0)
    // t=1000 user taps ✓ ACK (undo window until t=6000)
    // t=2000 agent recovers → debris deleted; the pending ack MUST die too
    // t=3000 agent fails AGAIN → NEW debris `9:failed` (since=3000)
    // t=6000 the original ack's window lapses → must NOT sweep the new crate
    const key = debrisKey(1, 'failed');
    const failedAt = (at: number, state: 'failed' | 'working') =>
      reduceAgents(
        reduceAgents(EMPTY_AGENTS, EXISTING, at),
        { type: 'agentPollState', id: 1, state, ageMs: 0 },
        at,
      );

    // t=0 — first failure.
    const seeded = reduceCrisisState(
      EMPTY_CRISIS_STATE,
      reduceAgents(EMPTY_AGENTS, EXISTING, 0),
      0,
    );
    let crisis = reduceCrisisState(seeded, failedAt(0, 'failed'), 0);
    expect(crisis.debris.get(key)?.since).toBe(0);

    // t=1000 — ACK (window closes at 6000), keyed to THIS instance.
    let acks = requestAck(EMPTY_ACKS, key, crisis.debris.get(key)!.since, 1_000);

    // t=2000 — recovery deletes the debris; the sweep drops the orphan ack.
    crisis = reduceCrisisState(crisis, failedAt(2_000, 'working'), 2_000);
    expect(crisis.debris.has(key)).toBe(false);
    const sweptAtRecovery = sweepAcks(crisis, acks, 2_000);
    crisis = sweptAtRecovery.crisis;
    acks = sweptAtRecovery.acks;
    expect(acks.has(key)).toBe(false);

    // t=3000 — a brand-new failure reuses the same debris key.
    crisis = reduceCrisisState(crisis, failedAt(3_000, 'failed'), 3_000);
    expect(crisis.debris.get(key)?.since).toBe(3_000);

    // t=6000 — the ORIGINAL window's lapse must not touch the new crate.
    const sweptAtExpiry = sweepAcks(crisis, acks, 6_000);
    expect(sweptAtExpiry.crisis.debris.get(key)?.since).toBe(3_000);
  });

  it('ACK-UNDO KEYING: a matching-instance ack still commits at window lapse', () => {
    const key = debrisKey(1, 'failed');
    const failed = roster({ type: 'agentPollState', id: 1, state: 'failed', ageMs: 0 });
    const seeded = reduceCrisisState(EMPTY_CRISIS_STATE, roster(), NOW - 1_000);
    const crisis = reduceCrisisState(seeded, failed, NOW);
    const acks = requestAck(EMPTY_ACKS, key, crisis.debris.get(key)!.since, NOW);

    // Before the window lapses: nothing committed, ack still pending.
    const early = sweepAcks(crisis, acks, NOW + 1_000);
    expect(early.crisis.debris.has(key)).toBe(true);
    expect(early.acks.has(key)).toBe(true);
    expect(early.acks).toBe(acks); // same-reference when nothing changed

    // At lapse: the debris is acknowledged for real and the ack clears.
    const done = sweepAcks(crisis, acks, NOW + 5_000);
    expect(done.crisis.debris.has(key)).toBe(false);
    expect(done.acks.has(key)).toBe(false);
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
