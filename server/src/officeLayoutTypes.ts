/**
 * Minimal server-side mirror of webview-ui/src/office/types.ts's
 * OfficeLayout shape (the server cannot import webview-ui files — separate
 * TS projects/builds). Kept intentionally small: only the fields
 * buildingBuffs.ts and officeLayoutStore.ts actually read/write. The
 * webview-ui copy remains the canonical schema; this mirror tracks it for
 * the fields listed below.
 */

export const TileType = {
  WALL: 0,
  FLOOR_1: 1,
  FLOOR_2: 2,
  FLOOR_3: 3,
  FLOOR_4: 4,
  FLOOR_5: 5,
  FLOOR_6: 6,
  FLOOR_7: 7,
  FLOOR_8: 8,
  FLOOR_9: 9,
  VOID: 255,
} as const;
export type TileType = (typeof TileType)[keyof typeof TileType];

export const RoomType = {
  DEV_PIT: 'dev_pit',
  SERVER_ROOM: 'server_room',
  BREAK_ROOM: 'break_room',
  WAR_ROOM: 'war_room',
  KITCHEN: 'kitchen',
} as const;
export type RoomType = (typeof RoomType)[keyof typeof RoomType];

export interface PlacedFurniture {
  uid: string;
  type: string;
  col: number;
  row: number;
  color?: unknown;
}

export interface PlacedRoom {
  uid: string;
  type: RoomType;
  colStart: number;
  rowStart: number;
  colEnd: number;
  rowEnd: number;
  createdAt: number;
}

export interface OfficeLayout {
  version: 1;
  cols: number;
  rows: number;
  tiles: TileType[];
  furniture: PlacedFurniture[];
  tileColors?: Array<unknown | null>;
  layoutRevision?: number;
  pets?: unknown[];
  rooms?: PlacedRoom[];
}

/** Type guard for the opaque JSON layoutPersistence.ts hands back. */
export function isOfficeLayout(value: unknown): value is OfficeLayout {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.cols === 'number' &&
    typeof v.rows === 'number' &&
    Array.isArray(v.tiles) &&
    Array.isArray(v.furniture)
  );
}
