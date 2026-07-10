/**
 * Rivalry store skeleton tests (v3 WS-C stage 1): evidence-required
 * upserts, order-independent pair identity, change-detected broadcasts
 * (a re-derivation with identical facts is silent), the collision-warning
 * toggle, and sidecar persistence round-trip.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pairKey, RivalryStore } from '../src/rivalryStore.js';

let tmpDir: string;
let filePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rivalry-store-'));
  filePath = path.join(tmpDir, 'rivalries.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const A = 'MACBOOK:war-room';
const B = 'MACBOOK:war-room-wt-v3-server';
const EVIDENCE = ['both live cwds resolve into /Users/greg/code/war-room'];

describe('RivalryStore', () => {
  it('requires real evidence and two distinct staff ids', () => {
    const store = new RivalryStore(filePath);
    expect(store.upsert([A, B], 'rivalry', [], true)).toEqual({ ok: false, reason: 'no-evidence' });
    expect(store.upsert([A, B], 'rivalry', ['  '], true)).toEqual({
      ok: false,
      reason: 'no-evidence',
    });
    expect(store.upsert([A, A], 'rivalry', EVIDENCE, true)).toEqual({
      ok: false,
      reason: 'self-pair',
    });
    expect(store.upsert(['', B], 'rivalry', EVIDENCE, true)).toEqual({
      ok: false,
      reason: 'empty-staff-id',
    });
    expect(store.getAll()).toHaveLength(0);
  });

  it('pair identity is order-independent (sorted staffIds)', () => {
    const store = new RivalryStore(filePath);
    expect(store.upsert([B, A], 'rivalry', EVIDENCE, true).ok).toBe(true);
    expect(store.getAll()).toHaveLength(1);
    expect(store.get([A, B])?.staffIds).toEqual([A, B].sort());
    expect(pairKey([B, A])).toBe(pairKey([A, B]));

    // Re-deriving under swapped order updates the SAME pair.
    expect(store.upsert([A, B], 'bond', EVIDENCE, false).ok).toBe(true);
    expect(store.getAll()).toHaveLength(1);
    expect(store.get([B, A])?.kind).toBe('bond');
  });

  it('broadcasts only actual changes — identical re-derivation is silent', () => {
    const store = new RivalryStore(filePath);
    let fired = 0;
    store.onChange(() => fired++);

    store.upsert([A, B], 'rivalry', EVIDENCE, true);
    expect(fired).toBe(1);
    store.upsert([A, B], 'rivalry', EVIDENCE, true); // identical facts
    expect(fired).toBe(1);
    store.upsert([A, B], 'rivalry', EVIDENCE, false); // warning edge changed
    expect(fired).toBe(2);
  });

  it('setWarning toggles the collision early-warning, silently when unchanged', () => {
    const store = new RivalryStore(filePath);
    expect(store.setWarning([A, B], true)).toEqual({ ok: false, reason: 'not-found' });
    store.upsert([A, B], 'rivalry', EVIDENCE, false);

    let fired = 0;
    store.onChange(() => fired++);
    expect(store.setWarning([A, B], true).ok).toBe(true);
    expect(store.get([A, B])?.activeWarning).toBe(true);
    expect(fired).toBe(1);
    expect(store.setWarning([A, B], true).ok).toBe(true); // already true
    expect(fired).toBe(1);
  });

  it('persists across instances', () => {
    const store = new RivalryStore(filePath);
    store.upsert([A, B], 'rivalry', EVIDENCE, true);

    const reloaded = new RivalryStore(filePath);
    expect(reloaded.hasRecords()).toBe(true);
    expect(reloaded.get([A, B])?.evidence).toEqual(EVIDENCE);
    expect(reloaded.get([A, B])?.activeWarning).toBe(true);
  });
});
