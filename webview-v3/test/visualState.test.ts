import { describe, expect, it } from 'vitest';

import type { AgentRecord } from '../src/net/agentStore';
import {
  deriveVisualState,
  freshPoll,
  isDownState,
  POLL_STATE_TTL_MS,
  STATE_CHIPS,
} from '../src/state/visualState';

const NOW = 5_000_000;

function record(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: 1,
    name: 'war-room',
    status: 'waiting',
    awaitingInput: false,
    toolPermission: false,
    inputTokens: 0,
    outputTokens: 0,
    managed: false,
    ...overrides,
  };
}

function poll(state: 'working' | 'blocked' | 'done' | 'failed' | 'stopped', ageOfSnapshotMs = 0) {
  return {
    state,
    since: NOW - 10_000,
    receivedAt: NOW - ageOfSnapshotMs,
    stale: false,
  };
}

describe('deriveVisualState', () => {
  it('defaults to WAITING with no telemetry (the conservative truth)', () => {
    expect(deriveVisualState(record(), NOW)).toBe('waiting');
  });

  it('status active → WORKING', () => {
    expect(deriveVisualState(record({ status: 'active' }), NOW)).toBe('working');
  });

  it('poll blocked beats active when the hook plane is not provably fresher', () => {
    expect(deriveVisualState(record({ status: 'active', poll: poll('blocked') }), NOW)).toBe(
      'needs-input',
    );
  });

  it('hook-primary: an active transition NEWER than the poll snapshot outranks blocked', () => {
    // Agent blocked (poll saw it), then resumed — the hook active landed
    // AFTER the poll snapshot. The stale blocked must not spawn a fire.
    const resumed = record({
      status: 'active',
      statusAt: NOW - 1_000,
      poll: poll('blocked', 10_000), // snapshot is 10s old, older than statusAt
    });
    expect(deriveVisualState(resumed, NOW)).toBe('working');
  });

  it('hook-primary: a poll blocked NEWER than the last hook transition still wins', () => {
    const reblocked = record({
      status: 'active',
      statusAt: NOW - 30_000,
      poll: poll('blocked', 1_000), // snapshot is fresher than the hook status
    });
    expect(deriveVisualState(reblocked, NOW)).toBe('needs-input');
  });

  it('hook-primary: waiting status never suppresses a fresh blocked, regardless of recency', () => {
    const waiting = record({
      status: 'waiting',
      statusAt: NOW - 1_000,
      poll: poll('blocked', 10_000),
    });
    expect(deriveVisualState(waiting, NOW)).toBe('needs-input');
  });

  it('toolPermission and awaitingInput are NEEDS INPUT', () => {
    expect(deriveVisualState(record({ toolPermission: true }), NOW)).toBe('needs-input');
    expect(deriveVisualState(record({ awaitingInput: true }), NOW)).toBe('needs-input');
  });

  it('poll failed/stopped map to FAILED/STOPPED; working/done lift WAITING', () => {
    expect(deriveVisualState(record({ poll: poll('failed') }), NOW)).toBe('failed');
    expect(deriveVisualState(record({ poll: poll('stopped') }), NOW)).toBe('stopped');
    expect(deriveVisualState(record({ poll: poll('working') }), NOW)).toBe('working');
    expect(deriveVisualState(record({ poll: poll('done') }), NOW)).toBe('done');
  });

  it('expired or stale poll snapshots are ignored', () => {
    const expired = record({ poll: poll('failed', POLL_STATE_TTL_MS + 1) });
    expect(deriveVisualState(expired, NOW)).toBe('waiting');
    const stale = record({ poll: { ...poll('failed'), stale: true } });
    expect(deriveVisualState(stale, NOW)).toBe('waiting');
  });
});

describe('freshPoll', () => {
  it('returns the snapshot inside the TTL, undefined outside it', () => {
    expect(freshPoll(record({ poll: poll('blocked') }), NOW)?.state).toBe('blocked');
    expect(
      freshPoll(record({ poll: poll('blocked', POLL_STATE_TTL_MS + 1) }), NOW),
    ).toBeUndefined();
  });
});

describe('STATE_CHIPS (colorblind hard rule)', () => {
  it('every state has a distinct glyph AND a text label', () => {
    const glyphs = Object.values(STATE_CHIPS).map((chip) => chip.glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
    for (const chip of Object.values(STATE_CHIPS)) {
      expect(chip.label.length).toBeGreaterThan(0);
      expect(chip.label).toBe(chip.label.toUpperCase());
    }
  });

  it('loud states are exactly needs-input and failed', () => {
    const loud = Object.entries(STATE_CHIPS)
      .filter(([, chip]) => chip.loud)
      .map(([state]) => state)
      .sort();
    expect(loud).toEqual(['failed', 'needs-input']);
  });
});

describe('isDownState', () => {
  it('failed/stopped are down; the rest are not', () => {
    expect(isDownState('failed')).toBe(true);
    expect(isDownState('stopped')).toBe(true);
    expect(isDownState('working')).toBe(false);
    expect(isDownState('needs-input')).toBe(false);
  });
});
