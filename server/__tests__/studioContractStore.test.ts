/**
 * Studio contract store skeleton tests (v3 WS-C stage 1): mint dedupe on
 * the normalized verbatim source line, bonus-only reward enforcement,
 * one-tap-real progress refs, QUIET expiry, and sidecar persistence
 * round-trip (explicit temp path — the same convention every other store
 * test uses).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StudioContractSourceTodo } from '../../core/src/messages.js';
import { StudioContractStore } from '../src/studioContractStore.js';

let tmpDir: string;
let filePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-contract-store-'));
  filePath = path.join(tmpDir, 'studio-contracts.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const TODO: StudioContractSourceTodo = {
  file: '/vault/_inbox/routines/todo/2026-07-10.md',
  line: 3,
  text: '- [ ] Rotate the NEXUS token',
};

describe('StudioContractStore', () => {
  it('mints an offered contract with the verbatim sourceTodo', () => {
    const store = new StudioContractStore(filePath);
    const result = store.mintFromTodo(TODO, 40, 999_999, 100);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contract.status).toBe('offered');
    expect(result.contract.sourceTodo).toEqual(TODO);
    expect(result.contract.progress).toEqual([]);
    expect(result.contract.acceptedAt).toBeUndefined();
  });

  it('never double-mints an open contract for the same normalized line', () => {
    const store = new StudioContractStore(filePath);
    const first = store.mintFromTodo(TODO, 40, 999_999, 100);
    // Same line, whitespace drift + moved to another line number.
    const again = store.mintFromTodo(
      { file: TODO.file, line: 9, text: '  - [ ]   Rotate the   NEXUS token  ' },
      40,
      999_999,
      200,
    );
    expect(again.ok && first.ok && again.contract.id === first.contract.id).toBe(true);
    expect(store.getAll()).toHaveLength(1);
  });

  it('rejects negative rewards (bonus-only) and blank source text', () => {
    const store = new StudioContractStore(filePath);
    expect(store.mintFromTodo(TODO, -5, 999_999)).toEqual({ ok: false, reason: 'negative-reward' });
    expect(store.mintFromTodo({ ...TODO, text: '   ' }, 10, 999_999)).toEqual({
      ok: false,
      reason: 'empty-source-text',
    });
    expect(store.getAll()).toHaveLength(0);
  });

  it('walks offered → accepted → progressing → completed on real events only', () => {
    const store = new StudioContractStore(filePath);
    const minted = store.mintFromTodo(TODO, 40, 999_999, 100);
    if (!minted.ok) throw new Error('mint failed');
    const id = minted.contract.id;

    // Progress before accept is a refusal.
    expect(store.recordProgress(id, { ts: 150, sourceRef: 'dispatch:x', summary: 's' })).toEqual({
      ok: false,
      reason: 'not-accepted',
    });

    expect(store.accept(id, 200).ok).toBe(true);
    expect(store.getById(id)?.acceptedAt).toBe(200);

    // One-tap-real: a progress event with no sourceRef is rejected.
    expect(store.recordProgress(id, { ts: 300, sourceRef: '  ', summary: 'ran' })).toEqual({
      ok: false,
      reason: 'missing-source-ref',
    });

    expect(
      store.recordProgress(id, { ts: 300, sourceRef: 'dispatch:abc', summary: 'run landed' }).ok,
    ).toBe(true);
    expect(store.getById(id)?.status).toBe('progressing');

    expect(store.complete(id, 400).ok).toBe(true);
    expect(store.getById(id)?.status).toBe('completed');
    expect(store.getById(id)?.completedAt).toBe(400);
    expect(store.getActive()).toHaveLength(0);
  });

  it('sweepQuietExpiry expires only open contracts past their quiet deadline', () => {
    const store = new StudioContractStore(filePath);
    const expiring = store.mintFromTodo(TODO, 40, 1_000, 100);
    const alive = store.mintFromTodo({ ...TODO, text: 'other line' }, 40, 5_000, 100);
    if (!expiring.ok || !alive.ok) throw new Error('mint failed');

    expect(store.sweepQuietExpiry(2_000)).toBe(1);
    expect(store.getById(expiring.contract.id)?.status).toBe('expired');
    expect(store.getById(expiring.contract.id)?.expiredAt).toBe(2_000);
    expect(store.getById(alive.contract.id)?.status).toBe('offered');
    // Idempotent: nothing left to sweep.
    expect(store.sweepQuietExpiry(2_001)).toBe(0);
  });

  it('fires onChange per mutation and supports unsubscribe', () => {
    const store = new StudioContractStore(filePath);
    const seen: string[] = [];
    const unsubscribe = store.onChange((c) => seen.push(c.status));
    const minted = store.mintFromTodo(TODO, 40, 999_999, 100);
    if (!minted.ok) throw new Error('mint failed');
    store.accept(minted.contract.id, 200);
    expect(seen).toEqual(['offered', 'accepted']);
    unsubscribe();
    store.complete(minted.contract.id, 300);
    expect(seen).toEqual(['offered', 'accepted']);
  });

  it('persists to the sidecar and reloads in a fresh instance', () => {
    const store = new StudioContractStore(filePath);
    const minted = store.mintFromTodo(TODO, 40, 999_999, 100);
    if (!minted.ok) throw new Error('mint failed');
    store.accept(minted.contract.id, 200);

    const reloaded = new StudioContractStore(filePath);
    expect(reloaded.getAll()).toHaveLength(1);
    expect(reloaded.getById(minted.contract.id)?.status).toBe('accepted');
    expect(reloaded.getById(minted.contract.id)?.sourceTodo.text).toBe(TODO.text);
    expect(reloaded.hasRecords()).toBe(true);
  });

  it('treats a corrupt sidecar as fresh state', () => {
    fs.writeFileSync(filePath, '{not json', 'utf8');
    const store = new StudioContractStore(filePath);
    expect(store.getAll()).toEqual([]);
    expect(store.hasRecords()).toBe(false);
  });
});
