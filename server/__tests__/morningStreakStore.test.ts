/**
 * Unit tests for morningStreakStore.ts (V6-6 clean-morning streak
 * counter). Explicit temp-file constructor arg -- no HOME mocking needed.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MorningStreakStore } from '../src/morningStreakStore.js';

let tmpDir: string;
let statePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'morning-streak-'));
  statePath = path.join(tmpDir, 'morning-streak.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('MorningStreakStore', () => {
  it('starts at zero with no recorded date', () => {
    const store = new MorningStreakStore(statePath);
    const snap = store.getSnapshot();
    expect(snap.count).toBe(0);
    expect(snap.lastRecordedDate).toBeNull();
    expect(snap.lastOutcomeClean).toBeNull();
  });

  it('increments on a clean outcome', () => {
    const store = new MorningStreakStore(statePath);
    store.recordOutcome(true, '2026-07-13', undefined, 1_000);
    store.recordOutcome(true, '2026-07-14', undefined, 2_000);
    const snap = store.getSnapshot();
    expect(snap.count).toBe(2);
    expect(snap.lastOutcomeClean).toBe(true);
    expect(snap.lastCleanAt).toBe(2_000);
  });

  it('resets to zero on a breach and receipts the reason', () => {
    const store = new MorningStreakStore(statePath);
    store.recordOutcome(true, '2026-07-13', undefined, 1_000);
    store.recordOutcome(false, '2026-07-14', 'morning.json unavailable', 2_000);
    const snap = store.getSnapshot();
    expect(snap.count).toBe(0);
    expect(snap.lastOutcomeClean).toBe(false);
    expect(snap.lastBreachReason).toBe('morning.json unavailable');
    expect(snap.lastBreachAt).toBe(2_000);
  });

  it('is idempotent per local date -- a second call for the same date is a silent no-op', () => {
    const store = new MorningStreakStore(statePath);
    store.recordOutcome(true, '2026-07-13', undefined, 1_000);
    store.recordOutcome(false, '2026-07-13', 'should be ignored', 2_000);
    const snap = store.getSnapshot();
    expect(snap.count).toBe(1);
    expect(snap.lastOutcomeClean).toBe(true);
    expect(snap.lastBreachReason).toBeNull();
  });

  it('persists across a fresh store instance reading the same path', () => {
    const store1 = new MorningStreakStore(statePath);
    store1.recordOutcome(true, '2026-07-13', undefined, 1_000);
    const store2 = new MorningStreakStore(statePath);
    expect(store2.getSnapshot().count).toBe(1);
  });

  it('a subsequent clean outcome after a breach keeps lastBreachReason (history, not cleared silently) but flips lastOutcomeClean', () => {
    const store = new MorningStreakStore(statePath);
    store.recordOutcome(false, '2026-07-13', 'board state derivation threw', 1_000);
    store.recordOutcome(true, '2026-07-14', undefined, 2_000);
    const snap = store.getSnapshot();
    expect(snap.count).toBe(1);
    expect(snap.lastOutcomeClean).toBe(true);
    expect(snap.lastBreachReason).toBe('board state derivation threw');
  });
});
