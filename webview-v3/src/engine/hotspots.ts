/**
 * World prop hotspots — the "room is interface" half of the desktop chrome
 * model (KICKOFF-v3.1 stage-3, surfaces table: "every surface reachable
 * via its in-world prop"). Placeholder props (same procedural-diamond
 * style as engine/world.ts's STATIC_PROPS) at fixed tiles, each opening
 * one stage-3 panel. Tiles are chosen to sit clear of DESK_SLOTS and
 * world.ts's STATIC_PROPS so nothing overlaps.
 *
 * Pure data + projection math — no DOM here (components/PropHotspots.tsx
 * renders these, reusing the exact worldToCanvas transform ChipLayer.tsx
 * uses for desk chips, so hotspot buttons and desk chips share one
 * coordinate system).
 */

import type { CameraState } from './camera';
import { worldToCanvas } from './camera';
import { tileToWorld } from './iso';

export type HotspotKind = 'call' | 'automation' | 'contracts' | 'shift' | 'briefing';

export interface Hotspot {
  kind: HotspotKind;
  tileX: number;
  tileY: number;
  glyph: string;
  label: string;
}

/** One placeholder prop per stage-3 panel that has a natural physical
 *  analog (a phone rings, a filing cabinet holds contracts, a wall board
 *  tracks automation, a report board posts the shift scorecard, a
 *  clipboard carries the briefing). HELP/SETTINGS/DEBUG have no physical
 *  analog and live in the dock only (components/PanelDock.tsx). */
export const HOTSPOTS: readonly Hotspot[] = [
  { kind: 'call', tileX: 1, tileY: 8, glyph: '☎', label: 'CALL' },
  { kind: 'contracts', tileX: 0, tileY: 5, glyph: '▤', label: 'CONTRACTS' },
  { kind: 'automation', tileX: 7, tileY: 0, glyph: '⛓', label: 'AUTOMATION' },
  { kind: 'shift', tileX: 13, tileY: 5, glyph: '▦', label: 'SHIFT' },
  // Row 0, clear of DESK_SLOTS[0] (3,2) whose chip label is the one most
  // likely to be on screen with a single occupant — (1,1) visually
  // collided with it (screenshot evidence, stage-3 verify pass).
  { kind: 'briefing', tileX: 10, tileY: 0, glyph: '▥', label: 'BRIEFING' },
];

export interface PlacedHotspot extends Hotspot {
  /** Canvas CSS px anchor (bottom-center of the placeholder prop box). */
  x: number;
  y: number;
}

/** Project every hotspot into canvas CSS px for the current camera —
 *  same worldToCanvas transform ChipLayer.tsx uses, so hotspot buttons
 *  track the world exactly like desk chips do. */
export function placeHotspots(camera: CameraState): PlacedHotspot[] {
  return HOTSPOTS.map((hotspot) => {
    const { worldX, worldY } = tileToWorld(hotspot.tileX, hotspot.tileY);
    const point = worldToCanvas(camera, worldX, worldY);
    return { ...hotspot, x: point.x, y: point.y };
  });
}
