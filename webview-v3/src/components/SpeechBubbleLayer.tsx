import { worldToCanvas } from '../engine/camera';
import { tileToWorld } from '../engine/iso';
import { type Occupant, occupiedDeskAnchors, staticPropTile } from '../engine/world';
import type { SpeechBubbleEvent } from '../state/speechBubbles';
import type { ChipFrame } from './ChipLayer';

export interface SpeechBubbleLayerProps {
  frame: ChipFrame | null;
  bubbles: readonly SpeechBubbleEvent[];
  occupants: readonly Occupant[];
  onTapAgent: (agentId: number) => void;
}

const BUBBLE_LIFT = 26;

/** A terminal dispatch's guest-slot sprite is already gone by the time its
 *  "done" bubble fires (the visitor derivation only includes RUNNING
 *  dispatches) — so a dispatch bubble anchors at the door tile instead
 *  (the office's one fixed "arrivals/departures" landmark, engine/
 *  world.ts's STATIC_PROPS) rather than a vanished guest slot. */
const DOOR_TILE = staticPropTile('door');
const DOOR_WORLD = tileToWorld(DOOR_TILE.tileX, DOOR_TILE.tileY);

/**
 * T6 item 3 — short-lived DOM bubbles over desks (world→canvas, same
 * convention as ChipLayer). Content is ALWAYS the real text
 * state/speechBubbles.ts already derived from real telemetry — this
 * component only positions and taps, never invents wording. Tapping an
 * agent bubble opens that agent's drawer (redundant with the desk chip,
 * per the phone-grammar rule); dispatch bubbles are informational only
 * (the always-visible tray is the click surface for a dispatch).
 */
export function SpeechBubbleLayer({
  frame,
  bubbles,
  occupants,
  onTapAgent,
}: SpeechBubbleLayerProps) {
  if (frame === null || bubbles.length === 0) return null;
  const { camera } = frame;

  const deskById = new Map(occupiedDeskAnchors(occupants).map((a) => [a.agentId, a]));

  return (
    <div className="speech-bubble-layer" data-testid="speech-bubble-layer">
      {bubbles.map((bubble) => {
        const anchor =
          bubble.anchor.kind === 'agent'
            ? deskById.get(bubble.anchor.agentId)
            : { worldX: DOOR_WORLD.worldX, worldY: DOOR_WORLD.worldY };
        if (!anchor) return null;
        const point = worldToCanvas(camera, anchor.worldX, anchor.worldY - BUBBLE_LIFT);
        const anchorAgentId = bubble.anchor.kind === 'agent' ? bubble.anchor.agentId : undefined;
        return (
          <div
            key={bubble.id}
            className={
              anchorAgentId !== undefined
                ? 'speech-bubble speech-bubble--clickable'
                : 'speech-bubble'
            }
            data-testid="speech-bubble"
            role={anchorAgentId !== undefined ? 'button' : undefined}
            style={{ left: `${String(point.x)}px`, top: `${String(point.y)}px` }}
            onClick={
              anchorAgentId !== undefined
                ? () => {
                    onTapAgent(anchorAgentId);
                  }
                : undefined
            }
          >
            {bubble.text}
          </div>
        );
      })}
    </div>
  );
}
