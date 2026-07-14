import { type HotspotKind, placeHotspots } from '../engine/hotspots';
import type { ChipFrame } from './ChipLayer';

export interface PropHotspotsProps {
  frame: ChipFrame | null;
  onOpen: (kind: HotspotKind) => void;
  /** SETTINGS → "Always show labels" (M5 beta finding) — see ChipLayer's
   *  matching prop doc. When false, hotspot text labels reveal only on
   *  hover/focus; the glyph stays visible either way. */
  alwaysShowLabels: boolean;
}

/**
 * Desktop chrome model, "room is interface" half (KICKOFF-v3.1 stage-3):
 * a DOM button per world prop hotspot (☎ phone → CALL, ▤ cabinet →
 * CONTRACTS, ⛓ board → AUTOMATION, ▦ report wall → SHIFT, ▥ clipboard →
 * BRIEFING), positioned with the exact same camera projection ChipLayer.tsx
 * uses for desk chips. Desktop-only (CSS hides it under the phone
 * breakpoint, matching the pin dock) — phone reaches every panel through
 * PanelDock.tsx instead, since there is no free camera play on phone.
 */
export function PropHotspots({ frame, onOpen, alwaysShowLabels }: PropHotspotsProps) {
  if (frame === null) return null;
  const placed = placeHotspots(frame.camera);

  return (
    <div className="prop-hotspots">
      {placed.map((hotspot) => (
        <button
          type="button"
          key={hotspot.kind}
          className={alwaysShowLabels ? 'prop-hotspot' : 'prop-hotspot prop-hotspot--compact'}
          data-testid={`hotspot-${hotspot.kind}`}
          style={{ left: `${String(hotspot.x)}px`, top: `${String(hotspot.y)}px` }}
          title={hotspot.label}
          onClick={() => {
            onOpen(hotspot.kind);
          }}
        >
          <span className="prop-hotspot__glyph">{hotspot.glyph}</span>
          <span className="prop-hotspot__label">{hotspot.label}</span>
        </button>
      ))}
    </div>
  );
}
