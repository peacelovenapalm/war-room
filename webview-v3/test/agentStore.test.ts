import { describe, expect, it } from 'vitest';

import type { ServerMessage } from '../../core/src/messages.js';
import { agentIdentity, EMPTY_AGENTS, reduceAgents, toOccupants } from '../src/net/agentStore';

const NOW = 1_000_000;

const EXISTING: ServerMessage = {
  type: 'existingAgents',
  agents: [2, 1],
  agentMeta: {},
  folderNames: { '1': 'turffinder', '2': 'war-room' },
  externalAgents: {},
  machines: { '1': 'MACBOOK', '2': 'NEXUS' },
  providers: { '1': 'claude', '2': 'codex' },
  sessionIds: { '1': 'sess-1' },
  cwds: { '1': '/Users/greg/code/turffinder' },
  pids: { '1': 4242 },
};

describe('agent reducer (core generated types)', () => {
  it('rebuilds the roster from existingAgents with WAITING as the honest default', () => {
    const agents = reduceAgents(EMPTY_AGENTS, EXISTING, NOW);
    expect(agents.size).toBe(2);
    expect(agents.get(1)).toEqual({
      id: 1,
      name: 'turffinder',
      machine: 'MACBOOK',
      provider: 'claude',
      sessionId: 'sess-1',
      cwd: '/Users/greg/code/turffinder',
      pid: 4242,
      status: 'waiting',
      awaitingInput: false,
      toolPermission: false,
      inputTokens: 0,
      outputTokens: 0,
      managed: false,
    });
    expect(agents.get(2)?.name).toBe('war-room');
    expect(agents.get(2)?.sessionId).toBeUndefined();
  });

  it('adds on agentCreated with folderName fallback + identity facts', () => {
    const created = reduceAgents(EMPTY_AGENTS, { type: 'agentCreated', id: 7 }, NOW);
    expect(created.get(7)?.name).toBe('AGENT 7');
    const named = reduceAgents(
      created,
      {
        type: 'agentCreated',
        id: 8,
        folderName: 'brain2-vault',
        machine: 'NEXUS',
        sessionId: 'sess-8',
        cwd: '/data/brain2',
        pid: 99,
      },
      NOW,
    );
    expect(named.get(8)?.name).toBe('brain2-vault');
    expect(named.get(8)?.sessionId).toBe('sess-8');
    expect(named.get(8)?.cwd).toBe('/data/brain2');
    expect(named.get(8)?.pid).toBe(99);
    expect(named.size).toBe(2);
  });

  it('updates status/awaitingInput on agentStatus and removes on agentClosed', () => {
    let agents = reduceAgents(EMPTY_AGENTS, EXISTING, NOW);
    agents = reduceAgents(agents, { type: 'agentStatus', id: 1, status: 'active' }, NOW);
    expect(agents.get(1)?.status).toBe('active');
    // 4A hook-primary: the transition is timestamped so the visual
    // derivation can compare hook freshness against the poll snapshot.
    expect(agents.get(1)?.statusAt).toBe(NOW);
    agents = reduceAgents(
      agents,
      { type: 'agentStatus', id: 2, status: 'waiting', awaitingInput: true },
      NOW,
    );
    expect(agents.get(2)?.awaitingInput).toBe(true);
    agents = reduceAgents(agents, { type: 'agentClosed', id: 1 }, NOW);
    expect(agents.has(1)).toBe(false);
    expect(agents.size).toBe(1);
  });

  it('anchors agentPollState.since to the server ageMs, and clears on undefined state', () => {
    let agents = reduceAgents(EMPTY_AGENTS, EXISTING, NOW);
    agents = reduceAgents(
      agents,
      {
        type: 'agentPollState',
        id: 1,
        state: 'blocked',
        waitingFor: 'Approve? (y/n)',
        ageMs: 30_000,
      },
      NOW,
    );
    expect(agents.get(1)?.poll).toEqual({
      state: 'blocked',
      waitingFor: 'Approve? (y/n)',
      since: NOW - 30_000,
      receivedAt: NOW,
      stale: false,
    });
    agents = reduceAgents(agents, { type: 'agentPollState', id: 1 }, NOW + 1_000);
    expect(agents.get(1)?.poll).toBeUndefined();
  });

  it('tracks token usage, pid updates, and the tool-permission window', () => {
    let agents = reduceAgents(EMPTY_AGENTS, EXISTING, NOW);
    agents = reduceAgents(
      agents,
      { type: 'agentTokenUsage', id: 2, inputTokens: 12_345, outputTokens: 678 },
      NOW,
    );
    expect(agents.get(2)?.inputTokens).toBe(12_345);
    expect(agents.get(2)?.outputTokens).toBe(678);
    agents = reduceAgents(agents, { type: 'agentPidUpdate', id: 2, pid: 555 }, NOW);
    expect(agents.get(2)?.pid).toBe(555);
    agents = reduceAgents(agents, { type: 'agentToolPermission', id: 2 }, NOW);
    expect(agents.get(2)?.toolPermission).toBe(true);
    agents = reduceAgents(agents, { type: 'agentToolPermissionClear', id: 2 }, NOW);
    expect(agents.get(2)?.toolPermission).toBe(false);
  });

  it('RECONNECT EPOCH: existingAgents resets ephemeral fields but preserves cumulative tokens', () => {
    let agents = reduceAgents(EMPTY_AGENTS, EXISTING, NOW);
    agents = reduceAgents(agents, { type: 'agentToolPermission', id: 1 }, NOW);
    agents = reduceAgents(
      agents,
      { type: 'agentStatus', id: 2, status: 'waiting', awaitingInput: true },
      NOW,
    );
    agents = reduceAgents(
      agents,
      { type: 'agentPollState', id: 1, state: 'failed', ageMs: 5_000 },
      NOW,
    );
    agents = reduceAgents(
      agents,
      { type: 'agentTokenUsage', id: 1, inputTokens: 100, outputTokens: 50 },
      NOW,
    );

    const reconnected = reduceAgents(agents, EXISTING, NOW + 60_000);
    expect(reconnected.get(1)?.toolPermission).toBe(false);
    expect(reconnected.get(2)?.awaitingInput).toBe(false);
    expect(reconnected.get(1)?.status).toBe('waiting');
    expect(reconnected.get(1)?.statusAt).toBeUndefined();
    expect(reconnected.get(1)?.poll).toBeUndefined();
    expect(reconnected.get(1)?.inputTokens).toBe(100);
    expect(reconnected.get(1)?.outputTokens).toBe(50);
    // Identity still comes fresh from the message (server truth).
    expect(reconnected.get(1)?.name).toBe('turffinder');
  });

  it('RECONNECT EPOCH: existingAgents drops vanished ids and resets surviving ones', () => {
    let agents = reduceAgents(EMPTY_AGENTS, EXISTING, NOW);
    agents = reduceAgents(agents, { type: 'agentToolPermission', id: 2 }, NOW);
    const next = reduceAgents(
      agents,
      {
        type: 'existingAgents',
        agents: [2, 3],
        agentMeta: {},
        folderNames: { '2': 'war-room', '3': 'brain2' },
        externalAgents: {},
      },
      NOW + 1_000,
    );
    expect(next.has(1)).toBe(false);
    expect(next.get(2)?.toolPermission).toBe(false);
    expect(next.get(3)?.toolPermission).toBe(false);
    expect(next.get(3)?.status).toBe('waiting');
  });

  it('RECONNECT MERGE: reused numeric ids reset live state when sessionId changes', () => {
    let agents = reduceAgents(EMPTY_AGENTS, EXISTING, NOW);
    agents = reduceAgents(agents, { type: 'agentToolPermission', id: 1 }, NOW);
    agents = reduceAgents(
      agents,
      { type: 'agentStatus', id: 1, status: 'active', awaitingInput: true },
      NOW,
    );
    agents = reduceAgents(
      agents,
      { type: 'agentPollState', id: 1, state: 'blocked', ageMs: 5_000 },
      NOW,
    );

    const restarted = reduceAgents(
      agents,
      { ...EXISTING, sessionIds: { '1': 'replacement-session' } },
      NOW + 60_000,
    );

    expect(restarted.get(1)).toMatchObject({
      id: 1,
      sessionId: 'replacement-session',
      status: 'waiting',
      awaitingInput: false,
      toolPermission: false,
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(restarted.get(1)?.poll).toBeUndefined();
  });

  it('returns the SAME reference for irrelevant or unknown-id messages', () => {
    const agents = reduceAgents(EMPTY_AGENTS, EXISTING, NOW);
    expect(reduceAgents(agents, { type: 'agentSelected', id: 1 }, NOW)).toBe(agents);
    expect(reduceAgents(agents, { type: 'agentStatus', id: 99, status: 'active' }, NOW)).toBe(
      agents,
    );
    expect(reduceAgents(agents, { type: 'agentClosed', id: 99 }, NOW)).toBe(agents);
    expect(reduceAgents(agents, { type: 'agentToolPermissionClear', id: 1 }, NOW)).toBe(agents);
  });

  it('never mutates the previous map (React state contract)', () => {
    const agents = reduceAgents(EMPTY_AGENTS, EXISTING, NOW);
    reduceAgents(agents, { type: 'agentStatus', id: 1, status: 'active' }, NOW);
    expect(agents.get(1)?.status).toBe('waiting');
    reduceAgents(agents, { type: 'agentClosed', id: 1 }, NOW);
    expect(agents.has(1)).toBe(true);
  });

  describe('T2/T4 managed flag (agentManagedUpdate + existingAgents.managed)', () => {
    it('defaults managed to false and picks it up from existingAgents.managed', () => {
      const agents = reduceAgents(EMPTY_AGENTS, EXISTING, NOW);
      expect(agents.get(1)?.managed).toBe(false);
      expect(agents.get(2)?.managed).toBe(false);

      const withManaged = reduceAgents(EMPTY_AGENTS, { ...EXISTING, managed: { '1': true } }, NOW);
      expect(withManaged.get(1)?.managed).toBe(true);
      expect(withManaged.get(2)?.managed).toBe(false);
    });

    it('agentManagedUpdate flips the flag for a known agent, no-ops for unknown ids', () => {
      let agents = reduceAgents(EMPTY_AGENTS, EXISTING, NOW);
      agents = reduceAgents(agents, { type: 'agentManagedUpdate', id: 1, managed: true }, NOW);
      expect(agents.get(1)?.managed).toBe(true);
      agents = reduceAgents(agents, { type: 'agentManagedUpdate', id: 1, managed: false }, NOW);
      expect(agents.get(1)?.managed).toBe(false);
      expect(
        reduceAgents(agents, { type: 'agentManagedUpdate', id: 999, managed: true }, NOW),
      ).toBe(agents);
    });

    it('RECONNECT MERGE: managed comes fresh from existingAgents (live advertisement, not preserved)', () => {
      let agents = reduceAgents(EMPTY_AGENTS, EXISTING, NOW);
      agents = reduceAgents(agents, { type: 'agentManagedUpdate', id: 1, managed: true }, NOW);
      // A reconnect resends existingAgents WITHOUT the managed flag this
      // time (runner stopped advertising it) — the fresh value wins, unlike
      // toolPermission/poll which are preserved.
      const reconnected = reduceAgents(agents, EXISTING, NOW + 60_000);
      expect(reconnected.get(1)?.managed).toBe(false);
    });
  });

  describe('agentIdentity', () => {
    it('formats "#id [MACHINE] name" with a LOCAL fallback', () => {
      const agents = reduceAgents(EMPTY_AGENTS, EXISTING, NOW);
      expect(agentIdentity(agents.get(1)!)).toBe('#1 [MACBOOK] turffinder');
      expect(agentIdentity({ id: 9, machine: undefined, name: 'x' })).toBe('#9 [LOCAL] x');
    });
  });

  describe('toOccupants', () => {
    it('orders by ascending id and encodes status via the shared chip vocabulary', () => {
      let agents = reduceAgents(EMPTY_AGENTS, EXISTING, NOW);
      agents = reduceAgents(agents, { type: 'agentStatus', id: 2, status: 'active' }, NOW);
      const occupants = toOccupants(agents, NOW);
      expect(occupants).toEqual([
        { agentId: 1, name: 'turffinder', statusGlyph: '⏸', statusWord: 'WAITING', loud: false },
        { agentId: 2, name: 'war-room', statusGlyph: '▶', statusWord: 'WORKING', loud: false },
      ]);
    });

    it('awaitingInput wins over base status (⚠ NEEDS INPUT, loud)', () => {
      let agents = reduceAgents(EMPTY_AGENTS, EXISTING, NOW);
      agents = reduceAgents(
        agents,
        { type: 'agentStatus', id: 1, status: 'active', awaitingInput: true },
        NOW,
      );
      expect(toOccupants(agents, NOW)[0]).toEqual({
        agentId: 1,
        name: 'turffinder',
        statusGlyph: '⚠',
        statusWord: 'NEEDS INPUT',
        loud: true,
      });
    });

    it('truncates long names with an ellipsis', () => {
      const agents = reduceAgents(
        EMPTY_AGENTS,
        { type: 'agentCreated', id: 1, folderName: 'a-very-long-workspace-folder-name' },
        NOW,
      );
      const [occupant] = toOccupants(agents, NOW);
      expect(occupant.name.length).toBeLessThanOrEqual(14);
      expect(occupant.name.endsWith('…')).toBe(true);
    });
  });
});
