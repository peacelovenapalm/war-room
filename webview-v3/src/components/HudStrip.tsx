import { useEffect, useRef } from 'react';

import type { ConnectionStatus } from '../net/connection';
import type { EconomySnapshot } from '../state/economy';
import { formatCashChip, formatRepChip } from '../state/economy';
import type { AgentTally, RealSheetKind, WingCount } from '../state/hud';
import { formatTally, formatWing, officeMood } from '../state/hud';
import { soundscapeToggleLabel } from '../state/soundscape';
import { ControlTip } from './ControlTip';
import { StopAllControl } from './StopAllControl';

const CONNECTION_CHIP: Record<ConnectionStatus, string> = {
  connecting: '◌ CONNECTING',
  live: '● LIVE',
  offline: '✕ OFFLINE',
};

export type ViewMode = 'floor' | 'board';

export interface HudStripProps {
  connectionStatus: ConnectionStatus;
  tally: AgentTally;
  wings: WingCount[];
  openCrises: number;
  economy: EconomySnapshot | null;
  grayscale: boolean;
  view: ViewMode;
  /** T6 item 5 — SOUNDSCAPE V1, DEFAULT MUTED. */
  soundscapeMuted: boolean;
  onToggleSoundscape: () => void;
  /** Lifted STOP ALL state — shared with AutomationPanel's instance so the
   *  two can never disagree (state/stopAll.ts). */
  automationStopped: boolean;
  automationLatchRevision: number;
  onToggleGrayscale: () => void;
  onToggleView: () => void;
  /** One-tap-real (hard rule 5): every chip decomposes into verbatim telemetry. */
  onOpenReal: (kind: RealSheetKind) => void;
  onOpenCall: () => void;
  onOpenShift: () => void;
  onOpenHelp: () => void;
}

/**
 * HUD strip (GAME-DESIGN-V3 §3.1) — DOM, always present, never gated.
 * Every stat chip is a BUTTON: tapping opens the verbatim-telemetry sheet
 * behind that number. ＋DISPATCH / ▦SHIFT / ?HELP are stage-3 panel ports;
 * they render disabled with an honest title rather than doing nothing
 * silently or being hidden.
 */
export function HudStrip({
  connectionStatus,
  tally,
  wings,
  openCrises,
  economy,
  grayscale,
  view,
  soundscapeMuted,
  onToggleSoundscape,
  automationStopped,
  automationLatchRevision,
  onToggleGrayscale,
  onToggleView,
  onOpenReal,
  onOpenCall,
  onOpenShift,
  onOpenHelp,
}: HudStripProps) {
  const headerRef = useRef<HTMLElement | null>(null);
  // M2 (beta finding): a tall mobile modal (MORNING) used to center under
  // the fixed HUD, hiding its own title/close behind it — the HUD wraps to
  // 2-3 rows on phone (hard rule 1: GRAYSCALE/FLOOR stay visible there
  // rather than hidden), so its real height isn't a fixed constant. This
  // measures it live and publishes it as `--hud-height`; index.css's phone
  // modal rule reads it to keep the modal's top edge below the HUD.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const publish = () => {
      document.documentElement.style.setProperty('--hud-height', `${String(el.offsetHeight)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <header className="hud" ref={headerRef}>
      <span className="brand">WAR ROOM · V3</span>
      <ControlTip label="WS connection to the real server.">
        <span className="chip" data-testid="hud-connection">
          {CONNECTION_CHIP[connectionStatus]}
        </span>
      </ControlTip>
      <button
        type="button"
        className="chip chip--tap"
        data-testid="hud-cash"
        title="Tap for the verbatim economy ledger"
        onClick={() => {
          onOpenReal('cash');
        }}
      >
        {formatCashChip(economy)}
      </button>
      <button
        type="button"
        className="chip chip--tap"
        data-testid="hud-rep"
        title="Tap for the verbatim economy ledger"
        onClick={() => {
          onOpenReal('rep');
        }}
      >
        {formatRepChip(economy)}
      </button>
      <button
        type="button"
        className="chip chip--tap"
        data-testid="hud-agents"
        title="Tap for the verbatim per-agent telemetry"
        onClick={() => {
          onOpenReal('tally');
        }}
      >
        {formatTally(tally)}
      </button>
      {wings.map((wing) => (
        <button
          type="button"
          key={wing.machine}
          className={wing.warnCount > 0 ? 'chip chip--tap chip--warn' : 'chip chip--tap'}
          data-testid="hud-wing"
          title="Tap for the verbatim per-agent telemetry"
          onClick={() => {
            onOpenReal('wings');
          }}
        >
          {formatWing(wing)}
        </button>
      ))}
      <button
        type="button"
        className={openCrises > 0 ? 'chip chip--tap chip--warn' : 'chip chip--tap'}
        data-testid="hud-mood"
        title="Tap for the verbatim crisis telemetry"
        onClick={() => {
          onOpenReal('mood');
        }}
      >
        {officeMood(openCrises)}
      </button>
      <span className="hud__spacer" />
      {/* Always visible, desktop AND phone (hard rule 8: never weaken the
          unattended-run safety net) — the HUD sits above every modal's
          backdrop (z-index) so this stays clickable even with a panel
          open. AutomationPanel repeats the SAME control for convenience
          while that panel is open; both render the ONE lifted stop state
          and hit the one real server endpoint. */}
      <StopAllControl stopped={automationStopped} latchRevision={automationLatchRevision} />
      <button type="button" data-testid="hud-open-call" onClick={onOpenCall}>
        ☎ CALL
      </button>
      <button type="button" data-testid="hud-open-shift" onClick={onOpenShift}>
        ▦ SHIFT
      </button>
      <button type="button" data-testid="hud-open-help" onClick={onOpenHelp}>
        ? HELP
      </button>
      <button
        type="button"
        data-testid="hud-view"
        aria-pressed={view === 'board'}
        title="Toggle between the office floor and the full triage board"
        onClick={onToggleView}
      >
        {view === 'floor' ? '⌂ FLOOR' : '▦ BOARD'}
      </button>
      <button
        type="button"
        data-testid="hud-grayscale"
        aria-pressed={grayscale}
        onClick={onToggleGrayscale}
      >
        ◑ GRAYSCALE {grayscale ? 'ON' : 'OFF'}
      </button>
      {/* T6 item 5 — SOUNDSCAPE V1: DEFAULT MUTED, own localStorage
          persistence (state/soundscape.ts), independent of SettingsModal's
          pre-existing server-synced `soundEnabled` (a VS Code adapter
          notification setting, a different subsystem entirely). */}
      <ControlTip label="Ambience + event chirps (WebAudio, no assets) — default muted.">
        <button
          type="button"
          data-testid="hud-soundscape"
          aria-pressed={!soundscapeMuted}
          onClick={onToggleSoundscape}
        >
          {soundscapeToggleLabel(soundscapeMuted)}
        </button>
      </ControlTip>
    </header>
  );
}
