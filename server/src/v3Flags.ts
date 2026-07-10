/**
 * Feature flags for the v3 Living Studio store planes (WS-C stage 1 —
 * KICKOFF-v3.1 §3).
 *
 * Default posture: a plane is ON only when its REAL source data exists
 * (hard rule: all game state derives from real observed events — a plane
 * with no observed source stays silent rather than broadcasting fiction).
 * The flag NEVER gates real functionality (hard rule 2: dispatch, chains,
 * STOP ALL etc. are untouched by these flags — they gate only the v3
 * game-face broadcast planes).
 *
 * Ops overrides, per store:
 *   WAR_ROOM_V3_<NAME>=off|0|false → force-disable the plane
 *   WAR_ROOM_V3_<NAME>=on|1|true   → force-enable (replay still only
 *     carries whatever real records exist — an empty store sends nothing)
 */

export type V3StoreName = 'CONTRACTS' | 'DOSSIERS' | 'MATCH_DAY' | 'REWORK_BIN' | 'RIVALRIES';

export function v3StoreEnabled(name: V3StoreName, sourceDataExists: () => boolean): boolean {
  const raw = process.env[`WAR_ROOM_V3_${name}`]?.trim().toLowerCase();
  if (raw === 'off' || raw === '0' || raw === 'false') return false;
  if (raw === 'on' || raw === '1' || raw === 'true') return true;
  return sourceDataExists();
}
