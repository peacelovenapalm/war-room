import { describe, expect, it } from 'vitest';

import type { ServerMessage } from '../../core/src/messages.js';
import {
  hasCompletePollReplay,
  RECONNECT_REPLAY_MAX_MS,
  RECONNECT_REPLAY_QUIET_MS,
  reconnectReplayDeadline,
  reduceReconnectReplay,
} from '../src/state/reconnectReplay';

const EXISTING: ServerMessage = {
  type: 'existingAgents',
  agents: [1, 2],
  agentMeta: {},
  folderNames: {},
  externalAgents: {},
};

describe('reconnect replay transaction', () => {
  it('waits for every advertised poll row, then settles after the whole WS burst goes quiet', () => {
    const started = reduceReconnectReplay(null, EXISTING, 1_000)!;
    expect(reconnectReplayDeadline(started)).toBe(1_000 + RECONNECT_REPLAY_MAX_MS);

    const onePoll = reduceReconnectReplay(
      started,
      { type: 'agentPollState', id: 2, state: 'working' },
      1_010,
    )!;
    expect(hasCompletePollReplay(onePoll)).toBe(false);
    expect(reconnectReplayDeadline(onePoll)).toBe(1_000 + RECONNECT_REPLAY_MAX_MS);

    const allPolls = reduceReconnectReplay(
      onePoll,
      { type: 'agentPollState', id: 1, state: 'failed' },
      1_020,
    )!;
    expect(hasCompletePollReplay(allPolls)).toBe(true);
    expect(reconnectReplayDeadline(allPolls)).toBe(1_020 + RECONNECT_REPLAY_QUIET_MS);

    const toolReplay = reduceReconnectReplay(
      allPolls,
      { type: 'agentToolStart', id: 1, toolId: 't1', status: 'Reading x.ts' },
      1_040,
    )!;
    expect(reconnectReplayDeadline(toolReplay)).toBe(1_040 + RECONNECT_REPLAY_QUIET_MS);
  });

  it('releases at the hard ceiling when an expected poll row never arrives', () => {
    const started = reduceReconnectReplay(null, EXISTING, 2_000)!;
    const partial = reduceReconnectReplay(
      started,
      { type: 'agentPollState', id: 2, state: 'working' },
      2_100,
    )!;
    expect(reconnectReplayDeadline(partial)).toBe(2_000 + RECONNECT_REPLAY_MAX_MS);
  });
});
