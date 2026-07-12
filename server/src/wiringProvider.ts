/**
 * WIRING auto-detect (v4 T7 slice 3 — KICKOFF-v4 §T7 "WIRING.md +
 * auto-detect"). The full ingest-path documentation lives in WIRING.md at
 * the repo root; this module is the "zero per-project config" half —
 * instead of hand-listing every project's STATE.md path, point the server
 * at one or more parent directories (WAR_ROOM_WIRING_ROOTS, comma or
 * colon-separated absolute paths) and it discovers every
 * `.planning/STATE.md` gsd-shaped file underneath, shallow (depth <= 3)
 * and time-bounded so a huge or symlink-cyclic root can never hang a
 * request.
 *
 * Reuses briefingProvider.ts's parseTrackerState (same tolerant, no-YAML-
 * dependency line parser the tracker panel already uses) — one parser, two
 * consumers, never a second copy to drift.
 *
 * Missing env var, an unreadable root, or a parse failure never throws:
 * that root is skipped with a `⚠` log line and the honest empty/partial
 * result is still returned. GET /api/wiring (httpServer.ts) is
 * unauthenticated, same tailnet-read tier as /api/briefing.
 */

import * as fs from 'fs';
import * as path from 'path';

import { parseTrackerState } from './briefingProvider.js';

export interface WiringProject {
  /** Which configured root this project was found under. */
  scanRoot: string;
  /** Path to the project dir (parent of `.planning/`), relative to scanRoot. */
  relativePath: string;
  milestone: string | null;
  gateCount: number;
}

export interface WiringSnapshot {
  scanRoots: string[];
  projects: WiringProject[];
  /** true when the time budget was hit before every root finished
   *  scanning — an honest partial result, never a silent truncation. */
  truncated: boolean;
  generatedAt: string;
}

/** Shallow scan cap — a project's STATE.md lives at `<root>/<proj>/
 *  .planning/STATE.md`, i.e. 2 levels under the scan root; 3 gives one
 *  level of slack (e.g. an org/repo nesting) without walking an entire
 *  home directory. */
const MAX_SCAN_DEPTH = 3;
/** Per-file read cap (P5 review #3) — a real STATE.md is a few KB. */
export const WIRING_STATE_MAX_BYTES = 1024 * 1024;
/** Wall-clock budget for one full getWiringSnapshot() call, across every
 *  configured root — protects against a huge or symlink-cyclic tree. */
const SCAN_TIME_BUDGET_MS = 2_000;
const CACHE_TTL_MS = 60_000;

let cache: { at: number; snapshot: WiringSnapshot } | null = null;

/** Get the wiring snapshot, serving from a 60s TTL cache when fresh —
 *  same discipline as briefingProvider/inboxProvider, not a bare
 *  "scan once at import time" (a root can be mounted/unmounted across a
 *  long-lived deploy without a restart). */
export function getWiringSnapshot(now: number = Date.now()): WiringSnapshot {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.snapshot;
  const snapshot = computeWiringSnapshot(now);
  cache = { at: now, snapshot };
  return snapshot;
}

/** Test-only: force the next getWiringSnapshot() call to recompute. */
export function clearWiringCache(): void {
  cache = null;
}

/** Parses WAR_ROOM_WIRING_ROOTS (comma or ':'-separated absolute paths),
 *  keeping only entries that exist and are directories. Unset/empty env
 *  -> an empty list, never a throw (the honest "nothing configured" case
 *  the panel renders as a plain empty list, not an error). */
export function parseWiringRoots(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,:]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .filter((p) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
}

function computeWiringSnapshot(now: number): WiringSnapshot {
  const scanRoots = parseWiringRoots(process.env['WAR_ROOM_WIRING_ROOTS']);
  const generatedAt = new Date(now).toISOString();
  if (scanRoots.length === 0) {
    console.log(
      '[Wiring] ⚠ WAR_ROOM_WIRING_ROOTS not set (or no valid dirs) -- auto-detect disabled',
    );
    return { scanRoots: [], projects: [], truncated: false, generatedAt };
  }

  // Wall-clock budget, deliberately NOT derived from the `now` param (that
  // param exists only to match the other providers' cache-TTL/generatedAt
  // convention and, in tests, is often an artificial timestamp far from
  // the real clock -- the scan's own timeout must always be real time).
  const deadline = Date.now() + SCAN_TIME_BUDGET_MS;
  const projects: WiringProject[] = [];
  let truncated = false;

  for (const root of scanRoots) {
    if (Date.now() > deadline) {
      truncated = true;
      break;
    }
    const found = scanRootForStateFiles(root, deadline);
    projects.push(...found.projects);
    if (found.truncated) truncated = true;
  }

  return { scanRoots, projects, truncated, generatedAt };
}

function scanRootForStateFiles(
  root: string,
  deadline: number,
): { projects: WiringProject[]; truncated: boolean } {
  const projects: WiringProject[] = [];
  let truncated = false;
  // BFS by depth so a time-budget cutoff always yields the SHALLOWEST
  // matches first (never an arbitrary depth-first partial result).
  let frontier: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];

  while (frontier.length > 0) {
    if (Date.now() > deadline) {
      truncated = true;
      break;
    }
    const next: typeof frontier = [];
    for (const { dir, depth } of frontier) {
      if (Date.now() > deadline) {
        truncated = true;
        break;
      }
      const stateFile = path.join(dir, '.planning', 'STATE.md');
      try {
        // Size cap before the read (P5 review #3) — the scan walks arbitrary
        // repos; a giant file masquerading as STATE.md must not buffer.
        if (fs.statSync(stateFile).size > WIRING_STATE_MAX_BYTES) continue;
        const raw = fs.readFileSync(stateFile, 'utf-8');
        const parsed = parseTrackerState(raw);
        if (parsed) {
          projects.push({
            scanRoot: root,
            relativePath: path.relative(root, dir) || '.',
            milestone: parsed.milestone,
            gateCount: parsed.gates.length,
          });
        }
      } catch {
        // No .planning/STATE.md here -- not an error, just not a project.
      }

      if (depth >= MAX_SCAN_DEPTH) continue;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue; // unreadable dir -- skip, never throw
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        next.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
      }
    }
    frontier = next;
  }

  return { projects, truncated };
}
