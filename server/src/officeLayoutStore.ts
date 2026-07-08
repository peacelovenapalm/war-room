/**
 * Server-side office layout mutations (G2, GAME-DESIGN §5.2/§5.7) — bay
 * expansion, room tagging, buffed-furniture purchase, and sell. Every
 * Cash-costing build action is check-debit(-or-refund)-persist-broadcast,
 * server-authoritative: the client never mutates Cash (§5.7).
 *
 * Reads/writes the layout via layoutPersistence.ts's existing raw
 * JSON read/write (same file every webview-ui client polls/watches),
 * typed through officeLayoutTypes.ts's minimal mirror.
 */

import { randomUUID } from 'crypto';

import {
  BAY_COLS,
  BAY_MAX_COUNT,
  bayCost,
  FURNITURE_COST,
  ROOM_COST,
  SELL_REFUND_PCT,
} from './economyConstants.js';
import { economyStore } from './economyStore.js';
import { readLayoutFromFile, writeLayoutToFile } from './layoutPersistence.js';
import type { OfficeLayout, PlacedFurniture, PlacedRoom, RoomType } from './officeLayoutTypes.js';
import { isOfficeLayout, TileType } from './officeLayoutTypes.js';

export type BuildResult = { ok: true; layout: OfficeLayout } | { ok: false; reason: string };

/** Read the persisted office layout (typed, tolerant — null if missing/
 *  malformed). Exported for hookEventHandler.ts's Dev Pit XP-bonus lookup
 *  (GAME-DESIGN §5.5) alongside the building routes' own use. */
export function getOfficeLayout(): OfficeLayout | null {
  const raw = readLayoutFromFile();
  return isOfficeLayout(raw) ? raw : null;
}

function persistLayout(layout: OfficeLayout): void {
  writeLayoutToFile(layout as unknown as Record<string, unknown>);
}

/** True for any placeable floor tile (not WALL, not VOID). */
function isFloorTile(tile: number): boolean {
  return tile !== TileType.WALL && tile !== TileType.VOID;
}

// ── Bay expansion (§5.2) ────────────────────────────────────────────────

export function expandOffice(now: number = Date.now()): BuildResult {
  const layout = getOfficeLayout();
  if (!layout) return { ok: false, reason: 'no-layout' };

  const bayCount = economyStore.getBayCount();
  if (bayCount >= BAY_MAX_COUNT) return { ok: false, reason: 'max-bays' };

  const cost = bayCost(bayCount);
  const spend = economyStore.spendOnBay(cost, now);
  if (!spend.ok) return { ok: false, reason: 'insufficient-cash' };

  const { cols, rows, tiles, tileColors } = layout;
  const newCols = cols + BAY_COLS;
  const existingColors = tileColors ?? new Array(tiles.length).fill(null);
  const newTiles: number[] = new Array(newCols * rows);
  const newColors: Array<unknown | null> = new Array(newCols * rows);

  // Doorway opens at the shared wall midpoint — the old right-edge WALL
  // column becomes an interior wall between old and new floor, punched
  // through at one row so the new bay is always reachable at purchase time.
  const doorwayRow = Math.min(Math.max(1, Math.floor(rows / 2)), rows - 2);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const oldIdx = r * cols + c;
      const newIdx = r * newCols + c;
      const isOldRightWall = c === cols - 1;
      if (isOldRightWall && r === doorwayRow && tiles[oldIdx] === TileType.WALL) {
        newTiles[newIdx] = TileType.FLOOR_1;
        newColors[newIdx] = { h: 35, s: 30, b: 15, c: 0 };
      } else {
        newTiles[newIdx] = tiles[oldIdx];
        newColors[newIdx] = existingColors[oldIdx];
      }
    }
    for (let c = cols; c < newCols; c++) {
      const newIdx = r * newCols + c;
      const isBorderRow = r === 0 || r === rows - 1;
      const isNewRightEdge = c === newCols - 1;
      if (isBorderRow || isNewRightEdge) {
        newTiles[newIdx] = TileType.WALL;
        newColors[newIdx] = null;
      } else {
        newTiles[newIdx] = TileType.FLOOR_1;
        newColors[newIdx] = { h: 35, s: 30, b: 15, c: 0 };
      }
    }
  }

  const newLayout: OfficeLayout = {
    ...layout,
    cols: newCols,
    tiles: newTiles as OfficeLayout['tiles'],
    tileColors: newColors as OfficeLayout['tileColors'],
  };
  persistLayout(newLayout);
  return { ok: true, layout: newLayout };
}

// ── Room tagging (§5.3) ─────────────────────────────────────────────────

export interface RoomRect {
  colStart: number;
  rowStart: number;
  colEnd: number;
  rowEnd: number;
}

/** Minimum GAME-DESIGN §5.3 footprint per room type — rectangle must meet
 *  or exceed this on both axes. */
