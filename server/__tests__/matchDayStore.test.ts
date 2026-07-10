/**
 * Match Day store skeleton tests (v3 WS-C stage 1): fixture-per-real-run
 * idempotence, one-tap-real feed refs, the NO-DATA-never-guessed result
 * validation, settled-fixture retention pruning, wire-shape stripping,
 * and sidecar persistence round-trip.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { MatchDayFeedEvent, MatchDayResult } from '../../core/src/messages.js';
import {
  MATCH_DAY_SETTLED_RETENTION,
  MatchDayStore,
  toMatchDayEvent,
} from '../src/matchDayStore.js';

let tmpDir: string;
let filePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-day-store-'));
  filePath = path.join(tmpDir, 'match-days.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const FEED_EVENT: MatchDayFeedEvent = {
  ts: 200,
  kind: 'step-exited',
  sourceRef: 'chainStep:run-1/s1',
  commentary: 'First hurdle cleared.',
};

const VALID_RESULT: MatchDayResult = {
  verdict: 'W',
  tests: { status: 'REAL', value: 12, sourceRef: 'chainStep:run-1/s2' },
  build: { status: 'REAL', value: 0, sourceRef: 'chainStep:run-1/s3' },
  scope: { status: 'NO_DATA' },
  burn: { status: 'NO_DATA' },
};

describe('MatchDayStore', () => {
  it('opens one fixture per unsettled real chain run (idempotent)', () => {
    const store = new MatchDayStore(filePath);
    const first = store.openFixture('run-1', 100);
    const again = store.openFixture('run-1', 150);
    expect(first.ok && again.ok && first.fixture.fixtureId === again.fixture.fixtureId).toBe(true);
    expect(store.getAll()).toHaveLength(1);
    expect(store.openFixture('  ')).toEqual({ ok: false, reason: 'empty-chain-run-id' });
  });

  it('requires a sourceRef on every feed event and advances pre → live on kickoff', () => {
    const store = new MatchDayStore(filePath);
    const opened = store.openFixture('run-1', 100);
    if (!opened.ok) throw new Error('open failed');
    const id = opened.fixture.fixtureId;

    expect(store.recordEvent(id, { ...FEED_EVENT, sourceRef: ' ' })).toEqual({
      ok: false,
      reason: 'missing-source-ref',
    });
    expect(store.getById(id)?.phase).toBe('pre');

    expect(store.recordEvent(id, FEED_EVENT).ok).toBe(true);
    expect(store.getById(id)?.phase).toBe('live');
    expect(store.getById(id)?.events).toHaveLength(1);
  });

  it('refuses malformed result cards — NO DATA is never guessed, REAL always has a ref', () => {
    const store = new MatchDayStore(filePath);
    const opened = store.openFixture('run-1', 100);
    if (!opened.ok) throw new Error('open failed');
    const id = opened.fixture.fixtureId;

    expect(
      store.settle(id, { ...VALID_RESULT, tests: { status: 'REAL', sourceRef: 'x' } }, 300),
    ).toEqual({ ok: false, reason: 'real-axis-missing-value' });
    expect(store.settle(id, { ...VALID_RESULT, build: { status: 'REAL', value: 1 } }, 300)).toEqual(
      { ok: false, reason: 'real-axis-missing-source-ref' },
    );
    expect(
      store.settle(id, { ...VALID_RESULT, scope: { status: 'NO_DATA', value: 3 } }, 300),
    ).toEqual({ ok: false, reason: 'no-data-axis-carries-data' });
    expect(store.getById(id)?.phase).toBe('pre');

    expect(store.settle(id, VALID_RESULT, 300).ok).toBe(true);
    expect(store.getById(id)?.phase).toBe('result');
    expect(store.getById(id)?.result?.verdict).toBe('W');
    // Terminal: no more events, no re-settle.
    expect(store.recordEvent(id, FEED_EVENT)).toEqual({ ok: false, reason: 'already-settled' });
    expect(store.settle(id, VALID_RESULT, 400)).toEqual({ ok: false, reason: 'already-settled' });
    expect(store.getActive()).toHaveLength(0);
  });

  it('prunes the oldest settled fixtures past the retention cap', () => {
    const store = new MatchDayStore(filePath);
    for (let i = 0; i < MATCH_DAY_SETTLED_RETENTION + 3; i++) {
      const opened = store.openFixture(`run-${i}`, i);
      if (!opened.ok) throw new Error('open failed');
      store.settle(opened.fixture.fixtureId, VALID_RESULT, 1_000 + i);
    }
    const settled = store.getAll().filter((f) => f.phase === 'result');
    expect(settled.length).toBeLessThanOrEqual(MATCH_DAY_SETTLED_RETENTION + 1);
    // The earliest runs are the pruned ones.
    expect(settled.some((f) => f.chainRunId === 'run-0')).toBe(false);
  });

  it('toMatchDayEvent emits exactly the wire shape (no internal bookkeeping)', () => {
    const store = new MatchDayStore(filePath);
    const opened = store.openFixture('run-1', 100);
    if (!opened.ok) throw new Error('open failed');
    const msg = toMatchDayEvent(opened.fixture);
    expect(msg).toEqual({
      type: 'matchDayEvent',
      fixtureId: opened.fixture.fixtureId,
      chainRunId: 'run-1',
      phase: 'pre',
      events: [],
    });
    expect('createdAt' in msg).toBe(false);
    expect('result' in msg).toBe(false);
  });

  it('persists across instances', () => {
    const store = new MatchDayStore(filePath);
    const opened = store.openFixture('run-1', 100);
    if (!opened.ok) throw new Error('open failed');
    store.recordEvent(opened.fixture.fixtureId, FEED_EVENT);

    const reloaded = new MatchDayStore(filePath);
    expect(reloaded.hasRecords()).toBe(true);
    expect(reloaded.getById(opened.fixture.fixtureId)?.events).toEqual([FEED_EVENT]);
  });
});
