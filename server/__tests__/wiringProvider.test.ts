/**
 * WIRING auto-detect tests (v4 T7 slice 3): env-parsed scan roots, a
 * depth-bounded discovery of `.planning/STATE.md` files, the honest
 * "nothing configured" empty state, and the time-budget truncation flag.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearWiringCache, getWiringSnapshot, parseWiringRoots } from '../src/wiringProvider.js';

let tmpDir: string;
const savedEnv = process.env['WAR_ROOM_WIRING_ROOTS'];

function writeStateFile(projectDir: string, milestone: string, gates: string[] = []): void {
  const planningDir = path.join(projectDir, '.planning');
  fs.mkdirSync(planningDir, { recursive: true });
  const gateLines = gates
    .map((id) => `  - id: ${id}\n    label: "${id}"\n    status: TODO\n`)
    .join('');
  fs.writeFileSync(
    path.join(planningDir, 'STATE.md'),
    `---\nmilestone_name: ${milestone}\ngates:\n${gateLines}---\n`,
  );
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiring-provider-'));
  clearWiringCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (savedEnv === undefined) delete process.env['WAR_ROOM_WIRING_ROOTS'];
  else process.env['WAR_ROOM_WIRING_ROOTS'] = savedEnv;
  clearWiringCache();
});

describe('parseWiringRoots', () => {
  it('returns an empty list for undefined/empty input', () => {
    expect(parseWiringRoots(undefined)).toEqual([]);
    expect(parseWiringRoots('')).toEqual([]);
  });

  it('splits on comma or colon and trims whitespace', () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'wiring-a-'));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'wiring-b-'));
    try {
      expect(parseWiringRoots(` ${a} , ${b} `)).toEqual([a, b]);
      expect(parseWiringRoots(`${a}:${b}`)).toEqual([a, b]);
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });

  it('drops entries that are not existing directories', () => {
    expect(parseWiringRoots(`${tmpDir}/does-not-exist`)).toEqual([]);
  });
});

describe('getWiringSnapshot', () => {
  it('reports an empty honest state when WAR_ROOM_WIRING_ROOTS is unset', () => {
    delete process.env['WAR_ROOM_WIRING_ROOTS'];
    const snapshot = getWiringSnapshot();
    expect(snapshot.scanRoots).toEqual([]);
    expect(snapshot.projects).toEqual([]);
    expect(snapshot.truncated).toBe(false);
  });

  it('discovers a .planning/STATE.md one level under the scan root', () => {
    writeStateFile(path.join(tmpDir, 'proj-a'), 'Project A', ['g1', 'g2']);
    process.env['WAR_ROOM_WIRING_ROOTS'] = tmpDir;

    const snapshot = getWiringSnapshot();
    expect(snapshot.scanRoots).toEqual([tmpDir]);
    expect(snapshot.projects).toEqual([
      { scanRoot: tmpDir, relativePath: 'proj-a', milestone: 'Project A', gateCount: 2 },
    ]);
  });

  it('discovers a project nested up to MAX_SCAN_DEPTH but not beyond', () => {
    // depth 2 (org/proj) — within the 3-level cap.
    writeStateFile(path.join(tmpDir, 'org', 'proj-b'), 'Nested B');
    // depth 4 — beyond the cap, must NOT be found.
    writeStateFile(path.join(tmpDir, 'a', 'b', 'c', 'proj-deep'), 'Too Deep');
    process.env['WAR_ROOM_WIRING_ROOTS'] = tmpDir;

    const snapshot = getWiringSnapshot();
    const relPaths = snapshot.projects.map((p) => p.relativePath);
    expect(relPaths).toContain(path.join('org', 'proj-b'));
    expect(relPaths).not.toContain(path.join('a', 'b', 'c', 'proj-deep'));
  });

  it('never crashes on an unreadable subdirectory', () => {
    writeStateFile(path.join(tmpDir, 'proj-a'), 'Project A');
    // A file (not a dir) sitting where the scanner might try to readdir.
    fs.writeFileSync(path.join(tmpDir, 'not-a-dir.txt'), 'x');
    process.env['WAR_ROOM_WIRING_ROOTS'] = tmpDir;

    expect(() => getWiringSnapshot()).not.toThrow();
    expect(getWiringSnapshot().projects.length).toBe(1);
  });

  it('serves from cache within the TTL and recomputes after clearWiringCache()', () => {
    writeStateFile(path.join(tmpDir, 'proj-a'), 'Version 1');
    process.env['WAR_ROOM_WIRING_ROOTS'] = tmpDir;

    const first = getWiringSnapshot(1_000);
    writeStateFile(path.join(tmpDir, 'proj-a'), 'Version 2');
    const stillCached = getWiringSnapshot(1_000 + 30_000);
    expect(stillCached.projects).toEqual(first.projects);

    clearWiringCache();
    const recomputed = getWiringSnapshot(1_000 + 30_000);
    expect(recomputed.projects[0].milestone).toBe('Version 2');
  });
});
