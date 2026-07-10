import { type CameraState, type Size, worldToCanvas } from '../engine/camera';
import { type ChipAnchor, declutterChips } from '../engine/chipLayout';
import type { Occupant } from '../engine/world';
import { occupiedDeskAnchors } from '../engine/world';

export interface ChipFrame {
  camera: CameraState;
  cssSize: Size;
}

export interface ChipLayerProps {
  frame: ChipFrame | null;
  occupants: readonly Occupant[];
  onChipClick: (agentId: number) => void;
}

/** Estimated chip box (CSS px) for declutter — matches .desk-chip metrics. */
const CHIP_HEIGHT = 22;
const CHIP_CHAR_PX = 6.7;
const CHIP_PAD_PX = 14;

/**
 * DOM desk-label layer over the canvas world ("text is DOM ALWAYS").
 * Chips are positioned per-desk via the world→canvas transform at a FIXED
 * on-screen size (never scaled by zoom), decluttered by chipLayout.ts so
 * adjacent desks stay readable at phone fit-to-view zoom. Each chip is a
 * real button: tap = open that agent's drawer (redundant with the board,
 * per the phone-grammar rule that chip actions are board-reachable too).
 */
export function ChipLayer({ frame, occupants, onChipClick }: ChipLayerProps) {
  if (frame === null || occupants.length === 0) return null;
  const { camera, cssSize } = frame;

  const anchors: ChipAnchor[] = occupiedDeskAnchors(occupants).map((desk) => {
    const point = worldToCanvas(camera, desk.worldX, desk.worldY);
    const text = chipText(desk.occupant);
    return {
      id: desk.agentId,
      x: point.x,
      y: point.y - CHIP_HEIGHT,
      width: text.length * CHIP_CHAR_PX + CHIP_PAD_PX,
      height: CHIP_HEIGHT,
    };
  });
  const placed = declutterChips(anchors);
  const byId = new Map(occupiedDeskAnchors(occupants).map((desk) => [desk.agentId, desk.occupant]));

  return (
    <div className="chip-layer">
      {placed.map((chip) => {
        const occupant = byId.get(chip.id);
        if (!occupant) return null;
        if (chip.x < -chip.width || chip.x > cssSize.width + chip.width) return null;
        return (
          <button
            type="button"
            key={chip.id}
            className={occupant.loud ? 'desk-chip desk-chip--loud' : 'desk-chip'}
            data-testid="desk-chip"
            style={{ left: `${String(chip.x)}px`, top: `${String(chip.y)}px` }}
            onClick={() => {
              onChipClick(chip.id);
            }}
          >
            {chipText(occupant)}
          </button>
        );
      })}
    </div>
  );
}

function chipText(occupant: Occupant): string {
  return `${occupant.statusGlyph} ${occupant.name} · ${occupant.statusWord}`;
}
