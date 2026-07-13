/**
 * Default one-floor office world (KICKOFF-v3.1 "one floor, wings"). Desk
 * slots in two wings plus a few static props, a back wall, and the real
 * WS-B sprite names each prop/occupant maps to — the renderer draws the
 * named sprite via the asset loader and falls back to the stage-1
 * placeholder box for anything not (yet) loaded, per-sprite (skeleton-
 * first: a slow sheet never blanks the whole world).
 */

import type { Rotation } from '../assets/manifest';
import { type TilePoint, tileToWorld } from './iso';

export const DEFAULT_COLS = 14;
export const DEFAULT_ROWS = 10;
export const DEFAULT_MAX_ELEVATION = 0;

export type PropKind = 'desk' | 'plant' | 'coffee' | 'door' | 'walker' | 'wall';

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

/** Ambient-walker pose kinds (engine/walkers.ts's WalkerPose['kind'],
 *  duplicated as a literal union rather than imported — world.ts is
 *  imported BY walkers.ts for staticPropTile(), so importing back would be
 *  circular). Only used to pick a rendering sprite; keep in sync by hand.
 *  'visitor' (T6) is NOT produced by walkers.ts — App.tsx builds it
 *  directly from state/dispatchVisitors.ts, reusing this same WorldProp
 *  shape so the renderer needs no special-casing beyond picking a
 *  stationary 'sit' pose instead of a walk cycle (renderer.ts). */
export type WalkerPoseKind = 'janitor' | 'drift' | 'pace' | 'cat-curl' | 'cat-walk' | 'visitor';

export interface WorldProp {
  kind: PropKind;
  tileX: number;
  tileY: number;
  elevation?: number;
  occupant?: Occupant;
  /** Sprite rotation variant (N/E/S/W) — which authored facing to draw.
   *  Static props/walls carry one fixed rotation; walkers carry their
   *  current direction of travel (engine/walkers.ts). */
  rotation?: Rotation;
  /** kind==='walker' only — which ambient behavior this is, so the
   *  renderer picks the matching character/cat sprite + animation. */
  walkerPoseKind?: WalkerPoseKind;
  /** kind==='walker', human (non-cat) only — which staff outfit to draw,
   *  so a drifting/pacing agent wears the same clothes as their desk
   *  sprite (continuity, not required — falls back to a fixed outfit for
   *  the janitor, who has no agentId). */
  walkerOutfit?: WorkerOutfit;
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

/** T6 dispatch-visitor slots (D-9 "dispatched jobs visible in the office" —
 *  Greg's repeated complaint): a short row near the front door, deliberately
 *  off the DESK_SLOTS/STATIC_PROPS/janitor-route tiles so a visitor never
 *  overlaps a real occupant or ambient walker. Count matches
 *  state/dispatchVisitors.ts's MAX_DISPATCH_VISITORS — kept as two
 *  independently-owned constants (world layout vs. dispatch-store policy)
 *  rather than one importing the other. */
export const GUEST_SLOTS: readonly TilePoint[] = [
  { tileX: 4, tileY: 8 },
  { tileX: 6, tileY: 8 },
  { tileX: 8, tileY: 8 },
  { tileX: 10, tileY: 8 },
];

/** Tile column both wings face toward (the center aisle) — desks left of it
 *  face east, desks right of it face west, so the two wings face each
 *  other across the room instead of all facing one direction. */
const AISLE_TILE_X = 7;

/** Which authored rotation a desk at `tileX` should render with — front
 *  face points toward the aisle (iso.ts/rig.py convention: E front faces
 *  +tileX, W front faces -tileX). Shared by the desk_monitor, office_chair,
 *  and the seated occupant sprite, so all three agree on which way "the
 *  desk" faces. */
export function deskRotation(tileX: number): Rotation {
  return tileX < AISLE_TILE_X ? 'E' : 'W';
}

export const STATIC_PROPS: readonly WorldProp[] = [
  { kind: 'door', tileX: 7, tileY: 9, rotation: 'S' },
  { kind: 'coffee', tileX: 13, tileY: 8, rotation: 'S' },
  { kind: 'plant', tileX: 0, tileY: 1, rotation: 'S' },
  { kind: 'plant', tileX: 13, tileY: 1, rotation: 'S' },
];

/** Back wall along the north edge (tileY 0), corner at the west end, two
 *  window segments (one per wing) for visual variety — mirrors the
 *  composite-room reference in tools/asset-pipeline/viewer.html, which
 *  explicitly disclaims being authoritative floor-plan logic ("that's
 *  WS-A's"); this IS that floor-plan logic. Plants sit one row south (see
 *  STATIC_PROPS) so nothing shares a tile with a wall segment. */
export const WALL_SEGMENTS: readonly WorldProp[] = Array.from(
  { length: DEFAULT_COLS },
  (_, tileX): WorldProp => ({
    kind: 'wall',
    tileX,
    tileY: 0,
    rotation: 'N',
  }),
);

/** Sprite name for a WALL_SEGMENTS entry (corner at the west end, a window
 *  in each wing, straight runs otherwise). Kept alongside WALL_SEGMENTS
 *  (not baked into the WorldProp itself) so the sprite catalog lives with
 *  the other *_SPRITE names below, one place to look. */
export function wallSpriteName(tileX: number): string {
  if (tileX === 0) return WALL_CORNER_SPRITE;
  if (tileX === 4 || tileX === 10) return WALL_WINDOW_SPRITE;
  return WALL_STRAIGHT_SPRITE;
}

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
    rotation: deskRotation(slot.tileX),
  }));
  return [...desks, ...STATIC_PROPS, ...WALL_SEGMENTS];
}

