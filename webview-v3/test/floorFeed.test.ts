import { describe, expect, it } from 'vitest';

import type { OutputChunk } from '../../core/src/messages.js';
import {
  appendFloorFeedEntry,
  EMPTY_FLOOR_FEED,
  floorFeedLabel,
  MAX_FLOOR_FEED_ENTRIES,
  MAX_FLOOR_FEED_RENDERED,
  visibleFloorFeedEntries,
} from '../src/state/floorFeed';

function chunk(overrides: Partial<OutputChunk> = {}): OutputChunk {
  return {
    type: 'outputChunk',
    source: 'agent',
    id: '2',
    seq: 0,
    stream: 'transcript',
    chunk: 'hello\n',
    truncated: false,
    ...overrides,
  };
}

describe('floorFeedLabel', () => {
  it('uses the real agent name when known', () => {
    expect(floorFeedLabel('agent', '2', 'turffinder')).toBe('[turffinder]');
  });

  it('falls back to an honest id-based label for a dispatch stream', () => {
    expect(floorFeedLabel('dispatch', 'run-1', undefined)).toBe('[dispatch:run-1]');
  });

  it('falls back to an honest id-based label for an unknown/despawned agent', () => {
    expect(floorFeedLabel('agent', '9', undefined)).toBe('[#9]');
  });
});

describe('visibleFloorFeedEntries', () => {
  it('windows long histories to the newest bounded set', () => {
    const entries = Array.from({ length: MAX_FLOOR_FEED_RENDERED + 5 }, (_, index) => ({
      key: String(index),
      label: '[agent]',
      text: String(index),
      receivedAt: index,
    }));
    const visible = visibleFloorFeedEntries(entries);
    expect(visible).toHaveLength(MAX_FLOOR_FEED_RENDERED);
    expect(visible[0].text).toBe('5');
    expect(visible.at(-1)?.text).toBe(String(entries.length - 1));
  });
});

describe('appendFloorFeedEntry', () => {
  it('appends a labeled entry', () => {
    const next = appendFloorFeedEntry(EMPTY_FLOOR_FEED, chunk(), '[turffinder]', 1000);
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual({
      key: 'agent:2:transcript:0',
      label: '[turffinder]',
      text: 'hello\n',
      receivedAt: 1000,
    });
  });

  it('preserves arrival order across different sources (global merge, not per-stream)', () => {
    let entries = EMPTY_FLOOR_FEED;
    entries = appendFloorFeedEntry(entries, chunk({ id: '1', seq: 0, chunk: 'a' }), '[one]', 1);
    entries = appendFloorFeedEntry(entries, chunk({ id: '2', seq: 0, chunk: 'b' }), '[two]', 2);
    entries = appendFloorFeedEntry(entries, chunk({ id: '1', seq: 1, chunk: 'c' }), '[one]', 3);
    expect(entries.map((e) => e.text)).toEqual(['a', 'b', 'c']);
  });

  it('caps at MAX_FLOOR_FEED_ENTRIES, dropping the OLDEST first', () => {
    let entries = EMPTY_FLOOR_FEED;
    for (let i = 0; i < MAX_FLOOR_FEED_ENTRIES + 10; i++) {
      entries = appendFloorFeedEntry(entries, chunk({ seq: i, chunk: `n${String(i)}` }), '[x]', i);
    }
    expect(entries).toHaveLength(MAX_FLOOR_FEED_ENTRIES);
    expect(entries[0].text).toBe('n10');
    expect(entries[entries.length - 1].text).toBe(`n${String(MAX_FLOOR_FEED_ENTRIES + 9)}`);
  });
});
