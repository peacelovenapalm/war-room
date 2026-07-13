import { describe, expect, it } from 'vitest';

import {
  clearAllParkedDrafts,
  clearParkedDraft,
  type KeyValueStorage,
  listParkedDrafts,
  parkDraft,
  PARKED_DRAFTS_MAX,
} from '../src/state/parkedDrafts';

function fakeStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const store = { ...initial };
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => {
      store[key] = value;
    },
  };
}

describe('listParkedDrafts', () => {
  it('is empty with no storage or an empty store', () => {
    expect(listParkedDrafts(undefined)).toEqual([]);
    expect(listParkedDrafts(fakeStorage())).toEqual([]);
  });

  it('tolerates malformed JSON -- honest empty list, never a throw', () => {
    expect(listParkedDrafts(fakeStorage({ 'war-room-parked-drafts': 'not json' }))).toEqual([]);
  });

  it('filters out malformed entries', () => {
    const storage = fakeStorage({
      'war-room-parked-drafts': JSON.stringify([{ id: '1' }, 'garbage', null]),
    });
    expect(listParkedDrafts(storage)).toEqual([]);
  });
});

describe('parkDraft', () => {
  it('adds a draft and it round-trips through listParkedDrafts', () => {
    const storage = fakeStorage();
    const entry = parkDraft(storage, { kind: 'morning-refresh', label: 'REFRESH' }, 1_000);
    expect(entry.kind).toBe('morning-refresh');
    expect(entry.createdAt).toBe(1_000);
    expect(listParkedDrafts(storage)).toEqual([entry]);
  });

  it('is a safe no-op with no storage', () => {
    expect(() => parkDraft(undefined, { kind: 'x', label: 'x' })).not.toThrow();
  });

  it('caps the list at PARKED_DRAFTS_MAX, dropping the oldest', () => {
    const storage = fakeStorage();
    for (let i = 0; i < PARKED_DRAFTS_MAX + 5; i++) {
      parkDraft(storage, { kind: 'x', label: `draft-${String(i)}` }, i);
    }
    const drafts = listParkedDrafts(storage);
    expect(drafts.length).toBe(PARKED_DRAFTS_MAX);
    expect(drafts[0].label).toBe('draft-5');
  });
});

describe('clearParkedDraft / clearAllParkedDrafts', () => {
  it('removes a single draft by id, leaving the rest', () => {
    const storage = fakeStorage();
    const a = parkDraft(storage, { kind: 'x', label: 'a' }, 1);
    const b = parkDraft(storage, { kind: 'x', label: 'b' }, 2);
    clearParkedDraft(storage, a.id);
    expect(listParkedDrafts(storage)).toEqual([b]);
  });

  it('clears every draft', () => {
    const storage = fakeStorage();
    parkDraft(storage, { kind: 'x', label: 'a' }, 1);
    parkDraft(storage, { kind: 'x', label: 'b' }, 2);
    clearAllParkedDrafts(storage);
    expect(listParkedDrafts(storage)).toEqual([]);
  });
});
