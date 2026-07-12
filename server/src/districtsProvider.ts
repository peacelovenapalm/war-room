/**
 * Districts provider (v4 Phase 5 Lane C, T7/D-35 "districts = projects").
 *
 * Reads a per-project `.planning/STATE.md`-shaped file from disk and
 * exposes real milestone state for GET /api/districts. v4 scope is a
 * PROOF SLICE — exactly two hardcoded projects (war-room, TWE); a
 * data-driven project list is v5 scope (KICKOFF-v4 T7).
 *
 * Same env-var + tolerant-read + 60s-TTL-cache discipline as
 * briefingProvider.ts/graphProvider.ts: a missing env var, missing file, or
 * unrecognized STATE.md shape never throws — that project's state is
 * `{ phase: null, progress: null, lastActivity: null, source: 'unknown' }`
 * and one ⚠ line is logged. The GET /api/districts route (httpServer.ts) is
 * unauthenticated, same tailnet-read tier as /api/briefing — the server
 * itself is tailnet-only.
 *
 *   - WAR_ROOM_DISTRICT_WARROOM_STATE: path to war-room's own STATE.md
 *     (e.g. .planning/v4/STATE-v4.md — NOT baked into the runtime image,
 *     see Dockerfile; must be bind-mounted like the briefing tracker file).
 *   - WAR_ROOM_DISTRICT_TWE_STATE: path to the Two Wheel Events repo's
 *     .planning/STATE.md.
 */

import * as fs from 'fs';

import { parseProjectState } from './stateParser.js';

export interface DistrictProject {
  key: string;
  label: string;
  phase: string | null;
  /** 0..1, or null when the file's format doesn't yield an honest number. */
  progress: number | null;
  lastActivity: string | null;
  /** 'file:<path>' when a STATE.md was read, 'unknown' when the env var is
   *  unset or the file couldn't be read/parsed — the UI renders this
   *  honestly rather than a plausible-looking fake zero. */
  source: string;
}

export interface DistrictsSnapshot {
  projects: DistrictProject[];
}

interface DistrictSeed {
  key: string;
  label: string;
  envVar: string;
}

/** The v4 proof-slice seed list — exactly 2 districts (KICKOFF-v4 T7). */
const DISTRICT_SEEDS: readonly DistrictSeed[] = [
  { key: 'war-room', label: 'WAR ROOM', envVar: 'WAR_ROOM_DISTRICT_WARROOM_STATE' },
  { key: 'twe', label: 'TWE', envVar: 'WAR_ROOM_DISTRICT_TWE_STATE' },
];

const CACHE_TTL_MS = 60_000;
/** Per-file read cap (P5 review #3) — a STATE.md is a few KB of markdown. */
export const STATE_FILE_MAX_BYTES = 1024 * 1024;
let cache: { at: number; value: DistrictsSnapshot } | null = null;

/** Get the districts snapshot, serving from a 60s TTL cache when fresh. */
export function getDistricts(now: number = Date.now()): DistrictsSnapshot {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
  const value: DistrictsSnapshot = { projects: DISTRICT_SEEDS.map(loadProject) };
  cache = { at: now, value };
  return value;
}

/** Test-only: force the next getDistricts() call to recompute. */
export function clearDistrictsCache(): void {
  cache = null;
}

function loadProject(seed: DistrictSeed): DistrictProject {
  const file = process.env[seed.envVar];
  if (!file) {
    console.log(`[Districts] ⚠ ${seed.envVar} not set -- ${seed.key} district is unknown-state`);
    return {
      key: seed.key,
      label: seed.label,
      phase: null,
      progress: null,
      lastActivity: null,
      source: 'unknown',
    };
  }
  try {
    // Size cap before the read (P5 review #3): a STATE.md is a few KB — a
    // misconfigured env var pointing at something huge must not buffer it.
    if (fs.statSync(file).size > STATE_FILE_MAX_BYTES) {
      console.log(
        `[Districts] ⚠ ${seed.envVar} (${file}) exceeds ${String(STATE_FILE_MAX_BYTES)} bytes -- refusing to read`,
      );
      return {
        key: seed.key,
        label: seed.label,
        phase: null,
        progress: null,
        lastActivity: null,
        source: 'unknown',
      };
    }
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = parseProjectState(raw);
    return { key: seed.key, label: seed.label, ...parsed, source: `file:${file}` };
  } catch (err) {
    console.log(`[Districts] ⚠ failed to read ${seed.envVar} (${file}): ${(err as Error).message}`);
    return {
      key: seed.key,
      label: seed.label,
      phase: null,
      progress: null,
      lastActivity: null,
      source: 'unknown',
    };
  }
}
