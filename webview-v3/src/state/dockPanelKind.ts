/**
 * The DockPanelKind union lives in its own plain .ts module rather than
 * components/PanelDock.tsx so pure .ts consumers (state/panelFlight.ts and
 * its test) can depend on the type without pulling a .tsx file into a
 * tsconfig project that has no `jsx` flag — webview-v3/tsconfig.node.json's
 * `test/**\/*.ts` project, hit only under `tsc -b` (the vite build's
 * prebuild step), not the looser `tsc --noEmit` the root check-types
 * script runs. components/PanelDock.tsx re-exports this unchanged so every
 * existing `from './components/PanelDock'` import keeps working.
 */
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
  | 'graph-search'
  | 'districts'
  | 'inbox'
  | 'morning';
