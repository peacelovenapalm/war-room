/**
 * Routine inbox provider (v4 T7 slice 2 — KICKOFF-v4 §T7 "routine inbox
 * tray"). Lists recent Brain2 vault routine outputs (vault-health,
 * project-pulse, docs-tracker, daily-digest, todo-compiler, etc.) from the
 * same `WAR_ROOM_ROUTINES_DIR` mount briefingProvider.ts reads its digest
 * from (`_inbox/routines/` on the vault clone — see
 * .planning/runbooks/nexus-war-room-deploy.sh).
 *
 * Missing env var, missing dir, or any per-entry stat/read failure never
 * throws: `available: false` (or the entry is skipped) and one `⚠` line is
 * logged, same tolerant posture as briefingProvider.ts and graphProvider.ts.
 * GET /api/inbox and GET /api/inbox/content (httpServer.ts) are
 * unauthenticated, same trust tier as /api/briefing and /api/graph/search
 * — the server itself is tailnet-only.
 *
 * Path-traversal safety (readInboxFile): every read resolves the joined
 * path with `path.resolve` and verifies the result stays under the mount
 * root AND under a real (non-".", non-".."-containing, dotfile-free)
 * immediate child dir -- a caller cannot escape via `..`, symlink games are
 * not chased (fs.readFileSync doesn't follow into a different mount), and
 * a `routine` or `file` segment starting with "." is rejected outright.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface InboxEntry {
  /** The routine's own subdir name (e.g. "vault-health", "summary"). */
  routine: string;
  /** Bare filename, no directory component. */
  filename: string;
  /** File mtime, epoch ms. */
  mtimeMs: number;
  /** now - mtimeMs, computed at request time. */
  ageMs: number;
}

export interface InboxListing {
  /** false when WAR_ROOM_ROUTINES_DIR isn't set/readable — the UI renders
   *  an honest "no inbox source" state, never an empty-but-plausible list. */
  available: boolean;
  entries: InboxEntry[];
  generatedAt: string;
}

/** Cross-routine cap — the tray renders a short newest-first list, not a
 *  full ledger dump. */
export const INBOX_MAX_ENTRIES = 20;
const CACHE_TTL_MS = 60_000;

/** Subdirs skipped outright: `_ledger`/`_processed` are bookkeeping, not
 *  routine output a human reads in the tray. */
function isRoutineDir(name: string): boolean {
  return !name.startsWith('.') && !name.startsWith('_');
}

function isSafeLeafName(name: string): boolean {
  return name.length > 0 && !name.startsWith('.') && !name.includes('/') && !name.includes('\\');
}

let cache: { at: number; listing: InboxListing } | null = null;

/** Get the inbox listing, serving from a 60s TTL cache when fresh. */
export function getInboxListing(now: number = Date.now()): InboxListing {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.listing;
  const listing = computeInboxListing(now);
  cache = { at: now, listing };
  return listing;
}

/** Test-only: force the next getInboxListing() call to recompute. */
export function clearInboxCache(): void {
  cache = null;
}

function computeInboxListing(now: number): InboxListing {
  const root = process.env['WAR_ROOM_ROUTINES_DIR'];
  const generatedAt = new Date(now).toISOString();
  if (!root) {
    console.log('[Inbox] ⚠ WAR_ROOM_ROUTINES_DIR not set -- inbox tray disabled');
    return { available: false, entries: [], generatedAt };
  }

  let routineDirs: string[];
  try {
    routineDirs = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && isRoutineDir(d.name))
      .map((d) => d.name);
  } catch (err) {
    console.log(
      `[Inbox] ⚠ failed to read WAR_ROOM_ROUTINES_DIR (${root}): ${(err as Error).message}`,
    );
    return { available: false, entries: [], generatedAt };
  }

  const all: InboxEntry[] = [];
  for (const routine of routineDirs) {
    const dir = path.join(root, routine);
    let files: string[];
    try {
      files = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && d.name.endsWith('.md') && isSafeLeafName(d.name))
        .map((d) => d.name);
    } catch {
      continue; // one unreadable routine dir never poisons the whole tray
    }
    for (const filename of files) {
      try {
        const stat = fs.statSync(path.join(dir, filename));
        all.push({ routine, filename, mtimeMs: stat.mtimeMs, ageMs: now - stat.mtimeMs });
      } catch {
        continue; // race (file removed between readdir and stat) -- skip
      }
    }
  }

  all.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { available: true, entries: all.slice(0, INBOX_MAX_ENTRIES), generatedAt };
}

export type InboxContentResult =
  { ok: true; content: string } | { ok: false; reason: 'unavailable' | 'invalid' | 'not-found' };

/**
 * Read one inbox entry's markdown body for the one-tap-open panel.
 * `routine` and `file` are untrusted request input -- both must be bare
 * leaf names (no separators, no leading dot) and the resolved path must
 * stay under `root/routine/`. Anything else is `invalid`, never a throw.
 */
export function readInboxFile(routine: string, file: string): InboxContentResult {
  const root = process.env['WAR_ROOM_ROUTINES_DIR'];
  if (!root) return { ok: false, reason: 'unavailable' };
  if (!isSafeLeafName(routine) || !isSafeLeafName(file) || !file.endsWith('.md')) {
    return { ok: false, reason: 'invalid' };
  }

  const routineRoot = path.resolve(root, routine);
  const resolvedRoot = path.resolve(root);
  if (routineRoot !== path.join(resolvedRoot, routine)) {
    return { ok: false, reason: 'invalid' };
  }
  const target = path.resolve(routineRoot, file);
  if (target !== path.join(routineRoot, file)) {
    return { ok: false, reason: 'invalid' };
  }

  try {
    const content = fs.readFileSync(target, 'utf-8');
    return { ok: true, content };
  } catch {
    return { ok: false, reason: 'not-found' };
  }
}
