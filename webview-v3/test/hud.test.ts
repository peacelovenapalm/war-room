import { describe, expect, it } from 'vitest';

import type { ServerMessage } from '../../core/src/messages.js';
import { EMPTY_AGENTS, reduceAgents } from '../src/net/agentStore';
import { EMPTY_CRISIS_STATE, reduceCrisisState } from '../src/state/crisisStore';
import {
  buildRealSheet,
  compactTokens,
  formatTally,
  formatWing,
  officeMood,
  tallyAgents,
  wingCounts,
} from '../src/state/hud';

const NOW = 30_000_000;

const EXISTING: ServerMessage = {
  type: 'existingAgents',
  agents: [1, 2, 3],
  agentMeta: {},
  folderNames: { '1': 'war-room', '2': 'turffinder', '3': 'brain2-vault' },
  externalAgents: {},
  machines: { '1': 'MACBOOK', '2': 'MACBOOK', '3': 'NEXUS' },
};

function liveRoster() {
  let agents = reduceAgents(EMPTY_AGENTS, EXISTING, NOW);
  agents = reduceAgents(agents, { type: 'agentStatus', id: 1, status: 'active' }, NOW);
  agents = reduceAgents(
    agents,
    { type: 'agentPollState', id: 2, state: 'blocked', waitingFor: 'Approve?', ageMs: 10_000 },
    NOW,
  );
  agents = reduceAgents(agents, { type: 'agentPollState', id: 3, state: 'failed', ageMs: 0 }, NOW);
  return agents;
}

describe('tallyAgents / formatTally', () => {
  it('buckets working / needs-input / down from real state', () => {
    const tally = tallyAgents(liveRoster(), NOW);
    expect(tally).toEqual({ total: 3, working: 1, needsInput: 1, down: 1 });
    expect(formatTally(tally)).toBe('◉ 3 · ▶ 1 · ⚠ 1 · ✗ 1');
  });

  it('formats the empty office', () => {
    expect(formatTally(tallyAgents(EMPTY_AGENTS, NOW))).toBe('◉ 0 · ▶ 0 · ⚠ 0 · ✗ 0');
  });
});

describe('wingCounts / formatWing', () => {
  it('groups agents by machine and counts live fires per wing', () => {
    const agents = liveRoster();
    const crisis = reduceCrisisState(EMPTY_CRISIS_STATE, agents, NOW);
    const wings = wingCounts(agents, crisis);
    expect(wings).toEqual([
      { machine: 'MACBOOK', agentCount: 2, warnCount: 1 },
      { machine: 'NEXUS', agentCount: 1, warnCount: 0 },
    ]);
    expect(formatWing(wings[0])).toBe('▣ MACBOOK ⚠ 1');
    expect(formatWing(wings[1])).toBe('▣ NEXUS ✓');
  });
});

describe('officeMood', () => {
  it('is CALM at zero crises, STRAINED (n) otherwise — shape + text', () => {
    expect(officeMood(0)).toBe('✓ OFFICE: CALM');
    expect(officeMood(3)).toBe('⚠ OFFICE: STRAINED (3)');
  });
});

describe('compactTokens', () => {
  it('mirrors the v1 formatter', () => {
    expect(compactTokens(42)).toBe('42');
    expect(compactTokens(12_345)).toBe('12.3k');
    expect(compactTokens(2_500_000)).toBe('2.5M');
  });
});

describe('buildRealSheet (one-tap-real, hard rule 5)', () => {
  it('agent chips decompose into verbatim per-agent telemetry lines', () => {
    const agents = liveRoster();
    const crisis = reduceCrisisState(EMPTY_CRISIS_STATE, agents, NOW);
    const sheet = buildRealSheet('tally', { agents, crisis, economy: null }, NOW);
    expect(sheet.title).toContain('agentStatus / agentPollState');
    expect(sheet.lines.some((line) => line.includes('waitingFor=Approve?'))).toBe(true);
    expect(sheet.lines.some((line) => line.startsWith('DEBRIS #3 [NEXUS] brain2-vault'))).toBe(
      true,
    );
  });

  it('economy chips decompose into the verbatim ledger, or say the feed is absent', () => {
    const empty = buildRealSheet(
      'cash',
      { agents: EMPTY_AGENTS, crisis: EMPTY_CRISIS_STATE, economy: null },
      NOW,
    );
    expect(empty.lines).toEqual(['(no economyUpdate received this session)']);

    const sheet = buildRealSheet(
      'rep',
      {
        agents: EMPTY_AGENTS,
        crisis: EMPTY_CRISIS_STATE,
        economy: {
          cash: 10,
          reputation: 5,
          ledger: [
            {
              ts: 0,
              delta: -3,
              currency: 'reputation',
              reason: 'BOUNCED APPROVAL',
              cause: { label: 'BOUNCED APPROVAL', sourceEventRefs: ['crisis:test-bounce'] },
            },
          ],
        },
      },
      NOW,
    );
    expect(sheet.lines[0]).toBe('cash=10 reputation=5');
    expect(sheet.lines[1]).toContain('-3 reputation — BOUNCED APPROVAL');
  });
});
