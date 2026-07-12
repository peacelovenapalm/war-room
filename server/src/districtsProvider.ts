/**
 * Districts provider (v4 Phase 5 Lane C, T7/D-35 "districts = projects";
 * v5 C1 "N-project build-out").
 *
 * Reads a per-project `.planning/STATE.md`-shaped file from disk and
 * exposes real milestone state for GET /api/districts.
 *
 * v4 scope was a PROOF SLICE — exactly two hardcoded projects (war-room,
 * TWE), one env var each. v5 C1 makes the project list DATA-DRIVEN:
 *
 *   - WAR_ROOM_DISTRICTS_DIR: a root directory. Each immediate
 *     subdirectory is a project; key = subdirectory name, label = a
 *     humanized/uppercased form of the key (a small override map keeps the
 *     existing 'WAR ROOM'/'TWE' labels for the `war-room` and
 *     `two-wheel-events` keys). Per subdirectory, the state file is
 *     `<sub>/.planning/STATE.md`, else `<sub>/STATE.md`, else that
 *     project renders the honest unknown entry — same tolerant-read
 *     discipline, size cap, and 60s TTL cache as before.
 *   - WAR_ROOM_DISTRICT_WARROOM_STATE / WAR_ROOM_DISTRICT_TWE_STATE
 *     (legacy, v4): when set, ADDITIVELY override the `war-room`/`twe`
 *     keys (dedupe by key -- or by the `twe` <-> `two-wheel-events` alias,
 *     since the real nexus clone directory is named `two-wheel-events`,
 *     see LEGACY_KEY_ALIASES -- explicit env wins on CONTENT over a
 *     directory-scanned entry of the same real project; the merged row
 *     keeps whichever key/label was already at that slot, so a project's
 *     identity never jumps mid-flight). When WAR_ROOM_DISTRICTS_DIR is
 *     UNSET, these two are the only source of projects — exactly today's
 *     (v4) behavior, including the honest-unknown fallback per seed when
 *     its own env var isn't set.
 *
 * Same env-var + tolerant-read + 60s-TTL-cache discipline as
 * briefingProvider.ts/graphProvider.ts: a missing env var, missing file, or
 * unrecognized STATE.md shape never throws — that project's state is
 * `{ phase: null, progress: null, lastActivity: null, source: 'unknown' }`
 * and one ⚠ line is logged. The GET /api/districts route (httpServer.ts) is
 * unauthenticated, same tailnet-read tier as /api/briefing — the server
 * itself is tailnet-only.
 */

import * as fs from 'fs';
import * as path from 'path';

import { parseProjectState } from './stateParser.js';

export interface DistrictProject {
  key: string;
  label: string;
  phase: string | null;
  /** 0..1, or null when the file's format doesn't yield an honest number. */
  progress: number | null;
  lastActivity: string | null;
  /** 'file:<path>' when a STATE.md was read, 'unknown' when no file could
   *  be located/read/parsed — the UI renders this honestly rather than a
   *  plausible-looking fake zero. */
  source: string;
}

export interface DistrictsSnapshot {
  projects: DistrictProject[];
}

/** Directory-scan key -> label overrides, for keys whose humanized form
 *  wouldn't match the names Greg already knows the projects by. */
const LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  'war-room': 'WAR ROOM',
  'two-wheel-events': 'TWE',
};

function humanizeLabel(key: string): string {
  const override = LABEL_OVERRIDES[key];
  if (override) return override;
  return key.replace(/[-_]+/g, ' ').trim().toUpperCase();
}

interface LegacySeed {
  key: string;
  label: string;
  envVar: string;
}

/** The v4 proof-slice seed list — kept as the legacy/additive override
 *  path (WAR_ROOM_DISTRICTS_DIR unset -> this is the entire behavior). */
const LEGACY_SEEDS: readonly LegacySeed[] = [
  { key: 'war-room', label: 'WAR ROOM', envVar: 'WAR_ROOM_DISTRICT_WARROOM_STATE' },
  { key: 'twe', label: 'TWE', envVar: 'WAR_ROOM_DISTRICT_TWE_STATE' },
];

/** A legacy seed's key doesn't always match the directory-scan key for the
 *  SAME real project: 'twe' (v4 hardcoded) vs 'two-wheel-events' (the
 *  actual nexus clone directory name). Without this alias, an explicit
 *  WAR_ROOM_DISTRICT_TWE_STATE override would dedupe-miss the scanned
 *  'two-wheel-events' entry and the board would render the same project
 *  twice. When both are present, the merged row keeps the SCANNED entry's
 *  key/label (the directory-scan identity is what the rest of the client
 *  and future scans key off of) but the legacy file's parsed state wins
 *  (explicit env still wins on CONTENT, per the doc'd contract). */
