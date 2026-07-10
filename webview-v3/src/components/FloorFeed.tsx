import { useEffect, useRef } from 'react';

import type { FloorFeedEntry } from '../state/floorFeed';

/** Matches TailSheet's near-bottom band (same autoscroll grammar). */
const NEAR_BOTTOM_PX = 40;

export interface FloorFeedProps {
  entries: readonly FloorFeedEntry[];
}

/**
 * GAME-DESIGN-V3 §3.2 item 4 — phone-only (CSS-gated), all desks' tails
 * merged into one live `[agent-name]`-prefixed stream below the triage
 * board. DOM ALWAYS (stage-2 convention); near-bottom-only autoscroll so a
 * reader scrolled up to read history is never yanked back down.
 */
export function FloorFeed({ entries }: FloorFeedProps) {
  const logRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);

  useEffect(() => {
    const log = logRef.current;
    if (!log || !nearBottomRef.current) return;
    log.scrollTop = log.scrollHeight;
  }, [entries.length]);

  return (
    <div className="floor-feed" data-testid="floor-feed">
      <div
        className="floor-feed__log"
        data-testid="floor-feed-log"
        ref={logRef}
        onScroll={() => {
          const log = logRef.current;
          if (!log) return;
          nearBottomRef.current =
            log.scrollHeight - log.scrollTop - log.clientHeight <= NEAR_BOTTOM_PX;
        }}
      >
        {entries.length === 0 ? (
          <div className="floor-feed__empty">■ NO ACTIVITY YET</div>
        ) : (
          entries.map((entry) => (
            <div className="floor-feed__line" key={entry.key}>
              <span className="floor-feed__label">{entry.label}</span> {entry.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
