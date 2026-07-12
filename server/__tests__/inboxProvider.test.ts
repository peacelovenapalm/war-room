/**
 * Routine inbox provider tests (v4 T7 slice 2): newest-first cross-routine
 * listing capped at INBOX_MAX_ENTRIES, bookkeeping-dir exclusion, the
 * honest available:false posture when the mount is absent, and
 * readInboxFile's path-traversal rejection.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearInboxCache,
  getInboxListing,
  INBOX_MAX_ENTRIES,
  readInboxFile,
} from '../src/inboxProvider.js';

let tmpDir: string;
const savedEnv = process.env['WAR_ROOM_ROUTINES_DIR'];

function writeRoutineFile(routine: string, filename: string, body: string, mtime?: Date): void {
  const dir = path.join(tmpDir, routine);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, filename);
  fs.writeFileSync(file, body);
  if (mtime) fs.utimesSync(file, mtime, mtime);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-provider-'));
  process.env['WAR_ROOM_ROUTINES_DIR'] = tmpDir;
  clearInboxCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (savedEnv === undefined) delete process.env['WAR_ROOM_ROUTINES_DIR'];
  else process.env['WAR_ROOM_ROUTINES_DIR'] = savedEnv;
  clearInboxCache();
});

describe('getInboxListing', () => {
  it('reports available:false and an empty list when the env var is unset', () => {
    delete process.env['WAR_ROOM_ROUTINES_DIR'];
    const listing = getInboxListing();
    expect(listing.available).toBe(false);
    expect(listing.entries).toEqual([]);
  });

  it('reports available:false when the configured dir does not exist', () => {
    process.env['WAR_ROOM_ROUTINES_DIR'] = path.join(tmpDir, 'nope');
    const listing = getInboxListing();
    expect(listing.available).toBe(false);
    expect(listing.entries).toEqual([]);
  });

  it('lists entries across routine subdirs newest-first', () => {
    writeRoutineFile('vault-health', '2026-07-10.md', 'old', new Date('2026-07-10T06:00:00Z'));
    writeRoutineFile('todo', '2026-07-11.md', 'newer', new Date('2026-07-11T07:00:00Z'));
    writeRoutineFile('summary', '2026-07-11-digest.md', 'newest', new Date('2026-07-11T07:30:00Z'));
    clearInboxCache();

    const listing = getInboxListing();
    expect(listing.available).toBe(true);
    expect(listing.entries.map((e) => e.filename)).toEqual([
      '2026-07-11-digest.md',
      '2026-07-11.md',
      '2026-07-10.md',
    ]);
    expect(listing.entries[0].routine).toBe('summary');
  });

  it('excludes bookkeeping dirs (leading underscore/dot) and non-.md files', () => {
    writeRoutineFile('_ledger', 'internal.md', 'skip me');
    writeRoutineFile('todo', 'notes.txt', 'not markdown');
    writeRoutineFile('todo', '2026-07-11.md', 'real entry');
    clearInboxCache();

    const listing = getInboxListing();
    expect(listing.entries.map((e) => e.filename)).toEqual(['2026-07-11.md']);
  });

  it('caps the list at INBOX_MAX_ENTRIES', () => {
    for (let i = 0; i < INBOX_MAX_ENTRIES + 5; i++) {
      writeRoutineFile('todo', `2026-01-${String(i + 1).padStart(2, '0')}.md`, 'x');
    }
    clearInboxCache();
    expect(getInboxListing().entries.length).toBe(INBOX_MAX_ENTRIES);
  });

  it('serves from cache within the TTL and recomputes after clearInboxCache()', () => {
    writeRoutineFile('todo', '2026-07-11.md', 'x');
    const first = getInboxListing(1_000);
    writeRoutineFile('todo', '2026-07-12.md', 'y');
    const stillCached = getInboxListing(1_000 + 30_000);
    expect(stillCached.entries).toEqual(first.entries);

    clearInboxCache();
    const recomputed = getInboxListing(1_000 + 30_000);
    expect(recomputed.entries.length).toBe(2);
  });
});

describe('readInboxFile', () => {
  it('reads a valid routine/file pair', () => {
    writeRoutineFile('todo', '2026-07-11.md', '# hello\n');
    const result = readInboxFile('todo', '2026-07-11.md');
    expect(result).toEqual({ ok: true, content: '# hello\n' });
  });

  it('rejects when WAR_ROOM_ROUTINES_DIR is unset', () => {
    delete process.env['WAR_ROOM_ROUTINES_DIR'];
    expect(readInboxFile('todo', '2026-07-11.md')).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('rejects path-traversal attempts in the file segment', () => {
    writeRoutineFile('todo', '2026-07-11.md', 'x');
    expect(readInboxFile('todo', '../summary/2026-07-11-digest.md')).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(readInboxFile('todo', '..%2f..%2fetc%2fpasswd.md')).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects path-traversal attempts in the routine segment', () => {
    expect(readInboxFile('../etc', 'passwd.md')).toEqual({ ok: false, reason: 'invalid' });
    expect(readInboxFile('todo/../../etc', 'passwd.md')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects dotfiles and non-.md extensions', () => {
    writeRoutineFile('todo', '.secret.md', 'x');
    expect(readInboxFile('todo', '.secret.md')).toEqual({ ok: false, reason: 'invalid' });
    expect(readInboxFile('todo', 'notes.txt')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('returns not-found for a missing but well-formed path', () => {
    expect(readInboxFile('todo', 'does-not-exist.md')).toEqual({
      ok: false,
      reason: 'not-found',
    });
  });
});