const LEGACY_KEY_ALIASES: Readonly<Record<string, string>> = {
  twe: 'two-wheel-events',
};

const CACHE_TTL_MS = 60_000;
/** Per-file read cap (P5 review #3) — a STATE.md is a few KB of markdown. */
export const STATE_FILE_MAX_BYTES = 1024 * 1024;
let cache: { at: number; value: DistrictsSnapshot } | null = null;

/** Get the districts snapshot, serving from a 60s TTL cache when fresh. */
export function getDistricts(now: number = Date.now()): DistrictsSnapshot {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;

  const root = process.env.WAR_ROOM_DISTRICTS_DIR;
  const projects: DistrictProject[] = [];

  if (root) {
    projects.push(...scanDistrictsDir(root));
  } else {
    // No data-driven root configured: exactly the v4 proof-slice behavior
    // — both legacy seeds always render, honest-unknown when their own
    // env var isn't set.
    for (const seed of LEGACY_SEEDS) {
      projects.push(loadLegacySeed(seed));
    }
  }

  // Legacy env vars are ADDITIVE overrides, applied last: dedupe by key
  // (or by the seed's directory-scan alias, see LEGACY_KEY_ALIASES),
  // explicit env wins over anything the directory scan produced for the
  // same real project. Only applied when the specific env var is actually
  // set — when WAR_ROOM_DISTRICTS_DIR is set and a legacy var is NOT, the
  // directory-scanned entry (if any) stands untouched.
  if (root) {
    for (const seed of LEGACY_SEEDS) {
      if (!process.env[seed.envVar]) continue;
      const alias = LEGACY_KEY_ALIASES[seed.key];
      const idx = projects.findIndex((p) => p.key === seed.key || p.key === alias);
      if (idx === -1) {
        projects.push(loadLegacySeed(seed));
      } else {
        // Explicit env wins on CONTENT; the merged row keeps the identity
        // (key/label) of whatever was already at this slot — almost always
        // the directory-scanned entry, so the project's row never jumps
        // key mid-flight if the legacy override is later removed.
        const { key, label } = projects[idx];
        const overridden = loadLegacySeed(seed);
        projects[idx] = { ...overridden, key, label };
      }
    }
  }

  const value: DistrictsSnapshot = { projects };
  cache = { at: now, value };
  return value;
}

/** Test-only: force the next getDistricts() call to recompute. */
export function clearDistrictsCache(): void {
  cache = null;
}

/** Scan WAR_ROOM_DISTRICTS_DIR's immediate subdirectories into one project
 *  each. A missing/unreadable root itself degrades to an empty list (never
 *  a throw) — the legacy additive overrides can still populate projects. */
function scanDistrictsDir(root: string): DistrictProject[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    console.log(
      `[Districts] ⚠ failed to read WAR_ROOM_DISTRICTS_DIR (${root}): ${(err as Error).message}`,
    );
    return [];
  }

  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
    .map((subdir) => loadDirectoryProject(root, subdir));
}

function loadDirectoryProject(root: string, subdir: string): DistrictProject {
  const key = subdir;
  const label = humanizeLabel(key);
  const candidates = [
    path.join(root, subdir, '.planning', 'STATE.md'),
    path.join(root, subdir, 'STATE.md'),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return readStateFile(key, label, file);
  }
  console.log(`[Districts] ⚠ no STATE.md found for ${key} under ${root} -- unknown-state`);
  return unknownProject(key, label);
}

function loadLegacySeed(seed: LegacySeed): DistrictProject {
  const file = process.env[seed.envVar];
  if (!file) {
    console.log(`[Districts] ⚠ ${seed.envVar} not set -- ${seed.key} district is unknown-state`);
    return unknownProject(seed.key, seed.label);
  }
  return readStateFile(seed.key, seed.label, file);
}

function unknownProject(key: string, label: string): DistrictProject {
  return { key, label, phase: null, progress: null, lastActivity: null, source: 'unknown' };
}

/** Shared tolerant read: size cap before read, tolerant parse, never
 *  throws — a missing file, oversized file, or unrecognized shape all
 *  degrade to the honest unknown entry. */
function readStateFile(key: string, label: string, file: string): DistrictProject {
  try {
    // Size cap before the read (P5 review #3): a STATE.md is a few KB — a
    // misconfigured path pointing at something huge must not buffer it.
    if (fs.statSync(file).size > STATE_FILE_MAX_BYTES) {
      console.log(
        `[Districts] ⚠ ${file} exceeds ${String(STATE_FILE_MAX_BYTES)} bytes -- refusing to read`,
      );
      return unknownProject(key, label);
    }
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = parseProjectState(raw);
    return { key, label, ...parsed, source: `file:${file}` };
  } catch (err) {
    console.log(`[Districts] ⚠ failed to read ${file}: ${(err as Error).message}`);
    return unknownProject(key, label);
  }
}
