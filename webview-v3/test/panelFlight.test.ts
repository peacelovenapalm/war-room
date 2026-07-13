import { describe, expect, it } from 'vitest';

import type { DockPanelKind } from '../src/state/dockPanelKind';
import { panelFlightAnchor, PANELS_WITHOUT_ANCHOR } from '../src/state/panelFlight';

const ALL_KINDS: DockPanelKind[] = [
  'help',
  'settings',
  'debug',
  'call',
  'automation',
  'contracts',
  'shift',
  'briefing',
  'ops',
  'graph-search',
  'districts',
  'inbox',
  'morning',
];

describe('panelFlightAnchor', () => {
  it('resolves the real hotspot tile for every panel with a physical prop', () => {
    expect(panelFlightAnchor('call')).toMatchObject({ tileX: 1, tileY: 8 });
    expect(panelFlightAnchor('contracts')).toMatchObject({ tileX: 0, tileY: 5 });
    expect(panelFlightAnchor('automation')).toMatchObject({ tileX: 7, tileY: 0 });
    expect(panelFlightAnchor('shift')).toMatchObject({ tileX: 13, tileY: 5 });
    expect(panelFlightAnchor('briefing')).toMatchObject({ tileX: 10, tileY: 0 });
  });

  it('returns undefined (no invented anchor) for every panel with no physical prop', () => {
    for (const kind of PANELS_WITHOUT_ANCHOR) {
      expect(panelFlightAnchor(kind)).toBeUndefined();
    }
  });

  it('PANELS_WITHOUT_ANCHOR plus the anchored kinds cover every DockPanelKind exactly once', () => {
    const anchored = ALL_KINDS.filter((k) => panelFlightAnchor(k) !== undefined);
    const unanchored = ALL_KINDS.filter((k) => panelFlightAnchor(k) === undefined);
    expect(new Set(unanchored)).toEqual(new Set(PANELS_WITHOUT_ANCHOR));
    expect(anchored.length + unanchored.length).toBe(ALL_KINDS.length);
  });
});
