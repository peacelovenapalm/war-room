import { useSyncExternalStore } from 'react';

import type { HotspotKind } from '../engine/hotspots';
import type { Occupant } from '../engine/world';
import type { DispatchVisitor } from '../state/dispatchVisitors';
import type { SpeechBubbleEvent } from '../state/speechBubbles';
import type { WorldFrameStore } from '../state/worldFrameStore';
import { ChipLayer } from './ChipLayer';
import { DispatchVisitorChips } from './DispatchVisitorChips';
import { PropHotspots } from './PropHotspots';
import { SpeechBubbleLayer } from './SpeechBubbleLayer';

export interface WorldOverlayProps {
  store: WorldFrameStore;
  occupants: readonly Occupant[];
  visitors: readonly DispatchVisitor[];
  bubbles: readonly SpeechBubbleEvent[];
  alwaysShowLabels: boolean;
  onDesk: (agentId: number) => void;
  onOpenHotspot: (kind: HotspotKind) => void;
}

/** Camera frames update this small subtree without reconciling App's HUD,
 * panels, drawers, and telemetry surfaces on every animation frame. */
export function WorldOverlay({
  store,
  occupants,
  visitors,
  bubbles,
  alwaysShowLabels,
  onDesk,
  onOpenHotspot,
}: WorldOverlayProps) {
  const frame = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return (
    <>
      <ChipLayer
        frame={frame}
        occupants={occupants}
        onChipClick={onDesk}
        alwaysShowLabels={alwaysShowLabels}
      />
      <DispatchVisitorChips frame={frame} visitors={visitors} />
      <SpeechBubbleLayer
        frame={frame}
        bubbles={bubbles}
        occupants={occupants}
        onTapAgent={onDesk}
      />
      <PropHotspots frame={frame} onOpen={onOpenHotspot} alwaysShowLabels={alwaysShowLabels} />
    </>
  );
}
