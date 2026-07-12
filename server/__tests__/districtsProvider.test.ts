/**
 * districtsProvider tests (Phase 5 Lane C T7/D-35; v5 C1 N-project build-
 * out) — env-var + tolerant-read + cache discipline, mirroring
 * briefingProvider.test.ts/graphProvider.test.ts. The legacy 2-seed path
 * (WAR_ROOM_DISTRICTS_DIR unset) is exercised independently from the new
 * data-driven directory-scan path, plus the additive-override dedupe when
 * both are configured together.
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
const DIR_ENV = 'WAR_ROOM_DISTRICTS_DIR';
const savedWarroom = process.env[WARROOM_ENV];
const savedTwe = process.env[TWE_ENV];
const savedDir = process.env[DIR_ENV];

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'districts-provider-'));
  delete process.env[WARROOM_ENV];
  delete process.env[TWE_ENV];
  delete process.env[DIR_ENV];
  clearDistrictsCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (savedWarroom === undefined) delete process.env[WARROOM_ENV];
  else process.env[WARROOM_ENV] = savedWarroom;
  if (savedTwe === undefined) delete process.env[TWE_ENV];
  else process.env[TWE_ENV] = savedTwe;
  if (savedDir === undefined) delete process.env[DIR_ENV];
  else process.env[DIR_ENV] = savedDir;
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

describe('getDistricts — WAR_ROOM_DISTRICTS_DIR (v5 C1 data-driven scan)', () => {
  it('root unset -> behavior is exactly the legacy 2-seed path (already covered above)', () => {
    // Sanity re-assertion at this describe's own env baseline (root always
    // deleted in the shared beforeEach): still exactly 2 unknown seeds.
    const snapshot = getDistricts();
    expect(snapshot.projects.map((p) => p.key)).toEqual(['war-room', 'twe']);
  });

  it('root set but empty directory -> zero projects (no legacy fallback)', () => {
    process.env[DIR_ENV] = tmpDir;
    const snapshot = getDistricts();
    expect(snapshot.projects).toEqual([]);
  });

  it('root set but does not exist -> zero projects, never a throw', () => {
    process.env[DIR_ENV] = path.join(tmpDir, 'does-not-exist-root');
    expect(() => getDistricts()).not.toThrow();
    expect(getDistricts().projects).toEqual([]);
  });

  it('subdir with .planning/STATE.md -> real milestone state, humanized label', () => {
    const sub = path.join(tmpDir, 'diablito');
    fs.mkdirSync(path.join(sub, '.planning'), { recursive: true });
    fs.writeFileSync(
      path.join(sub, '.planning', 'STATE.md'),
      '---\nmilestone_name: "v1.0"\nprogress:\n  percent: 100\nlast_updated: "2026-07-06"\n---\n',
    );
    process.env[DIR_ENV] = tmpDir;

    const snapshot = getDistricts();
    expect(snapshot.projects).toHaveLength(1);
    const project = snapshot.projects[0];
    expect(project.key).toBe('diablito');
    expect(project.label).toBe('DIABLITO');
    expect(project.phase).toBe('v1.0');
    expect(project.progress).toBe(1);
    expect(project.lastActivity).toBe('2026-07-06');
    expect(project.source).toBe(`file:${path.join(sub, '.planning', 'STATE.md')}`);
  });

  it('subdir with top-level STATE.md (no .planning/) -> falls back to that file', () => {
    const sub = path.join(tmpDir, 'neon-goat');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, 'STATE.md'), 'status: PARKED\n');
    process.env[DIR_ENV] = tmpDir;

    const snapshot = getDistricts();
    const project = snapshot.projects.find((p) => p.key === 'neon-goat');
    expect(project?.source).toBe(`file:${path.join(sub, 'STATE.md')}`);
    expect(project?.phase).toBe('PARKED');
  });

  it('subdir with neither .planning/STATE.md nor STATE.md -> honest unknown, never a throw', () => {
    const sub = path.join(tmpDir, 'bossa-pipeline');
    fs.mkdirSync(sub, { recursive: true });
    process.env[DIR_ENV] = tmpDir;

    const snapshot = getDistricts();
    const project = snapshot.projects.find((p) => p.key === 'bossa-pipeline');
    expect(project?.source).toBe('unknown');
    expect(project?.phase).toBeNull();
    expect(project?.progress).toBeNull();
    expect(project?.lastActivity).toBeNull();
    expect(project?.label).toBe('BOSSA PIPELINE');
  });

  it('oversized STATE.md under a scanned subdir is refused -> honest unknown', () => {
    const sub = path.join(tmpDir, 'oversized-project');
    fs.mkdirSync(path.join(sub, '.planning'), { recursive: true });
    const file = path.join(sub, '.planning', 'STATE.md');
    const fd = fs.openSync(file, 'w');
    try {
      fs.ftruncateSync(fd, STATE_FILE_MAX_BYTES + 1);
    } finally {
      fs.closeSync(fd);
    }
    process.env[DIR_ENV] = tmpDir;

    const snapshot = getDistricts();
    const project = snapshot.projects.find((p) => p.key === 'oversized-project');
    expect(project?.source).toBe('unknown');
    expect(project?.phase).toBeNull();
  });

  it('the known war-room/two-wheel-events keys keep their special-case labels', () => {
    fs.mkdirSync(path.join(tmpDir, 'war-room'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'two-wheel-events'), { recursive: true });
    process.env[DIR_ENV] = tmpDir;

    const snapshot = getDistricts();
    expect(snapshot.projects.find((p) => p.key === 'war-room')?.label).toBe('WAR ROOM');
    expect(snapshot.projects.find((p) => p.key === 'two-wheel-events')?.label).toBe('TWE');
  });

  it('legacy env override dedupe: explicit legacy env wins over the directory-scanned entry for the same key', () => {
    // Directory scan produces a real 'war-room' entry from the mount...
    const scannedSub = path.join(tmpDir, 'war-room');
    fs.mkdirSync(path.join(scannedSub, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(scannedSub, '.planning', 'STATE.md'), 'status: FROM SCAN\n');
    process.env[DIR_ENV] = tmpDir;

    // ...but an explicit legacy env var for the SAME key ('war-room') wins.
    const legacyFile = path.join(tmpDir, 'legacy-warroom-state.md');
    fs.writeFileSync(legacyFile, 'status: FROM LEGACY ENV\n');
    process.env[WARROOM_ENV] = legacyFile;

    const snapshot = getDistricts();
    const projects = snapshot.projects.filter((p) => p.key === 'war-room');
    expect(projects).toHaveLength(1); // deduped, not duplicated
    expect(projects[0].phase).toBe('FROM LEGACY ENV');
    expect(projects[0].source).toBe(`file:${legacyFile}`);
  });

  it('legacy env override dedupe via the twe <-> two-wheel-events alias: scanned "two-wheel-events" + WAR_ROOM_DISTRICT_TWE_STATE set -> exactly ONE row, env-sourced (not two)', () => {
    // Directory scan produces a real 'two-wheel-events' entry from the
    // nexus clone (the actual directory name, NOT the legacy 'twe' key) --
    // this is the collision the naive `p.key === seed.key` dedupe misses.
    const scannedSub = path.join(tmpDir, 'two-wheel-events');
    fs.mkdirSync(path.join(scannedSub, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(scannedSub, '.planning', 'STATE.md'), 'status: FROM SCAN\n');
    process.env[DIR_ENV] = tmpDir;

    // ...and the legacy TWE env var (keyed 'twe') is ALSO set for the same
    // real project.
    const legacyFile = path.join(tmpDir, 'legacy-twe-state.md');
    fs.writeFileSync(legacyFile, 'status: FROM LEGACY ENV\n');
    process.env[TWE_ENV] = legacyFile;

    const snapshot = getDistricts();
    // Exactly one row for this project -- no 'twe' AND 'two-wheel-events'
    // duplicate pair.
    expect(snapshot.projects).toHaveLength(1);
    const project = snapshot.projects[0];
    // The merged row keeps the scanned entry's identity (the directory-scan
    // key already occupied that slot) ...
    expect(project.key).toBe('two-wheel-events');
    expect(project.label).toBe('TWE');
    // ... but explicit env wins on content.
    expect(project.phase).toBe('FROM LEGACY ENV');
    expect(project.source).toBe(`file:${legacyFile}`);
  });

  it('legacy env additive: a legacy var for a key the scan never produced is appended, not dropped', () => {
    fs.mkdirSync(path.join(tmpDir, 'some-other-project'), { recursive: true });
    process.env[DIR_ENV] = tmpDir;

    const legacyFile = path.join(tmpDir, 'twe-state.md');
    fs.writeFileSync(legacyFile, 'status: TWE VIA LEGACY\n');
    process.env[TWE_ENV] = legacyFile;

    const snapshot = getDistricts();
    expect(snapshot.projects.map((p) => p.key).sort()).toEqual(['some-other-project', 'twe']);
    expect(snapshot.projects.find((p) => p.key === 'twe')?.phase).toBe('TWE VIA LEGACY');
  });

  it('an unset legacy var does not clobber a directory-scanned entry of the same key', () => {
    const sub = path.join(tmpDir, 'war-room');
    fs.mkdirSync(path.join(sub, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(sub, '.planning', 'STATE.md'), 'status: SCANNED ONLY\n');
    process.env[DIR_ENV] = tmpDir;
    // WARROOM_ENV deliberately left unset.

    const snapshot = getDistricts();
    const project = snapshot.projects.find((p) => p.key === 'war-room');
    expect(project?.phase).toBe('SCANNED ONLY');
  });

  it('non-directory entries under the root (stray files) are ignored, not treated as projects', () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# not a project\n');
    fs.mkdirSync(path.join(tmpDir, 'real-project'), { recursive: true });
    process.env[DIR_ENV] = tmpDir;

    const snapshot = getDistricts();
    expect(snapshot.projects.map((p) => p.key)).toEqual(['real-project']);
  });
});
