import { describe, expect, it } from 'vitest';

import {
  ACK_UNDO_WINDOW_MS,
  clearAcks,
  EMPTY_ACKS,
  expiredAcks,
  requestAck,
  undoAck,
  undoSecondsLeft,
} from '../src/state/ackUndo';

const NOW = 1_000_000;

describe('ack undo window', () => {
  it('requestAck opens a window ACK_UNDO_WINDOW_MS long', () => {
    const acks = requestAck(EMPTY_ACKS, '1:failed', NOW);
    expect(acks.get('1:failed')).toBe(NOW + ACK_UNDO_WINDOW_MS);
  });

  it('undoAck genuinely reverses a pending ack', () => {
    const acks = requestAck(EMPTY_ACKS, '1:failed', NOW);
    const undone = undoAck(acks, '1:failed');
    expect(undone.has('1:failed')).toBe(false);
    expect(undoAck(undone, '1:failed')).toBe(undone);
  });

  it('expiredAcks returns only lapsed windows; clearAcks removes them', () => {
    let acks = requestAck(EMPTY_ACKS, 'a', NOW);
    acks = requestAck(acks, 'b', NOW + 3_000);
    expect(expiredAcks(acks, NOW + ACK_UNDO_WINDOW_MS - 1)).toEqual([]);
    expect(expiredAcks(acks, NOW + ACK_UNDO_WINDOW_MS)).toEqual(['a']);
    const cleared = clearAcks(acks, ['a']);
    expect(cleared.has('a')).toBe(false);
    expect(cleared.has('b')).toBe(true);
    expect(clearAcks(cleared, [])).toBe(cleared);
  });

  it('undoSecondsLeft counts down in whole seconds, floored at 0', () => {
    const until = NOW + ACK_UNDO_WINDOW_MS;
    expect(undoSecondsLeft(until, NOW)).toBe(5);
    expect(undoSecondsLeft(until, NOW + 4_100)).toBe(1);
    expect(undoSecondsLeft(until, NOW + 10_000)).toBe(0);
  });
});
