import { describe, expect, it } from 'vitest';

import type { Occupant } from '../src/engine/world';
import type { DispatchEntry } from '../src/net/dispatchFacts';
import {
  appendSpeechBubble,
  detectNewlyLoudAgents,
  detectNewlyTerminalDispatches,
  dispatchDoneBubbleText,
  dispatchStatusSnapshot,
  loudAgentIds,
  MAX_CONCURRENT_BUBBLES,
  pruneSpeechBubbles,
  SPEECH_BUBBLE_TTL_MS,
  type SpeechBubbleEvent,
} from '../src/state/speechBubbles';

function occupant(overrides: Partial<Occupant> = {}): Occupant {
  return {
    agentId: 1,
    name: 'a',
    statusGlyph: '▶',
    statusWord: 'WORKING',
    loud: false,
    ...overrides,
  };
}

function entry(overrides: Partial<DispatchEntry> = {}): DispatchEntry {
  return {
    id: 'd1',
    action: 'dispatch',
    status: 'ringing',
    machine: 'M',
    receivedAt: 0,
    ...overrides,
  };
}

describe('appendSpeechBubble / pruneSpeechBubbles (bounded theater)', () => {
  it('caps at MAX_CONCURRENT_BUBBLES, dropping the oldest', () => {
    let bubbles: readonly SpeechBubbleEvent[] = [];
    for (let i = 0; i < MAX_CONCURRENT_BUBBLES + 2; i++) {
      bubbles = appendSpeechBubble(bubbles, {
        id: `b${String(i)}`,
        anchor: { kind: 'agent', agentId: i },
        text: 'x',
        createdAt: i,
      });
    }
    expect(bubbles).toHaveLength(MAX_CONCURRENT_BUBBLES);
    expect(bubbles.map((b) => b.id)).toEqual(['b2', 'b3', 'b4']);
  });

  it('prunes bubbles past the TTL', () => {
    const bubbles: SpeechBubbleEvent[] = [
      { id: 'a', anchor: { kind: 'agent', agentId: 1 }, text: 'x', createdAt: 0 },
    ];
    expect(pruneSpeechBubbles(bubbles, SPEECH_BUBBLE_TTL_MS - 1)).toHaveLength(1);
    expect(pruneSpeechBubbles(bubbles, SPEECH_BUBBLE_TTL_MS)).toHaveLength(0);
  });
});

describe('detectNewlyLoudAgents / loudAgentIds (real telemetry rising edge)', () => {
  it('only fires on the RISING edge — a still-loud agent does not re-fire', () => {
    const occupants = [occupant({ agentId: 1, loud: true, statusWord: 'NEEDS INPUT' })];
    const prev = new Set<number>();
    const newly = detectNewlyLoudAgents(prev, occupants);
    expect(newly.map((o) => o.agentId)).toEqual([1]);

    const nextPrev = loudAgentIds(occupants);
    expect(detectNewlyLoudAgents(nextPrev, occupants)).toHaveLength(0);
  });

  it('a quiet occupant never fires', () => {
    const occupants = [occupant({ agentId: 1, loud: false })];
    expect(detectNewlyLoudAgents(new Set(), occupants)).toHaveLength(0);
  });

  it('an agent going loud again after recovering re-fires (edge, not membership)', () => {
    const loud = [occupant({ agentId: 1, loud: true })];
    const quiet = [occupant({ agentId: 1, loud: false })];
    const afterLoud = loudAgentIds(loud);
    expect(detectNewlyLoudAgents(afterLoud, quiet)).toHaveLength(0);
    const afterQuiet = loudAgentIds(quiet);
    expect(detectNewlyLoudAgents(afterQuiet, loud).map((o) => o.agentId)).toEqual([1]);
  });
});

describe('detectNewlyTerminalDispatches / dispatchStatusSnapshot', () => {
  it('fires when a dispatch transitions INTO a terminal status', () => {
    const prev = dispatchStatusSnapshot([entry({ id: 'a', status: 'answered', pid: 1 })]);
    const now = [entry({ id: 'a', status: 'exited', exitCode: 0 })];
    expect(detectNewlyTerminalDispatches(prev, now).map((e) => e.id)).toEqual(['a']);
  });

  it('does not re-fire for an entry already terminal in the prior snapshot', () => {
    const prev = dispatchStatusSnapshot([entry({ id: 'a', status: 'exited' })]);
    const now = [entry({ id: 'a', status: 'exited' })];
    expect(detectNewlyTerminalDispatches(prev, now)).toHaveLength(0);
  });

  it('a first sighting that is already terminal (e.g. page reload) still fires', () => {
    const now = [entry({ id: 'a', status: 'denied', reason: 'x' })];
    expect(detectNewlyTerminalDispatches(new Map(), now).map((e) => e.id)).toEqual(['a']);
  });

  it('in-flight statuses never fire', () => {
    const prev = new Map<string, DispatchEntry['status']>();
    const now = [
      entry({ id: 'a', status: 'ringing' }),
      entry({ id: 'b', status: 'queued-budget' }),
    ];
    expect(detectNewlyTerminalDispatches(prev, now)).toHaveLength(0);
  });
});

describe('dispatchDoneBubbleText', () => {
  it('reuses dispatchChipLabel verbatim — never a paraphrase', () => {
    expect(dispatchDoneBubbleText(entry({ status: 'exited', exitCode: 1 }))).toBe(
      '■ EXITED (code 1)',
    );
  });
});
