/**
 * Furniture buff sidecar (G2, GAME-DESIGN §5.4) — per-item buff metadata
 * for rendering (tooltips, catalog badges). NOT a manifest rewrite; the
 * generated asset catalog (furnitureCatalog.ts's buildDynamicCatalog())
 * is untouched.
 *
 * This is the WEBVIEW's copy, for display only. The AUTHORITATIVE buff
 * computation that actually grants Cash/XP lives server-side in
 * server/src/buildingBuffs.ts (server can't import webview-ui files, so
 * that file keeps its own small mirror of this table) — buffs are always
 * computed server-side at award time, never client-side (§5.5).
 *
 * NOTE: GAME-DESIGN §5.3 names `SERVER_RACK` as the Server Room's
 * qualifying furniture, but no such sprite asset exists yet (verified —
 * only the bundled manifest's real furniture types are available; adding
 * a new sprite is G5 Art work, out of scope here per task 7's "do NOT
 * touch the generated asset manifest" rule). The PC electronics group
 * (`PC_FRONT_ON_*`/`PC_FRONT_OFF`) stands in as the qualifying item until
 * a real SERVER_RACK asset lands — update both this table and
 * buildingBuffs.ts's mirror together when it does.
 */

export interface FurnitureBuff {
  cashBonusPct?: number;
  xpBonusPct?: number;
  moodRegenDelta?: number;
  adjacencyRadius?: number;
}

/** Furniture types that satisfy the Server Room's "requires furniture
 *  inside" global-buff gate (GAME-DESIGN §5.3) — see the SERVER_RACK note
 *  above. Prefix-matched against PlacedFurniture.type. */
export const SERVER_ROOM_QUALIFYING_PREFIXES = ['PC_'] as const;

export function isServerRoomQualifyingType(type: string): boolean {
  return SERVER_ROOM_QUALIFYING_PREFIXES.some((prefix) => type.startsWith(prefix));
}

/** Per-item buff table, keyed by the manifest asset id. Chebyshev-distance
 *  adjacency: same-type items don't stack (strongest instance only);
 *  different types stack additively, capped by the shared 40% pool
 *  (economyConstants.ADJACENCY_AND_ROOM_BONUS_CAP_PCT, enforced server-side). */
export const FURNITURE_BUFFS: Record<string, FurnitureBuff> = {
  PC_FRONT_ON_1: { xpBonusPct: 10, adjacencyRadius: 2 },
  PC_FRONT_ON_2: { xpBonusPct: 10, adjacencyRadius: 2 },
  PC_FRONT_ON_3: { xpBonusPct: 10, adjacencyRadius: 2 },
  WHITEBOARD: { xpBonusPct: 15, adjacencyRadius: 2 },
  COFFEE_TABLE: { moodRegenDelta: 5, adjacencyRadius: 1 },
  COFFEE: { moodRegenDelta: 5, adjacencyRadius: 1 },
};

export function getFurnitureBuff(type: string): FurnitureBuff | undefined {
  return FURNITURE_BUFFS[type];
}
