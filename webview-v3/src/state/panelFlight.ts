/**
 * T6 item 4 — CAMERA-MOVE PANEL OPENS: which panel kinds have a real
 * in-world prop anchor (engine/hotspots.ts) worth flying the camera to
 * when the panel opens. Panels with no physical analog in the office
 * (HELP/SETTINGS/DEBUG/OPS REVIEW/GRAPH SEARCH/DISTRICTS/INBOX — see
 * PanelDock.tsx's own "no in-world physical prop" comment) get NO
 * invented anchor: they open exactly as before, no camera move, no grow
 * animation. Pure lookup so the mapping is unit-testable without a
 * rendering harness.
 */

import { type Hotspot, HOTSPOTS } from '../engine/hotspots';
import type { DockPanelKind } from './dockPanelKind';

/** The hotspot backing `kind`'s camera-fly entrance, or undefined when
 *  that panel has no physical prop to fly to (an honest skip, not a
 *  fallback anchor). */
export function panelFlightAnchor(kind: DockPanelKind): Hotspot | undefined {
  return HOTSPOTS.find((hotspot) => (hotspot.kind as DockPanelKind) === kind);
}

/** Documented here (not just inferred from absence in HOTSPOTS) so adding
 *  a new DockPanelKind forces an explicit decision about its anchor. */
export const PANELS_WITHOUT_ANCHOR: readonly DockPanelKind[] = [
  'help',
  'settings',
  'debug',
  'ops',
  'graph-search',
  'districts',
  'inbox',
  'morning',
];
