/**
 * Default one-floor office world (KICKOFF-v3.1 "one floor, wings").
 * Placeholder-only in Stage 1: desk slots in two wings plus a few static
 * props. Agents occupy desk slots in ascending-id order; a desk with an
 * occupant renders the occupant block + name/status label (shape + text).
 */

import { type TilePoint, tileToWorld } from './iso';

export const DEFAULT_COLS = 14;
export const DEFAULT_ROWS = 10;
export const DEFAULT_MAX_ELEVATION = 0;

export type PropKind = 'desk' | 'plant' | 'coffee' | 'door';

export interface Occupant {
  /** Real server agent id — chip click opens this agent's drawer. */
  agentId: number;
  name: string;
  /** e.g. '▶' — shape half of the status signal. */
  statusGlyph: string;
  /** e.g. 'WORKING' — text half of the status signal. */
  statusWord: string;
  /** Loud states (NEEDS INPUT / FAILED) render inverted chips. */
  loud: boolean;
}

export interface WorldProp {
  kind: PropKind;
  tileX: number;
  tileY: number;
  elevation?: number;
  occupant?: Occupant;
}

/** Two wings of 6 desks each, ascending desk index left wing first. */
export const DESK_SLOTS: readonly TilePoint[] = [
  { tileX: 3, tileY: 2 },
  { tileX: 3, tileY: 4 },
  { tileX: 3, tileY: 6 },
  { tileX: 5, tileY: 2 },
  { tileX: 5, tileY: 4 },
  { tileX: 5, tileY: 6 },
  { tileX: 9, tileY: 2 },
  { tileX: 9, tileY: 4 },
  { tileX: 9, tileY: 6 },
  { tileX: 11, tileY: 2 },
  { tileX: 11, tileY: 4 },
  { tileX: 11, tileY: 6 },
];

export const STATIC_PROPS: readonly WorldProp[] = [
  { kind: 'door', tileX: 7, tileY: 9 },
  { kind: 'coffee', tileX: 13, tileY: 8 },
  { kind: 'plant', tileX: 0, tileY: 0 },
  { kind: 'plant', tileX: 13, tileY: 0 },
];

/**
 * Build the prop list for the current occupants. `occupants[i]` sits at
 * DESK_SLOTS[i]; extra occupants beyond the slot count are dropped (a
 * bigger floor is a later vertical slice).
 */
export function buildProps(occupants: readonly Occupant[]): WorldProp[] {
  const desks: WorldProp[] = DESK_SLOTS.map((slot, index) => ({
    kind: 'desk',
    tileX: slot.tileX,
    tileY: slot.tileY,
    occupant: occupants[index],
  }));
  return [...desks, ...STATIC_PROPS];
}

/** World-px lift from a desk's tile center to its chip anchor (above the
 *  desk box + occupant block; the DOM chip layer hangs labels here). */
export const CHIP_ANCHOR_LIFT = 44;

export interface DeskAnchor {
  agentId: number;
  occupant: Occupant;
  /** Chip anchor in WORLD px (tile center lifted by CHIP_ANCHOR_LIFT). */
  worldX: number;
  worldY: number;
  /** Desk tile center in WORLD px (camera walk target). */
  deskWorldX: number;
  deskWorldY: number;
}

/**
 * Occupied desks with their chip/camera anchors — the single source for
 * both the DOM chip layer and the ▸ DESK camera walk, so labels and walks
 * always agree on where an agent sits.
 */
export function occupiedDeskAnchors(occupants: readonly Occupant[]): DeskAnchor[] {
  const anchors: DeskAnchor[] = [];
  occupants.forEach((occupant, index) => {
    const slot = DESK_SLOTS[index];
    if (!slot) return;
    const { worldX, worldY } = tileToWorld(slot.tileX, slot.tileY);
    anchors.push({
      agentId: occupant.agentId,
      occupant,
      worldX,
      worldY: worldY - CHIP_ANCHOR_LIFT,
      deskWorldX: worldX,
      deskWorldY: worldY,
    });
  });
  return anchors;
}
