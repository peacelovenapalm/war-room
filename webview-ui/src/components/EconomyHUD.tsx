import type { EconomySnapshotClient } from '../hooks/useExtensionMessages.js';
import { ControlTooltip } from './ui/ControlTooltip.js';

interface EconomyHUDProps {
  economy: EconomySnapshotClient | null;
}

/**
 * ECONOMY HUD (v2 mechanic G2) — a small always-visible strip: Cash,
 * Reputation, vacation-mode badge. Colorblind rule: SHAPE + WORD carry the
 * signal (coin/star glyphs + labels), never color alone.
 *
 * Server-side state (economyStore.ts) — Cash/Reputation only ever come
 * from real, observed events; this widget never shows or implies a token
 * count.
 */
export function EconomyHUD({ economy }: EconomyHUDProps) {
  if (!economy) return null;

  const { cash, reputation, vacationMode } = economy;

  return (
    <div
      className="pixel-panel py-4 px-8 flex items-center gap-8 text-sm pointer-events-none! select-none"
      data-testid="economy-hud"
    >
      {/* pointer-events-auto scoped to just this content group (not the
          outer chip) — the chip must stay click-through per hudLayout.ts,
          but the visible glyphs themselves are a safe, tightly-bound area
          to make hoverable for the KICKOFF v1.1 item 8 tooltip. */}
      <ControlTooltip
        label="Cash + Reputation — real economy state from observed events only"
        side="bottom"
        className="pointer-events-auto items-center gap-8"
        focusable
        testId="economy-hud-tooltip-trigger"
      >
        <span className="flex items-center gap-3 font-bold whitespace-nowrap" title="Cash">
          <span aria-hidden="true">$</span>
          <span data-testid="economy-cash">{cash}</span>
        </span>

        <span className="flex items-center gap-3 whitespace-nowrap" title="Reputation">
          <span aria-hidden="true">★</span>
          <span data-testid="economy-reputation">{reputation}</span>
        </span>

        {vacationMode && (
          <span
            className="flex items-center gap-3 whitespace-nowrap font-bold"
            title="Vacation mode: decay/quits/world events paused"
            data-testid="economy-vacation-badge"
          >
            <span aria-hidden="true">⏸</span>
            <span>ON HOLIDAY</span>
          </span>
        )}
      </ControlTooltip>
    </div>
  );
}
