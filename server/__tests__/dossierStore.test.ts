/**
 * Dossier store skeleton tests (v3 WS-C stage 1): idempotent ensure(),
 * the one-tap-real trait gate (no earnedFrom refs → refusal), trait
 * permanence/dedupe, and sidecar persistence round-trip.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DossierStore } from '../src/dossierStore.js';

let tmpDir: string;
let filePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dossier-store-'));
  filePath = path.join(tmpDir, 'dossiers.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const STAFF_ID = 'MACBOOK:war-room#1';

describe('DossierStore', () => {
  it('ensure() creates once and never resets an existing dossier', () => {
    const store = new DossierStore(filePath);
    const created = store.ensure(STAFF_ID, 'Jordan Vega', 100);
    expect(created.ok).toBe(true);
    store.addTrait(STAFF_ID, { name: 'Night Owl', earnedFrom: ['turn:s1'], earnedAt: 200 });

    const again = store.ensure(STAFF_ID, 'Different Name', 300);
    expect(again.ok && again.dossier.displayName === 'Jordan Vega').toBe(true);
    expect(store.get(STAFF_ID)?.traits).toHaveLength(1);
    expect(store.ensure('  ', 'x')).toEqual({ ok: false, reason: 'empty-staff-id' });
  });

  it('rejects traits without real event refs (one-tap-real)', () => {
    const store = new DossierStore(filePath);
    store.ensure(STAFF_ID, 'Jordan Vega', 100);
    expect(store.addTrait(STAFF_ID, { name: 'Ghost', earnedFrom: [], earnedAt: 200 })).toEqual({
      ok: false,
      reason: 'no-real-event-refs',
    });
    expect(
      store.addTrait(STAFF_ID, { name: 'Ghost', earnedFrom: ['  ', ''], earnedAt: 200 }),
    ).toEqual({ ok: false, reason: 'no-real-event-refs' });
    expect(store.get(STAFF_ID)?.traits).toHaveLength(0);
  });

  it('dedupes traits by name — earning twice is a refusal, not a duplicate', () => {
    const store = new DossierStore(filePath);
    store.ensure(STAFF_ID, 'Jordan Vega', 100);
    const trait = { name: 'Night Owl', earnedFrom: ['turn:s1'], earnedAt: 200 };
    expect(store.addTrait(STAFF_ID, trait).ok).toBe(true);
    expect(store.addTrait(STAFF_ID, { ...trait, earnedAt: 300 })).toEqual({
      ok: false,
      reason: 'already-earned',
    });
    expect(store.get(STAFF_ID)?.traits).toHaveLength(1);
  });

  it('sets history and portraitRef on existing dossiers only', () => {
    const store = new DossierStore(filePath);
    expect(store.setHistory('nope', 'x')).toEqual({ ok: false, reason: 'not-found' });
    store.ensure(STAFF_ID, 'Jordan Vega', 100);
    expect(store.setHistory(STAFF_ID, '212 turns since May.', 200).ok).toBe(true);
    expect(store.setPortraitRef(STAFF_ID, 'portraits/jordan.png', 300).ok).toBe(true);
    expect(store.get(STAFF_ID)?.history).toBe('212 turns since May.');
    expect(store.get(STAFF_ID)?.portraitRef).toBe('portraits/jordan.png');
  });

  it('fires onChange per mutation and persists across instances', () => {
    const store = new DossierStore(filePath);
    let fired = 0;
    store.onChange(() => fired++);
    store.ensure(STAFF_ID, 'Jordan Vega', 100);
    store.addTrait(STAFF_ID, { name: 'Night Owl', earnedFrom: ['turn:s1'], earnedAt: 200 });
    expect(fired).toBe(2);

    const reloaded = new DossierStore(filePath);
    expect(reloaded.hasRecords()).toBe(true);
    expect(reloaded.get(STAFF_ID)?.traits[0].earnedFrom).toEqual(['turn:s1']);
  });
});
