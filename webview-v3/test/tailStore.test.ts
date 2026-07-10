import { describe, expect, it } from 'vitest';

import type { OutputChunk } from '../../core/src/messages.js';
import {
  appendChunk,
  dropStream,
  EMPTY_TAILS,
  MAX_TAIL_ENTRIES,
  pausedCount,
  setPaused,
  tailKey,
  type TailMap,
} from '../src/state/tailStore';

function chunk(seq: number, text: string, overrides: Partial<OutputChunk> = {}): OutputChunk {
  return {
    type: 'outputChunk',
    source: 'agent',
    id: '3',
    seq,
    stream: 'transcript',
    chunk: text,
    truncated: false,
    ...overrides,
  };
}

const KEY = tailKey('agent', '3');

describe('appendChunk', () => {
  it('appends in order under the stream key', () => {
    let tails: TailMap = appendChunk(EMPTY_TAILS, chunk(0, 'a\n'));
    tails = appendChunk(tails, chunk(1, 'b\n'));
    const state = tails.get(KEY);
    expect(state?.entries.map((e) => e.text)).toEqual(['a\n', 'b\n']);
    expect(state?.lastSeq).toBe(1);
  });

  it('dedupes replayed chunks by seq (resubscribe overlap is harmless)', () => {
    let tails = appendChunk(EMPTY_TAILS, chunk(5, 'live\n'));
    const before = tails;
    tails = appendChunk(tails, chunk(4, 'replayed\n'));
    expect(tails).toBe(before);
    tails = appendChunk(tails, chunk(5, 'replayed\n'));
    expect(tails).toBe(before);
  });

  it('separates streams by (source, id)', () => {
    let tails = appendChunk(EMPTY_TAILS, chunk(0, 'agent\n'));
    tails = appendChunk(tails, chunk(0, 'dispatch\n', { source: 'dispatch', id: 'd-1' }));
    expect(tails.get(KEY)?.entries[0].text).toBe('agent\n');
    expect(tails.get(tailKey('dispatch', 'd-1'))?.entries[0].text).toBe('dispatch\n');
  });

  it('caps retained entries at MAX_TAIL_ENTRIES (drops oldest)', () => {
    let tails: TailMap = EMPTY_TAILS;
    for (let seq = 0; seq < MAX_TAIL_ENTRIES + 10; seq++) {
      tails = appendChunk(tails, chunk(seq, `${String(seq)}\n`));
    }
    const state = tails.get(KEY);
    expect(state?.entries.length).toBe(MAX_TAIL_ENTRIES);
    expect(state?.entries[0].text).toBe('10\n');
  });

  it('latches the truncated flag from the wire', () => {
    let tails = appendChunk(EMPTY_TAILS, chunk(0, 'a\n', { truncated: true }));
    tails = appendChunk(tails, chunk(1, 'b\n'));
    expect(tails.get(KEY)?.truncated).toBe(true);
  });
});

describe('pause / resume (+N WHILE PAUSED)', () => {
  it('buffers arriving chunks while paused and counts them', () => {
    let tails = appendChunk(EMPTY_TAILS, chunk(0, 'a\n'));
    tails = setPaused(tails, KEY, true);
    tails = appendChunk(tails, chunk(1, 'b\n'));
    tails = appendChunk(tails, chunk(2, 'c\n'));
    const state = tails.get(KEY)!;
    expect(state.entries.map((e) => e.text)).toEqual(['a\n']);
    expect(pausedCount(state)).toBe(2);
  });

  it('resume flushes the buffer in order — nothing is dropped by pausing', () => {
    let tails = appendChunk(EMPTY_TAILS, chunk(0, 'a\n'));
    tails = setPaused(tails, KEY, true);
    tails = appendChunk(tails, chunk(1, 'b\n'));
    tails = setPaused(tails, KEY, false);
    const state = tails.get(KEY)!;
    expect(state.entries.map((e) => e.text)).toEqual(['a\n', 'b\n']);
    expect(pausedCount(state)).toBe(0);
    expect(state.paused).toBe(false);
  });

  it('same-reference when the pause flag does not change', () => {
    const tails = appendChunk(EMPTY_TAILS, chunk(0, 'a\n'));
    expect(setPaused(tails, KEY, false)).toBe(tails);
  });
});

describe('dropStream', () => {
  it('removes a stream on last unsubscribe; same-reference when absent', () => {
    const tails = appendChunk(EMPTY_TAILS, chunk(0, 'a\n'));
    const dropped = dropStream(tails, KEY);
    expect(dropped.has(KEY)).toBe(false);
    expect(dropStream(dropped, KEY)).toBe(dropped);
  });
});
