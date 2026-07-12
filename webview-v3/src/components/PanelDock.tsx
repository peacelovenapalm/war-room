export type DockPanelKind =
  | 'help'
  | 'settings'
  | 'debug'
  | 'call'
  | 'automation'
  | 'contracts'
  | 'shift'
  | 'briefing'
  | 'ops'
  | 'graph-search';

export interface PanelDockProps {
  onOpen: (kind: DockPanelKind) => void;
}

interface DockEntry {
  kind: DockPanelKind;
  glyph: string;
  label: string;
}

/** Every panel, always — the dock is the cross-platform affordance (works
 *  on phone, where the world has no free camera play and prop hotspots in
 *  PropHotspots.tsx don't apply). HELP/SETTINGS/DEBUG/OPS have no in-world
 *  physical prop and live HERE ONLY; the other five are reachable both
 *  from their prop hotspot (desktop) and here (always). Collapsed strip,
 *  desktop chrome model's "compact dock" half. */
const ENTRIES: DockEntry[] = [
  { kind: 'call', glyph: '☎', label: 'CALL' },
  { kind: 'automation', glyph: '⛓', label: 'AUTOMATION' },
  { kind: 'contracts', glyph: '▤', label: 'CONTRACTS' },
  { kind: 'shift', glyph: '▦', label: 'SHIFT' },
  { kind: 'briefing', glyph: '▥', label: 'BRIEFING' },
  { kind: 'ops', glyph: '◈', label: 'OPS REVIEW' },
  { kind: 'graph-search', glyph: '⌕', label: 'SEARCH' },
  { kind: 'settings', glyph: '⚙', label: 'SETTINGS' },
  { kind: 'debug', glyph: '⌗', label: 'DEBUG' },
  { kind: 'help', glyph: '?', label: 'HELP' },
];

export function PanelDock({ onOpen }: PanelDockProps) {
  return (
    <nav className="panel-dock" data-testid="panel-dock" aria-label="Panels">
      {ENTRIES.map((entry) => (
        <button
          type="button"
          key={entry.kind}
          className="panel-dock__item"
          data-testid={`dock-${entry.kind}`}
          title={entry.label}
          onClick={() => {
            onOpen(entry.kind);
          }}
        >
          <span className="panel-dock__glyph">{entry.glyph}</span>
          <span className="panel-dock__label">{entry.label}</span>
        </button>
      ))}
    </nav>
  );
}
