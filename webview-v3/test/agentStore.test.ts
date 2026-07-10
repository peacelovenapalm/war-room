import { describe, expect, it } from 'vitest';

import type { ServerMessage } from '../../core/src/messages.js';
import { EMPTY_AGENTS, reduceAgents, toOccupants } from '../src/net/agentStore';

const EXISTING: ServerMessage = {
  type: 'existingAgents',
  agents: [2, 1],
  agentMeta: {},
  folderNames: { '1': 'turffinder', '2': 'war-room' },
  externalAgents: {},
  machines: { '1': 'MACBOOK', '2': 'NEXUS' },
  providers: { '1': 'claude', '2': 'codex' },
};

describe('agent reducer (core generated types)', () => {
  it('rebuilds the roster from existingAgents with WAITING as the honest default', () => {
    const agents = reduceAgents(EMPTY_AGENTS, EXISTING);
    expect(agents.size).toBe(2);
    expect(agents.get(1)).toEqual({
      id: 1,
      name: 'turffinder',
      machine: 'MACBOOK',
      provider: 'claude',
      status: 'waiting',
      awaitingInput: false,
    });
    expect(agents.get(2)?.name).toBe('war-room');
  });

  it('adds on agentCreated with folderName fallback', () => {
    const created = reduceAgents(EMPTY_AGENTS, { type: 'agentCreated', id: 7 });
    expect(created.get(7)?.name).toBe('AGENT 7');
    const named = reduceAgents(created, {
      type: 'agentCreated',
      id: 8,
      folderName: 'brain2-vault',
      machine: 'NEXUS',
    });
    expect(named.get(8)?.name).toBe('brain2-vault');
    expect(named.size).toBe(2);
  });

  it('updates status/awaitingInput on agentStatus and removes on agentClosed', () => {
    let agents = reduceAgents(EMPTY_AGENTS, EXISTING);
    agents = reduceAgents(agents, { type: 'agentStatus', id: 1, status: 'active' });
    expect(agents.get(1)?.status).toBe('active');
    agents = reduceAgents(agents, {
      type: 'agentStatus',
      id: 2,
      status: 'waiting',
      awaitingInput: true,
    });
    expect(agents.get(2)?.awaitingInput).toBe(true);
    agents = reduceAgents(agents, { type: 'agentClosed', id: 1 });
    expect(agents.has(1)).toBe(false);
    expect(agents.size).toBe(1);
  });

  it('returns the SAME reference for irrelevant or unknown-id messages', () => {
    const agents = reduceAgents(EMPTY_AGENTS, EXISTING);
    expect(reduceAgents(agents, { type: 'agentSelected', id: 1 })).toBe(agents);
    expect(reduceAgents(agents, { type: 'agentStatus', id: 99, status: 'active' })).toBe(agents);
    expect(reduceAgents(agents, { type: 'agentClosed', id: 99 })).toBe(agents);
  });

  it('never mutates the previous map (React state contract)', () => {
    const agents = reduceAgents(EMPTY_AGENTS, EXISTING);
    reduceAgents(agents, { type: 'agentStatus', id: 1, status: 'active' });
    expect(agents.get(1)?.status).toBe('waiting');
    reduceAgents(agents, { type: 'agentClosed', id: 1 });
    expect(agents.has(1)).toBe(true);
  });

  describe('toOccupants', () => {
    it('orders by ascending id and encodes status as glyph + word', () => {
      let agents = reduceAgents(EMPTY_AGENTS, EXISTING);
      agents = reduceAgents(agents, { type: 'agentStatus', id: 2, status: 'active' });
      const occupants = toOccupants(agents);
      expect(occupants).toEqual([
        { name: 'turffinder', statusGlyph: '⏸', statusWord: 'WAITING' },
        { name: 'war-room', statusGlyph: '▶', statusWord: 'ACTIVE' },
      ]);
    });

    it('awaitingInput wins over base status (✋ INPUT)', () => {
      let agents = reduceAgents(EMPTY_AGENTS, EXISTING);
      agents = reduceAgents(agents, {
        type: 'agentStatus',
        id: 1,
        status: 'active',
        awaitingInput: true,
      });
      expect(toOccupants(agents)[0]).toEqual({
        name: 'turffinder',
        statusGlyph: '✋',
        statusWord: 'INPUT',
      });
    });

    it('truncates long names with an ellipsis', () => {
      const agents = reduceAgents(EMPTY_AGENTS, {
        type: 'agentCreated',
        id: 1,
        folderName: 'a-very-long-workspace-folder-name',
      });
      const [occupant] = toOccupants(agents);
      expect(occupant.name.length).toBeLessThanOrEqual(14);
      expect(occupant.name.endsWith('…')).toBe(true);
    });
  });
});