const ROOM_MIN_FOOTPRINT: Record<RoomType, { w: number; h: number }> = {
  dev_pit: { w: 4, h: 3 },
  server_room: { w: 3, h: 3 },
  break_room: { w: 3, h: 3 },
  war_room: { w: 4, h: 4 },
  kitchen: { w: 3, h: 2 },
};

export function addRoom(rect: RoomRect, type: RoomType, now: number = Date.now()): BuildResult {
  const layout = getOfficeLayout();
  if (!layout) return { ok: false, reason: 'no-layout' };

  const cost = ROOM_COST[type];
  if (cost === undefined) return { ok: false, reason: 'invalid-room-type' };

  const { colStart, rowStart, colEnd, rowEnd } = rect;
  const min = ROOM_MIN_FOOTPRINT[type];
  if (colEnd - colStart < min.w || rowEnd - rowStart < min.h) {
    return { ok: false, reason: 'footprint-too-small' };
  }
  if (colStart < 0 || rowStart < 0 || colEnd > layout.cols || rowEnd > layout.rows) {
    return { ok: false, reason: 'out-of-bounds' };
  }
  // Rectangle must be all-owned, non-VOID/WALL at creation (§5.3). Rooms
  // MAY overlap other rooms (no exclusion enforcement in v1).
  for (let r = rowStart; r < rowEnd; r++) {
    for (let c = colStart; c < colEnd; c++) {
      if (!isFloorTile(layout.tiles[r * layout.cols + c])) {
        return { ok: false, reason: 'tile-not-owned-floor' };
      }
    }
  }

  if (!economyStore.spend(cost, `room-shell:${type}`, now)) {
    return { ok: false, reason: 'insufficient-cash' };
  }

  const room: PlacedRoom = {
    uid: randomUUID(),
    type,
    colStart,
    rowStart,
    colEnd,
    rowEnd,
    createdAt: now,
  };
  const newLayout: OfficeLayout = { ...layout, rooms: [...(layout.rooms ?? []), room] };
  persistLayout(newLayout);
  return { ok: true, layout: newLayout };
}

// ── Buffed furniture purchase (§3.1/§5.4) ───────────────────────────────

export function buyFurniture(
  type: string,
  col: number,
  row: number,
  now: number = Date.now(),
): BuildResult {
  const layout = getOfficeLayout();
  if (!layout) return { ok: false, reason: 'no-layout' };

  const cost = FURNITURE_COST[type];
  if (cost === undefined) return { ok: false, reason: 'not-a-buffed-item' };
  if (col < 0 || row < 0 || col >= layout.cols || row >= layout.rows) {
    return { ok: false, reason: 'out-of-bounds' };
  }
  if (!isFloorTile(layout.tiles[row * layout.cols + col])) {
    return { ok: false, reason: 'tile-not-owned-floor' };
  }
  if (layout.furniture.some((f) => f.col === col && f.row === row)) {
    return { ok: false, reason: 'tile-occupied' };
  }

  if (!economyStore.spend(cost, `furniture:${type}`, now)) {
    return { ok: false, reason: 'insufficient-cash' };
  }

  const item: PlacedFurniture = { uid: randomUUID(), type, col, row };
  const newLayout: OfficeLayout = { ...layout, furniture: [...layout.furniture, item] };
  persistLayout(newLayout);
  return { ok: true, layout: newLayout };
}

// ── Sell (§5.7) ──────────────────────────────────────────────────────────

/** 50% flat refund on furniture and rooms; no-op-with-reason on bays
 *  (bays are never sellable — permanent once bought, §5.2). */
export function sell(uid: string, now: number = Date.now()): BuildResult {
  const layout = getOfficeLayout();
  if (!layout) return { ok: false, reason: 'no-layout' };

  const room = (layout.rooms ?? []).find((r) => r.uid === uid);
  if (room) {
    const refund = Math.round((ROOM_COST[room.type] ?? 0) * (SELL_REFUND_PCT / 100));
    economyStore.spend(-refund, `sell-room:${room.type}`, now);
    const newLayout: OfficeLayout = {
      ...layout,
      rooms: (layout.rooms ?? []).filter((r) => r.uid !== uid),
    };
    persistLayout(newLayout);
    return { ok: true, layout: newLayout };
  }

  const furniture = layout.furniture.find((f) => f.uid === uid);
  if (furniture) {
    const cost = FURNITURE_COST[furniture.type];
    if (cost === undefined) return { ok: false, reason: 'not-sellable' };
    const refund = Math.round(cost * (SELL_REFUND_PCT / 100));
    economyStore.spend(-refund, `sell-furniture:${furniture.type}`, now);
    const newLayout: OfficeLayout = {
      ...layout,
      furniture: layout.furniture.filter((f) => f.uid !== uid),
    };
    persistLayout(newLayout);
    return { ok: true, layout: newLayout };
  }

  return { ok: false, reason: 'not-found' };
}
