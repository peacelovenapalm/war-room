import { useEffect, useState } from 'react';

import { latestVisibleWorldEvent, type WorldEventEntryClient } from '../worldEventBanner.js';
import { SignalChip } from './ui/SignalChip.js';

interface WorldEventBannerProps {
  events: WorldEventEntryClient[];
}

/**
 * WorldEventBanner (v2 mechanic G5, BUILD-PLAN §G5 task 2) — the visual
 * layer for worldEventStore's live `worldEventFired` broadcasts (§6.3).
 * Every event is pure fictional flavor, so it always renders through
 * SignalChip with real=false (§6.1) — never used for anything Cash/
 * Reputation-real (those effects arrive on their own economyUpdate).
 * Shape+text, dismissable, auto-hides so it never lingers like a real alert.
 * Selection logic lives in worldEventBanner.ts (this repo's plain-.ts
 * sibling convention for testable component logic).
 */
export function WorldEventBanner({ events }: WorldEventBannerProps) {
  const [now, setNow] = useState(() => Date.now());
  const [dismissedTs, setDismissedTs] = useState<Set<number>>(new Set());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const current = latestVisibleWorldEvent(events, dismissedTs, now);
  if (!current) return null;

  return (
    <div
      className="absolute top-24 left-8 z-30 world-event-banner"
      data-testid="world-event-banner"
    >
      <div className="inline-flex items-center gap-2">
        <SignalChip glyph={current.glyph} word={current.summary} real={false} />
        <button
          type="button"
          className="text-xs border-2 border-border py-2 px-3"
          data-testid="world-event-banner-dismiss"
          aria-label="Dismiss"
          onClick={() => setDismissedTs((prev) => new Set(prev).add(current.ts))}
        >
          ✗
        </button>
      </div>
    </div>
  );
}
