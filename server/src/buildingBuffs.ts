/**
 * Building buff resolution (G2, GAME-DESIGN §5.4/§5.5) — the AUTHORITATIVE
 * computation. Two paths merged at award time:
 *   - buffsForDesk(layout, deskUid): room-membership (Dev Pit/Break
 *     Room/War Room) + furniture adjacency, xp/cash bonuses capped at
 *     ADJACENCY_AND_ROOM_BONUS_CAP_PCT=40 combined (one shared pool per
 *     dimension, not two independent 40% caps).
 *   - globalBuffs(layout): Server Room (+10% Cash company-wide, requires
 *     qualifying furniture inside) and Kitchen (mood-decay x0.85),
 *     evaluated once per award event regardless of desk.
 *
 * Both are point-in-time reads at the moment an event resolves — no
 * continuously-recomputed cache, no client-side buff computation, ever.
 *
 * This file keeps its own small mirror of webview-ui's
 * furnitureBuffs.ts table (server can't import webview-ui files) — update
 * both together.
 */

import {
  ADJACENCY_AND_ROOM_BONUS_CAP_PCT,
  BREAK_ROOM_MOOD_REGEN_MULT,
  DEV_PIT_XP_BONUS_PCT,
  KITCHEN_MOOD_DECAY_MULT,
  SERVER_ROOM_CASH_BONUS_PCT,
  WAR_ROOM_CRISIS_XP_BONUS_PCT,
} from './economyConstants.js';
import type { OfficeLayout, PlacedRoom } from './officeLayoutTypes.js';
import { RoomType } from './officeLayoutTypes.js';

/** Server-side mirror of webview-ui/src/office/layout/furnitureBuffs.ts's
 *  FURNITURE_BUFFS table — keep both in sync. */
interface FurnitureBuffEntry {
  cashBonusPct?: number;
  xpBonusPct?: number;
  adjacencyRadius?: number;
}
const FURNITURE_BUFFS: Record<string, FurnitureBuffEntry> = {
  PC_FRONT_ON_1: { xpBonusPct: 10, adjacencyRadius: 2 },
  PC_FRONT_ON_2: { xpBonusPct: 10, adjacencyRadius: 2 },
  PC_FRONT_ON_3: { xpBonusPct: 10, adjacencyRadius: 2 },
  WHITEBOARD: { xpBonusPct: 15, adjacencyRadius: 2 },
};

/** Server Room's "requires furniture inside" qualifying types (SERVER_RACK
 *  doesn't exist as an asset yet — see furnitureBuffs.ts's note; PC stands
 *  in until G5 Art adds a real sprite). */
const SERVER_ROOM_QUALIFYING_PREFIXES = ['PC_'];
function isServerRoomQualifyingType(type: string): boolean {
  return SERVER_ROOM_QUALIFYING_PREFIXES.some((p) => type.startsWith(p));
}

export interface DeskBuffs {
  /** Continuous XP bonus (Dev Pit room-membership + furniture adjacency),
   *  capped at ADJACENCY_AND_ROOM_BONUS_CAP_PCT combined. */
  xpBonusPct: number;
  /** Cash bonus from furniture adjacency only (no per-desk cash room in
   *  v1) — same shared cap dimension. */
  cashBonusPct: number;
  /** Event-scoped: +25% XP on crisis resolution when the resolver's seat
   *  is inside a War Room. Single source, not subject to the 40% pool
   *  (nothing else contributes to this dimension to stack against). */
  crisisXpBonusPct: number;
  /** Break Room: mood regen x1.5 while on break and inside; 1 otherwise. */
  moodRegenMult: number;
}

export interface GlobalBuffs {
  /** Server Room: +10% Cash company-wide while >=1 qualifying furniture
   *  piece is placed inside. */
  cashBonusPct: number;
  /** Kitchen: passive company-wide mood-decay-rate x0.85 while the room
   *  exists anywhere in the layout. */
  moodDecayMult: number;
}

function tileInRoom(room: PlacedRoom, col: number, row: number): boolean {
  return col >= room.colStart && col < room.colEnd && row >= room.rowStart && row < room.rowEnd;
}

