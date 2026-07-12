import { worldToCanvas } from '../engine/camera';
import { dispatchVisitorAnchors } from '../engine/world';
import type { DispatchVisitor } from '../state/dispatchVisitors';
import type { ChipFrame } from './ChipLayer';

export interface DispatchVisitorChipsProps {
  frame: ChipFrame | null;
  visitors: readonly DispatchVisitor[];
}

/**
 * T6 item 1 — DOM label over each dispatch VISITOR sprite (world→canvas via
 * the same convention as ChipLayer). GLYPH + WORD (colorblind rule):
 * "⧉ DISPATCH — machine · provider". Deliberately non-interactive: the
 * always-visible dispatch tray is the one click/dismiss surface for a
 * dispatch (net/dispatchFacts.ts, components/DispatchTray.tsx) — this
 * layer exists purely so a running job is SEEN in the office, which is the
 * complaint it fixes; it doesn't need to duplicate the tray's controls.
 */
export function DispatchVisitorChips({ frame, visitors }: DispatchVisitorChipsProps) {
  if (frame === null || visitors.length === 0) return null;
  const { camera } = frame;
  const anchors = dispatchVisitorAnchors(visitors.map((v) => v.id));
  const byId = new Map(visitors.map((v) => [v.id, v]));

  return (
    <div className="dispatch-visitor-chip-layer" data-testid="dispatch-visitor-chip-layer">
      {anchors.map((anchor) => {
        const visitor = byId.get(anchor.id);
        if (!visitor) return null;
        const point = worldToCanvas(camera, anchor.worldX, anchor.worldY);
        return (
          <div
            key={anchor.id}
            className="dispatch-visitor-chip"
            data-testid="dispatch-visitor-chip"
            style={{ left: `${String(point.x)}px`, top: `${String(point.y)}px` }}
          >
            ⧉ DISPATCH — {visitor.machine}
            {visitor.provider ? ` · ${visitor.provider}` : ''}
          </div>
        );
      })}
    </div>
  );
}
