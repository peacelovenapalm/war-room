import Fastify from 'fastify';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerMemoryRoutes } from '../src/httpServer.js';
import { MemoryStore } from '../src/memoryStore.js';
import { memoryMorningDate, MemoryTallyStore } from '../src/memoryTallyStore.js';
import { MorningStreakStore } from '../src/morningStreakStore.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-tally-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('MemoryTallyStore', () => {
  it('uses the configured morning timezone with a deterministic fallback', () => {
    const instant = Date.parse('2026-07-13T05:30:00Z');
    expect(memoryMorningDate(instant, { WAR_ROOM_MORNING_TZ: 'America/Denver' })).toBe(
      '2026-07-12',
    );
    expect(memoryMorningDate(instant, { WAR_ROOM_MORNING_TZ: 'not/a-zone' })).toBe('2026-07-12');
  });
  it('starts at honest zeros and counts a morning surface once per V6 streak date', () => {
    const tally = new MemoryTallyStore();
    const streak = { lastRecordedDate: '2026-07-13' };
    expect(tally.getSnapshot(streak)).toMatchObject({
      graphAnswered: 0,
      rederived: 0,
      surfacesOpenedPerMorning: 0,
      morningDate: '2026-07-13',
    });
    tally.recordMorningSurfaceOpened('2026-07-13');
    tally.recordMorningSurfaceOpened('2026-07-13');
    expect(tally.getSnapshot(streak).surfacesOpenedPerMorning).toBe(1);
    expect(tally.getSnapshot({ lastRecordedDate: '2026-07-14' }).surfacesOpenedPerMorning).toBe(0);
  });

  it('runtime-denies unknown attribution classes', () => {
    const tally = new MemoryTallyStore();
    expect(tally.recordAttribution('graph-answered')).toEqual({ ok: true });
    expect(tally.recordAttribution('rederived')).toEqual({ ok: true });
    expect(tally.recordAttribution('fabricated-success')).toEqual({
      ok: false,
      reason: 'unknown-attribution',
    });
    expect(tally.getSnapshot({ lastRecordedDate: null })).toMatchObject({
      graphAnswered: 1,
      rederived: 1,
    });
  });
});

describe('/api/memory routes via Fastify.inject', () => {
  it('tallies both allowed outcomes and 400s malformed/unknown bodies', async () => {
    const app = Fastify();
    const tally = new MemoryTallyStore();
    const streak = new MorningStreakStore(path.join(tmpDir, 'morning-streak.json'));
    registerMemoryRoutes(app, {
      tally,
      streak,
      store: new MemoryStore({ vaultRoot: tmpDir, notifyPromotion: () => undefined }),
    });

    const empty = await app.inject({ method: 'GET', url: '/api/memory/tally' });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({ graphAnswered: 0, rederived: 0 });

    for (const attribution of ['graph-answered', 'rederived']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/memory/tally',
        payload: { attribution },
      });
      expect(response.statusCode).toBe(200);
    }
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/memory/tally',
      payload: { attribution: 'anything-else' },
    });
    expect(rejected.statusCode).toBe(400);
    expect(tally.getSnapshot({ lastRecordedDate: null })).toMatchObject({
      graphAnswered: 1,
      rederived: 1,
    });
    await app.close();
  });

  it('cannot flip DIRECT early and supports the single revocation flag', async () => {
    const app = Fastify();
    const store = new MemoryStore({ vaultRoot: tmpDir, notifyPromotion: () => undefined });
    registerMemoryRoutes(app, {
      store,
      tally: new MemoryTallyStore(),
      streak: new MorningStreakStore(path.join(tmpDir, 'morning-streak.json')),
    });
    const early = await app.inject({
      method: 'POST',
      url: '/api/memory/direct',
      payload: { enabled: true },
    });
    expect(early.statusCode).toBe(409);
    expect(store.getState().mode).toBe('staged');
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/memory/direct',
      payload: { enabled: 'yes' },
    });
    expect(malformed.statusCode).toBe(400);
    const revoke = await app.inject({
      method: 'POST',
      url: '/api/memory/direct',
      payload: { enabled: false },
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json()).toEqual({ ok: true, changed: false });
    await app.close();
  });
});