/** The tile a static prop of `kind` sits on — engine/walkers.ts anchors its
 *  patrol/drift routes to the coffee station and door THIS way, so a floor
 *  layout change never leaves ambient walkers pointed at stale coordinates.
 *  Falls back to the origin if the layout ever drops that prop kind. */
export function staticPropTile(kind: PropKind): TilePoint {
  const prop = STATIC_PROPS.find((candidate) => candidate.kind === kind);
  return prop ? { tileX: prop.tileX, tileY: prop.tileY } : { tileX: 0, tileY: 0 };
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
  /** Desk tile center in TILE space (engine/walkers.ts drift/pace routes —
   *  ambient motion interpolates in tile space, the same space DESK_SLOTS
   *  and STATIC_PROPS are already authored in). */
  deskTileX: number;
  deskTileY: number;
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
      deskTileX: slot.tileX,
      deskTileY: slot.tileY,
    });
  });
  return anchors;
}

export interface DispatchVisitorAnchor {
  id: string;
  /** Chip anchor in WORLD px (guest-tile center lifted by CHIP_ANCHOR_LIFT). */
  worldX: number;
  worldY: number;
  tileX: number;
  tileY: number;
}

/** GUEST_SLOTS assigned in the given order (state/dispatchVisitors.ts
 *  already caps + orders `ids` — oldest dispatch first). Extra ids beyond
 *  GUEST_SLOTS.length are dropped, same "bigger floor is a later slice"
 *  convention as occupiedDeskAnchors. */
export function dispatchVisitorAnchors(ids: readonly string[]): DispatchVisitorAnchor[] {
  const anchors: DispatchVisitorAnchor[] = [];
  ids.forEach((id, index) => {
    const slot = GUEST_SLOTS[index];
    if (!slot) return;
    const { worldX, worldY } = tileToWorld(slot.tileX, slot.tileY);
    anchors.push({
      id,
      worldX,
      worldY: worldY - CHIP_ANCHOR_LIFT,
      tileX: slot.tileX,
      tileY: slot.tileY,
    });
  });
  return anchors;
}

// ── Real sprite catalog (WS-B pipeline names) ──────────────────────────
//
// Centralized here (the domain/layout owner) rather than scattered through
// renderer.ts/App.tsx as string literals — one place to look up what an
// office prop is actually called on the sheet.

export const PROP_SPRITE_NAMES: Partial<Record<PropKind, string>> = {
  plant: 'plant',
  coffee: 'coffee_station',
};
/** No `door` sprite exists in the pipeline (props.manifest.json has no
 *  literal door prop) — `door` intentionally has no entry above, so
 *  assets.get('door') always resolves to the stage-1 placeholder box
 *  (graceful degradation, not a bug: the loader's documented contract for
 *  an unknown name). */