function roomsContaining(layout: OfficeLayout, col: number, row: number): PlacedRoom[] {
  const rooms = layout.rooms ?? [];
  return rooms.filter((r) => tileInRoom(r, col, row));
}

function chebyshevDistance(
  a: { col: number; row: number },
  b: { col: number; row: number },
): number {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
}

/** Room-membership + furniture-adjacency buffs at a specific desk.
 *  `deskUid` must reference a `PlacedFurniture` entry — an unknown uid
 *  returns all-zero/neutral buffs (never throws; buffs are additive, a
 *  missing desk simply contributes nothing). */
export function buffsForDesk(layout: OfficeLayout, deskUid: string): DeskBuffs {
  const desk = layout.furniture.find((f) => f.uid === deskUid);
  if (!desk) {
    return { xpBonusPct: 0, cashBonusPct: 0, crisisXpBonusPct: 0, moodRegenMult: 1 };
  }

  const rooms = roomsContaining(layout, desk.col, desk.row);
  const inDevPit = rooms.some((r) => r.type === RoomType.DEV_PIT);
  const inBreakRoom = rooms.some((r) => r.type === RoomType.BREAK_ROOM);
  const inWarRoom = rooms.some((r) => r.type === RoomType.WAR_ROOM);

  // Furniture adjacency: same-type items don't stack (strongest instance
  // only — since all instances of a type carry the same buff value, this
  // is "count each qualifying TYPE once"); different types stack
  // additively. Chebyshev distance, each item's own adjacencyRadius.
  const contributingTypes = new Set<string>();
  let adjacencyXpPct = 0;
  let adjacencyCashPct = 0;
  for (const item of layout.furniture) {
    if (item.uid === deskUid) continue;
    const buff = FURNITURE_BUFFS[item.type];
    if (!buff || contributingTypes.has(item.type)) continue;
    const radius = buff.adjacencyRadius ?? 0;
    if (radius <= 0) continue;
    if (chebyshevDistance(desk, item) > radius) continue;
    contributingTypes.add(item.type);
    adjacencyXpPct += buff.xpBonusPct ?? 0;
    adjacencyCashPct += buff.cashBonusPct ?? 0;
  }

  const roomXpPct = inDevPit ? DEV_PIT_XP_BONUS_PCT : 0;
  const xpBonusPct = Math.min(ADJACENCY_AND_ROOM_BONUS_CAP_PCT, roomXpPct + adjacencyXpPct);
  const cashBonusPct = Math.min(ADJACENCY_AND_ROOM_BONUS_CAP_PCT, adjacencyCashPct);

  return {
    xpBonusPct,
    cashBonusPct,
    crisisXpBonusPct: inWarRoom ? WAR_ROOM_CRISIS_XP_BONUS_PCT : 0,
    moodRegenMult: inBreakRoom ? BREAK_ROOM_MOOD_REGEN_MULT : 1,
  };
}

/** Global (non-desk-scoped) room buffs — Server Room + Kitchen. Evaluated
 *  once per award event regardless of which desk triggered it. */
export function globalBuffs(layout: OfficeLayout): GlobalBuffs {
  const rooms = layout.rooms ?? [];
  const serverRooms = rooms.filter((r) => r.type === RoomType.SERVER_ROOM);
  const hasKitchen = rooms.some((r) => r.type === RoomType.KITCHEN);

  const hasQualifyingFurnitureInServerRoom = serverRooms.some((room) =>
    layout.furniture.some(
      (f) => tileInRoom(room, f.col, f.row) && isServerRoomQualifyingType(f.type),
    ),
  );

  return {
    cashBonusPct: hasQualifyingFurnitureInServerRoom ? SERVER_ROOM_CASH_BONUS_PCT : 0,
    moodDecayMult: hasKitchen ? KITCHEN_MOOD_DECAY_MULT : 1,
  };
}

/** Convenience: both paths merged, for callers that want a single call. */
export function computeActiveBuffs(
  layout: OfficeLayout,
  deskUid: string,
): { desk: DeskBuffs; global: GlobalBuffs } {
  return { desk: buffsForDesk(layout, deskUid), global: globalBuffs(layout) };
}
