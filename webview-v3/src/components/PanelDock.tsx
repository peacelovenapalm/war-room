import type { DockPanelKind } from '../state/dockPanelKind';
import { ControlTip } from './ControlTip';

export type { DockPanelKind } from '../state/dockPanelKind';

export interface PanelDockProps {
  onOpen: (kind: DockPanelKind) => void;
}

interface DockEntry {
  kind: DockPanelKind;
  glyph: string;
  label: string;
  /** One-line, honest purpose — T1a tooltip text (helpContent.ts wording
   *  where a matching section exists; terse new copy otherwise). */
  purpose: string;
}

/** Every panel, always — the dock is the cross-platform affordance (works
 *  on phone, where the world has no free camera play and prop hotspots in
 *  PropHotspots.tsx don't apply). HELP/SETTINGS/DEBUG/OPS have no in-world
 *  physical prop and live HERE ONLY; the other five are reachable both
 *  from their prop hotspot (desktop) and here (always). Collapsed strip,
 *  desktop chrome model's "compact dock" half. */
const ENTRIES: DockEntry[] = [
  {
    kind: 'call',
    glyph: '☎',
    label: 'CALL',
    purpose: 'Dispatch a coworker on a live machine, or launch a persistent session.',
  },
  {
    kind: 'automation',
    glyph: '⛓',
    label: 'AUTOMATION',
    purpose: 'Chains, standing orders, and the STOP ALL kill switch.',
  },
  {
    kind: 'contracts',
    glyph: '▤',
    label: 'CONTRACTS',
    purpose: 'Real vault todos/tracker gates rendered as payout-bearing contracts.',
  },
  {
    kind: 'shift',
    glyph: '▦',
    label: 'SHIFT',
    purpose: "Today's scorecard — completed turns, real token spend, crisis throughput.",
  },
  {
    kind: 'briefing',
    glyph: '▥',
    label: 'BRIEFING',
    purpose: "Today's todo top-3 + tracker gates.",
  },
  {
    kind: 'ops',
    glyph: '◈',
    label: 'OPS REVIEW',
    purpose: 'Self-healing ladder findings — kill/focus/requeue proposals, gated by confirm.',
  },
  {
    kind: 'graph-search',
    glyph: '⌕',
    label: 'SEARCH',
    purpose: 'Search the project knowledge graph.',
  },
  {
    kind: 'districts',
    glyph: '⌂',
    label: 'DISTRICTS',
    purpose: 'Per-machine district view of the office floor.',
  },
  {
    kind: 'inbox',
    glyph: '✉',
    label: 'INBOX',
    purpose: 'Routine outputs (digest, todo) newest-first.',
  },
  {
    kind: 'settings',
    glyph: '⚙',
    label: 'SETTINGS',
    purpose: 'Sound + notification preferences, hooks status.',
  },
  {
    kind: 'debug',
    glyph: '⌗',
    label: 'DEBUG',
    purpose: 'Raw agent table — verbatim wire state.',
  },
  { kind: 'help', glyph: '?', label: 'HELP', purpose: 'This screen. Press ? anytime.' },
];

export function PanelDock({ onOpen }: PanelDockProps) {
  return (
    <nav className="panel-dock" data-testid="panel-dock" aria-label="Panels">
      {ENTRIES.map((entry) => (
        <ControlTip key={entry.kind} display="flex" label={entry.purpose}>
          <button
            type="button"
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
        </ControlTip>
      ))}
    </nav>
  );
}
