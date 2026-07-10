import type { ConnectionStatus } from '../net/connection';
import type { EconomySnapshot } from '../state/economy';
import { formatCashChip, formatRepChip } from '../state/economy';
import type { AgentTally, RealSheetKind, WingCount } from '../state/hud';
import { formatTally, formatWing, officeMood } from '../state/hud';
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
  onToggleGrayscale,
  onToggleView,
  onOpenReal,
  onOpenCall,
  onOpenShift,
  onOpenHelp,
}: HudStripProps) {
  return (
    <header className="hud">
      <span className="brand">WAR ROOM · V3</span>
      <span className="chip" data-testid="hud-connection">
        {CONNECTION_CHIP[connectionStatus]}
      </span>
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
          while that panel is open; both hit the one real server endpoint. */}
      <StopAllControl />
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
    </header>
  );
}
