/**
 * Rework bin store skeleton tests (v3 WS-C stage 1): real-failure-only
 * piling (verbatim excerpt required + capped), per-failure idempotence,
 * the required dismiss verb, resolved-retention pruning, and sidecar
 * persistence round-trip.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  REWORK_EXCERPT_MAX_CHARS,
  REWORK_RESOLVED_RETENTION,
  ReworkBinStore,
} from '../src/reworkBinStore.js';

let tmpDir: string;
let filePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rework-bin-store-'));
  filePath = path.join(tmpDir, 'rework-bin.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const REF = { id: 'dispatch-uuid-1', excerpt: 'Error: exit 1\nlast line' };

describe('ReworkBinStore', () => {
  it('piles a crate only for a real failure ref with a verbatim excerpt', () => {
    const store = new ReworkBinStore(filePath);
    expect(store.pile('dispatch', { id: ' ', excerpt: 'x' })).toEqual({
      ok: false,
      reason: 'missing-failure-id',
    });
    expect(store.pile('dispatch', { id: 'd1', excerpt: '  ' })).toEqual({
      ok: false,
      reason: 'missing-failure-excerpt',
    });
    const piled = store.pile('dispatch', REF, 100);
    expect(piled.ok).toBe(true);
    if (!piled.ok) return;
    expect(piled.item.status).toBe('piled');
    expect(piled.item.failureRef.excerpt).toBe(REF.excerpt);
  });

  it('keeps the TAIL of an oversized excerpt (cap, resultTail posture)', () => {
    const store = new ReworkBinStore(filePath);
    const long = 'x'.repeat(REWORK_EXCERPT_MAX_CHARS + 100) + 'THE-END';
    const piled = store.pile('dispatch', { id: 'd-long', excerpt: long }, 100);
    if (!piled.ok) throw new Error('pile failed');
    expect(piled.item.failureRef.excerpt.length).toBe(REWORK_EXCERPT_MAX_CHARS);
    expect(piled.item.failureRef.excerpt.endsWith('THE-END')).toBe(true);
  });

  it('never stacks two crates for the same piled failure', () => {
    const store = new ReworkBinStore(filePath);
    const first = store.pile('dispatch', REF, 100);
    const again = store.pile('dispatch', REF, 200);
    expect(first.ok && again.ok && first.item.id === again.item.id).toBe(true);
    expect(store.getAll()).toHaveLength(1);
    // A crisis crate with the same ref id is a DIFFERENT source — allowed.
    expect(store.pile('crisis', REF, 300).ok).toBe(true);
    expect(store.getAll()).toHaveLength(2);
  });

  it('supports rework and the REQUIRED dismiss verb; resolved crates leave the pile', () => {
    const store = new ReworkBinStore(filePath);
    const a = store.pile('dispatch', REF, 100);
    const b = store.pile('crisis', { id: 'c1', excerpt: 'boom' }, 100);
    if (!a.ok || !b.ok) throw new Error('pile failed');

    expect(store.markReworked(a.item.id, 200).ok).toBe(true);
    expect(store.getById(a.item.id)?.status).toBe('reworked');
    expect(store.getById(a.item.id)?.resolvedAt).toBe(200);

    expect(store.dismiss(b.item.id, 'stale worktree', 300).ok).toBe(true);
    expect(store.getById(b.item.id)?.status).toBe('dismissed');
    expect(store.getById(b.item.id)?.dismissedReason).toBe('stale worktree');

    expect(store.getPiled()).toHaveLength(0);
    // Terminal crates refuse further verbs.
    expect(store.dismiss(a.item.id)).toEqual({ ok: false, reason: 'not-piled' });
    expect(store.markReworked(b.item.id)).toEqual({ ok: false, reason: 'not-piled' });
  });

  it('prunes the oldest resolved crates past the retention cap; piled crates never pruned', () => {
    const store = new ReworkBinStore(filePath);
    const keeper = store.pile('dispatch', { id: 'keeper', excerpt: 'k' }, 1);
    if (!keeper.ok) throw new Error('pile failed');
    for (let i = 0; i < REWORK_RESOLVED_RETENTION + 5; i++) {
      const piled = store.pile('dispatch', { id: `d-${i}`, excerpt: 'e' }, 10 + i);
      if (!piled.ok) throw new Error('pile failed');
      store.dismiss(piled.item.id, undefined, 1_000 + i);
    }
    const resolved = store.getAll().filter((i) => i.status !== 'piled');
    expect(resolved.length).toBeLessThanOrEqual(REWORK_RESOLVED_RETENTION + 1);
    expect(store.getById(keeper.item.id)?.status).toBe('piled');
  });

  it('persists across instances', () => {
    const store = new ReworkBinStore(filePath);
    const piled = store.pile('dispatch', REF, 100);
    if (!piled.ok) throw new Error('pile failed');

    const reloaded = new ReworkBinStore(filePath);
    expect(reloaded.hasRecords()).toBe(true);
    expect(reloaded.getPiled()).toHaveLength(1);
    expect(reloaded.getById(piled.item.id)?.failureRef).toEqual(REF);
  });
});
