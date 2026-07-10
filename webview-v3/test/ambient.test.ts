import { describe, expect, it } from 'vitest';

import type { ServerMessage } from '../../core/src/messages.js';
import { occupiedDeskAnchors } from '../src/engine/world';
import { EMPTY_AGENTS, reduceAgents, toOccupants } from '../src/net/agentStore';
import { classifyWalkerAgents } from '../src/state/ambient';

const NOW = 1_000_000;

const EXISTING: ServerMessage = {
  type: 'existingAgents',
  agents: [1, 2, 3],
  agentMeta: {},
  folderNames: { '1': 'idle-one', '2': 'blocked-one', '3': 'working-one' },
  externalAgents: {},
  machines: {},
  providers: {},
  sessionIds: {},
  cwds: {},
  pids: {},
};

function buildAnchors(agents: ReturnType<typeof reduceAgents>) {
  return occupiedDeskAnchors(toOccupants(agents, NOW));
}

describe('classifyWalkerAgents', () => {
  it('an agent with no poll/status (honest default WAITING) classifies as idle', () => {
    const agents = reduceAgents(EMPTY_AGENTS, EXISTING, NOW);
    const inputs = classifyWalkerAgents(buildAnchors(agents), agents, NOW);
    const one = inputs.find((i) => i.agentId === 1);
    expect(one).toBeDefined();
    expect(one!.behavior).toBe('idle');
  });

  it('a poll-blocked agent classifies as blocked (paces, never drifts)', () => {
    let agents = reduceAgents(EMPTY_AGENTS, EXISTING, NOW);
    agents = reduceAgents(
      agents,
      { type: 'agentPollState', id: 2, state: 'blocked', waitingFor: 'y/n', ageMs: 1_000 },
      NOW,
    );
    const inputs = classifyWalkerAgents(buildAnchors(agents), agents, NOW);
    const two = inputs.find((i) => i.agentId === 2);
    expect(two).toBeDefined();
    expect(two!.behavior).toBe('blocked');
  });

  it('a WORKING agent (active status) gets NO walker — the desk glow already signals it', () => {
    let agents = reduceAgents(EMPTY_AGENTS, EXISTING, NOW);
    agents = reduceAgents(agents, { type: 'agentStatus', id: 3, status: 'active' }, NOW);
    const inputs = classifyWalkerAgents(buildAnchors(agents), agents, NOW);
    expect(inputs.find((i) => i.agentId === 3)).toBeUndefined();
  });

  it('a FAILED/STOPPED (down) agent gets NO walker — nobody is there to drift or pace', () => {
    let agents = reduceAgents(EMPTY_AGENTS, EXISTING, NOW);
    agents = reduceAgents(
      agents,
      { type: 'agentPollState', id: 1, state: 'failed', ageMs: 0 },
      NOW,
    );
    const inputs = classifyWalkerAgents(buildAnchors(agents), agents, NOW);
    expect(inputs.find((i) => i.agentId === 1)).toBeUndefined();
  });

  it('carries the real desk tile coordinates through from occupiedDeskAnchors', () => {
    const agents = reduceAgents(EMPTY_AGENTS, EXISTING, NOW);
    const anchors = buildAnchors(agents);
    const inputs = classifyWalkerAgents(anchors, agents, NOW);
    for (const input of inputs) {
      const anchor = anchors.find((a) => a.agentId === input.agentId);
      expect(anchor).toBeDefined();
      expect(input.deskTileX).toBe(anchor!.deskTileX);
      expect(input.deskTileY).toBe(anchor!.deskTileY);
    }
  });

  it('an anchor whose agent has since despawned (map race) is skipped, not thrown', () => {
    const agents = reduceAgents(EMPTY_AGENTS, EXISTING, NOW);
    const anchors = buildAnchors(agents);
    const withGhost = [...anchors, { ...anchors[0], agentId: 999 }];
    expect(() => classifyWalkerAgents(withGhost, agents, NOW)).not.toThrow();
    expect(
      classifyWalkerAgents(withGhost, agents, NOW).find((i) => i.agentId === 999),
    ).toBeUndefined();
  });
});
