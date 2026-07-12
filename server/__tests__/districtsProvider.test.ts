/**
 * districtsProvider tests (Phase 5 Lane C, T7/D-35) — env-var + tolerant-
 * read + cache discipline, mirroring briefingProvider.test.ts/
 * graphProvider.test.ts. The two seeds (war-room, twe) are exercised
 * independently so one project's honest-unknown fallback never masks the
 * other's real data.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearDistrictsCache,
  getDistricts,
  STATE_FILE_MAX_BYTES,
} from '../src/districtsProvider.js';

const WARROOM_ENV = 'WAR_ROOM_DISTRICT_WARROOM_STATE';
const TWE_ENV = 'WAR_ROOM_DISTRICT_TWE_STATE';
const savedWarroom = process.env[WARROOM_ENV];
const savedTwe = process.env[TWE_ENV];

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'districts-provider-'));
  delete process.env[WARROOM_ENV];
  delete process.env[TWE_ENV];
  clearDistrictsCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (savedWarroom === undefined) delete process.env[WARROOM_ENV];
  else process.env[WARROOM_ENV] = savedWarroom;
  if (savedTwe === undefined) delete process.env[TWE_ENV];
  else process.env[TWE_ENV] = savedTwe;
  clearDistrictsCache();
});

describe('getDistricts', () => {
  it('both env vars unset -> both projects render honest unknown state', () => {
    const snapshot = getDistricts();
    expect(snapshot.projects).toHaveLength(2);
    for (const project of snapshot.projects) {
      expect(project.phase).toBeNull();
      expect(project.progress).toBeNull();
      expect(project.lastActivity).toBeNull();
      expect(project.source).toBe('unknown');
    }
    expect(snapshot.projects.map((p) => p.key)).toEqual(['war-room', 'twe']);
  });

  it('env var set but file missing -> that project falls back to unknown, never a throw', () => {
    process.env[WARROOM_ENV] = path.join(tmpDir, 'does-not-exist.md');
    const snapshot = getDistricts();
    const warroom = snapshot.projects.find((p) => p.key === 'war-room');
    expect(warroom?.source).toBe('unknown');
  });

  it('one project configured, the other not -> independent results', () => {
    const file = path.join(tmpDir, 'STATE.md');
    fs.writeFileSync(
      file,
      'status: RUN COMPLETE\n\n## Items\n\n| # | Item | Status |\n| - | - | - |\n| 1 | a | done (x) |\n',
    );
    process.env[WARROOM_ENV] = file;

    const snapshot = getDistricts();
    const warroom = snapshot.projects.find((p) => p.key === 'war-room');
    const twe = snapshot.projects.find((p) => p.key === 'twe');
    expect(warroom?.source).toBe(`file:${file}`);
    expect(warroom?.phase).toBe('RUN COMPLETE');
    expect(warroom?.progress).toBe(1);
    expect(twe?.source).toBe('unknown');
  });

  it('caches for 60s: a file change is not observed until the cache expires', () => {
    const file = path.join(tmpDir, 'STATE.md');
    fs.writeFileSync(file, 'status: FIRST\n');
    process.env[WARROOM_ENV] = file;

    const first = getDistricts(1_000);
    expect(first.projects.find((p) => p.key === 'war-room')?.phase).toBe('FIRST');

    fs.writeFileSync(file, 'status: SECOND\n');
    const stillCached = getDistricts(1_000 + 30_000);
    expect(stillCached.projects.find((p) => p.key === 'war-room')?.phase).toBe('FIRST');

    const refreshed = getDistricts(1_000 + 60_001);
    expect(refreshed.projects.find((p) => p.key === 'war-room')?.phase).toBe('SECOND');
  });

  it('P5 review #3: a file over STATE_FILE_MAX_BYTES is refused -> honest unknown, never buffered', () => {
    const file = path.join(tmpDir, 'STATE.md');
    const fd = fs.openSync(file, 'w');
    try {
      fs.ftruncateSync(fd, STATE_FILE_MAX_BYTES + 1); // sparse — no real MB written
    } finally {
      fs.closeSync(fd);
    }
    process.env[WARROOM_ENV] = file;

    const snapshot = getDistricts();
    const warroom = snapshot.projects.find((p) => p.key === 'war-room');
    expect(warroom?.source).toBe('unknown');
    expect(warroom?.phase).toBeNull();
  });

  it('label is a stable human string for each seed key', () => {
    const snapshot = getDistricts();
    expect(snapshot.projects.find((p) => p.key === 'war-room')?.label).toBe('WAR ROOM');
    expect(snapshot.projects.find((p) => p.key === 'twe')?.label).toBe('TWE');
  });
});
