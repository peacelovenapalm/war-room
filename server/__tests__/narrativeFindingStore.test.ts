/**
 * Unit tests for narrativeFindingStore.ts (V6-5 cross-model spot-check
 * discrepancy landing pad). Explicit temp-file constructor arg.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NARRATIVE_FINDING_CAP } from '../src/constants.js';
import { NarrativeFindingStore } from '../src/narrativeFindingStore.js';

let tmpDir: string;
let statePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'narrative-finding-'));
  statePath = path.join(tmpDir, 'narrative-findings.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('NarrativeFindingStore', () => {
  it('starts empty', () => {
    const store = new NarrativeFindingStore(statePath);
    expect(store.getRecent(Number.MAX_SAFE_INTEGER)).toEqual([]);
  });

  it('files a finding and returns it newest-first', () => {
    const store = new NarrativeFindingStore(statePath);
    store.file({ date: '2026-07-13', summary: 'first', detail: 'd1' }, 1_000);
    store.file({ date: '2026-07-14', summary: 'second', detail: 'd2' }, 2_000);
    const recent = store.getRecent(Number.MAX_SAFE_INTEGER, 2_000);
    expect(recent.map((f) => f.summary)).toEqual(['second', 'first']);
  });

  it('filters out findings older than maxAgeMs', () => {
    const store = new NarrativeFindingStore(statePath);
    store.file({ date: '2026-07-06', summary: 'old', detail: '' }, 0);
    store.file({ date: '2026-07-13', summary: 'fresh', detail: '' }, 7 * 24 * 60 * 60_000);
    const recent = store.getRecent(24 * 60 * 60_000, 7 * 24 * 60 * 60_000);
    expect(recent.map((f) => f.summary)).toEqual(['fresh']);
  });

  it('caps the ledger at NARRATIVE_FINDING_CAP, pruning oldest first', () => {
    const store = new NarrativeFindingStore(statePath);
    for (let i = 0; i < NARRATIVE_FINDING_CAP + 5; i++) {
      store.file({ date: '2026-07-13', summary: `f${String(i)}`, detail: '' }, i);
    }
    const recent = store.getRecent(Number.MAX_SAFE_INTEGER, NARRATIVE_FINDING_CAP + 5);
    expect(recent.length).toBe(NARRATIVE_FINDING_CAP);
    expect(recent[recent.length - 1].summary).toBe('f5'); // oldest 5 pruned
  });

  it('persists across a fresh store instance', () => {
    const store1 = new NarrativeFindingStore(statePath);
    store1.file({ date: '2026-07-13', summary: 'persisted', detail: '' }, 1_000);
    const store2 = new NarrativeFindingStore(statePath);
    expect(store2.getRecent(Number.MAX_SAFE_INTEGER, 1_000).map((f) => f.summary)).toEqual([
      'persisted',
    ]);
  });
});
