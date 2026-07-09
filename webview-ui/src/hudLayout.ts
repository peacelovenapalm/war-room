/**
 * HUD/overlay layout system (KICKOFF v1.1 item 4). One authoritative z-index
 * scale (HUD_LAYER) plus a corner-stacking primitive (HudStack, see
 * components/ui/HudStack.tsx) so every top/bottom-anchored HUD element
 * reserves a slot in a flex column instead of hand-picking a `top-N`/
 * `bottom-N` pixel offset that happens not to collide with the others today
 * — the bug class that hit ProgressionHUD vs ZoomControls (identical
 * `top-8 left-8`), the zoom-% chip vs EditActionBar (both centered top row),
 * and the G6 mobile crowding findings (TUNING.md [G6]).
 *
 * Modal z-index (49-54, components/ui/Modal.tsx: HelpModal/ChangelogModal/
 * the hooks-info Modal in App.tsx) is a separate, pre-existing scale — every
 * HUD_LAYER value stays below it and must never be renumbered to collide.
 */
export const HUD_LAYER = {
  /** Canvas + its own decorations (vignette, build-action toast) — nothing
   *  in this file positions at this tier; it exists so the scale documents
   *  what HUD stacks sit above. */
  CANVAS: 0,
  /** A stack whose members are all "ambient chrome": persistent info chips
   *  with no other stack members outranking them. */
  BAR: 10,
  /** Trays/toasts that come and go over time: dispatch/chain trays, the
   *  version indicator, first-run tooltips. */
  TRAY: 20,
  /** A stack containing at least one always-must-be-reachable control:
   *  STOP ALL, the TRIAGE board, the world-event banner, Contracts. Once any
   *  member of a corner needs this tier, the whole stack uses it — z-index
   *  no longer prevents overlap between stack siblings (the flex layout
   *  already guarantees that), it only has to clear the canvas below it. */
  CRITICAL: 30,
} as const;

export type HudCorner = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-right';