export const DESK_MONITOR_SPRITE = 'desk_monitor';
export const DESK_CHAIR_SPRITE = 'office_chair';

export const WALL_STRAIGHT_SPRITE = 'wall_straight';
export const WALL_CORNER_SPRITE = 'wall_corner';
export const WALL_WINDOW_SPRITE = 'wall_window';

export const FLOOR_SPRITE_NAMES = ['floor_tile', 'floor_tile_b', 'floor_tile_c'] as const;

/** Which of the 3 floor variants a tile uses — matches the composite-room
 *  reference's `(col+row) % 3` rotation for visual variety. */
export function floorSpriteName(tileX: number, tileY: number): string {
  return FLOOR_SPRITE_NAMES[(tileX + tileY) % FLOOR_SPRITE_NAMES.length];
}

export const CAT_CURL_SPRITE = 'cat.curl';
export const CAT_WALK_SPRITE = 'cat.walk';

// C2 diversity pass (v5 KICKOFF §C2): 12 new identities appended to the
// original 4 — appended, not interleaved, so outfitForAgent/outfitForDispatchId
// stay backward-stable for existing agent ids below the old length (the
// modulo only shifts for ids that land past index 3).
export const WORKER_OUTFITS = [
  'teal',
  'rust',
  'slate',
  'moss',
  'amber',
  'coral',
  'indigo',
  'sage',
  'plum',
  'ochre',
  'charcoal',
  'rose',
  'navy',
  'clay',
  'mint',
  'violet',
] as const;
export type WorkerOutfit = (typeof WORKER_OUTFITS)[number];

/** Deterministic outfit per agent id (stable across renders — not
 *  Math.random) so an agent doesn't change clothes every frame. */
export function outfitForAgent(agentId: number): WorkerOutfit {
  return WORKER_OUTFITS[Math.abs(agentId) % WORKER_OUTFITS.length];
}

/** Deterministic outfit per dispatch id (string, unlike a numeric agentId) —
 *  same "stable, not Math.random" rule as outfitForAgent, via a plain
 *  string hash so a dispatch VISITOR doesn't change clothes every render. */
export function outfitForDispatchId(id: string): WorkerOutfit {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return WORKER_OUTFITS[hash % WORKER_OUTFITS.length];
}

export type OccupantPose = 'sit' | 'type' | 'blocked';

/** Seated-typing while actively WORKING (2fps type anim = "session
 *  streams output"); standing 'blocked' for loud states (needs-input/
 *  failed — the same visual register the ambient pace-walker already uses
 *  for needs-input, KICKOFF-v3.1 colorblind shape-difference rule); a
 *  quiet 'sit' otherwise (done/waiting/stopped — present, not working). */
export function occupantPoseFor(occupant: Occupant): OccupantPose {
  if (occupant.loud) return 'blocked';
  return occupant.statusWord === 'WORKING' ? 'type' : 'sit';
}

/** Sprite name for a worker in `outfit` doing `pose` — 'walk' is the
 *  ambient-walker animation (engine/walkers.ts drift/pace/janitor all use
 *  a walk cycle), the OccupantPose variants are the seated-desk states. */
export function workerSpriteName(outfit: WorkerOutfit, pose: OccupantPose | 'walk'): string {
  return `worker_${outfit}.${pose}`;
}

/** Every prop-catalog sprite name needed unconditionally from frame 1 (the
 *  office geometry exists before any agent connects) — App.tsx requests
 *  these once on mount. Character sprites are requested per-outfit/pose as
 *  occupants/walkers actually appear (state, not fixed geometry). */
export const STATIC_PROP_SPRITE_NAMES: readonly string[] = [
  ...FLOOR_SPRITE_NAMES,
  WALL_STRAIGHT_SPRITE,
  WALL_CORNER_SPRITE,
  WALL_WINDOW_SPRITE,
  DESK_MONITOR_SPRITE,
  DESK_CHAIR_SPRITE,
  ...Object.values(PROP_SPRITE_NAMES),
];
