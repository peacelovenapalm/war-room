/**
 * Client-side transaction boundary around the server's reconnect snapshot.
 *
 * `existingAgents` is followed by one poll frame per advertised agent and
 * then a variable-length hook/tool replay. There is no wire-level terminator,
 * so the client waits until every expected poll arrived and the WS burst went
 * quiet. A hard ceiling prevents one missing poll frame from freezing derived
 * telemetry forever.
 */

import type { ServerMessage } from '../../../core/src/messages.js';

export const RECONNECT_REPLAY_QUIET_MS = 50;
export const RECONNECT_REPLAY_MAX_MS = 1_000;

export interface ReconnectReplay {
  expectedAgentIds: ReadonlySet<number>;
  receivedPollAgentIds: ReadonlySet<number>;
  quietUntil: number;
  expiresAt: number;
}

function boundedQuietUntil(now: number, expiresAt: number): number {
  return Math.min(now + RECONNECT_REPLAY_QUIET_MS, expiresAt);
}

/** Start or advance the current replay transaction from one WS frame. */
export function reduceReconnectReplay(
  prev: ReconnectReplay | null,
  message: ServerMessage,
  now: number,
): ReconnectReplay | null {
  if (message.type === 'existingAgents') {
    const expiresAt = now + RECONNECT_REPLAY_MAX_MS;
    return {
      expectedAgentIds: new Set(message.agents),
      receivedPollAgentIds: new Set(),
      quietUntil: boundedQuietUntil(now, expiresAt),
      expiresAt,
    };
  }
  if (prev === null) return null;

  let receivedPollAgentIds = prev.receivedPollAgentIds;
  if (
    message.type === 'agentPollState' &&
    prev.expectedAgentIds.has(message.id) &&
    !receivedPollAgentIds.has(message.id)
  ) {
    const nextReceivedPollAgentIds = new Set(receivedPollAgentIds);
    nextReceivedPollAgentIds.add(message.id);
    receivedPollAgentIds = nextReceivedPollAgentIds;
  }
  return {
    ...prev,
    receivedPollAgentIds,
    quietUntil: boundedQuietUntil(now, prev.expiresAt),
  };
}

export function hasCompletePollReplay(replay: ReconnectReplay): boolean {
  for (const id of replay.expectedAgentIds) {
    if (!replay.receivedPollAgentIds.has(id)) return false;
  }
  return true;
}

/**
 * Before all poll rows arrive, only the hard ceiling may close the epoch.
 * Once they have, the quiet window makes the remaining variable-length
 * hook/tool replay atomic too.
 */
export function reconnectReplayDeadline(replay: ReconnectReplay): number {
  return hasCompletePollReplay(replay) ? replay.quietUntil : replay.expiresAt;
}
