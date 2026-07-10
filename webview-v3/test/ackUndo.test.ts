import { describe, expect, it } from 'vitest';

import {
  ACK_UNDO_WINDOW_MS,
  EMPTY_ACKS,
  requestAck,
  undoAck,
  undoSecondsLeft,
} from '../src/state/ackUndo';

const NOW = 1_000_000;
/** The debris instance anchor the ack is aimed at (instance keying). */
const SINCE = 900_000;

describe('ack undo window', () => {
  it('requestAck opens a window ACK_UNDO_WINDOW_MS long, keyed to the debris instance', () => {
    const acks = requestAck(EMPTY_ACKS, '1:failed', SINCE, NOW);
    expect(acks.get('1:failed')).toEqual({ undoUntil: NOW + ACK_UNDO_WINDOW_MS, since: SINCE });
  });

  it('re-acking the SAME key for a NEWER instance replaces the pending entry', () => {
    let acks = requestAck(EMPTY_ACKS, '1:failed', SINCE, NOW);
    acks = requestAck(acks, '1:failed', SINCE + 5_000, NOW + 1_000);
    expect(acks.get('1:failed')).toEqual({
      undoUntil: NOW + 1_000 + ACK_UNDO_WINDOW_MS,
      since: SINCE + 5_000,
    });
  });

  it('undoAck genuinely reverses a pending ack', () => {
    const acks = requestAck(EMPTY_ACKS, '1:failed', SINCE, NOW);
    const undone = undoAck(acks, '1:failed');
    expect(undone.has('1:failed')).toBe(false);
    expect(undoAck(undone, '1:failed')).toBe(undone);
  });

  it('undoSecondsLeft counts down in whole seconds, floored at 0', () => {
    const until = NOW + ACK_UNDO_WINDOW_MS;
    expect(undoSecondsLeft(until, NOW)).toBe(5);
    expect(undoSecondsLeft(until, NOW + 4_100)).toBe(1);
    expect(undoSecondsLeft(until, NOW + 10_000)).toBe(0);
  });
});
