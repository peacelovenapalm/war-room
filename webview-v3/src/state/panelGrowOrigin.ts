/**
 * T6 item 4 — CAMERA-MOVE PANEL OPENS: the screen-space offset (from the
 * viewport center — modal-backdrop's flexbox centers every modal there) a
 * panel should visually grow FROM. `null` means "no anchor, no animation"
 * — the honest default for panels with no in-world prop (state/
 * panelFlight.ts) and for any open that gets cancelled mid-flight (App.tsx
 * clears this on ANY input).
 *
 * components/Modal.tsx applies this via a plain conditional className/
 * style on its ALREADY-persistent modal div — deliberately NOT a React
 * `key` (a key-based remount was tried and reverted: App.tsx's "any input
 * cancels" listener fires on literally every click, including clicks
 * INSIDE the just-opened panel, so a key-based approach forced a spurious
 * DOM remount the instant a user touched the newly-opened panel,
 * intermittently dropping the very click/select interaction that
 * triggered it — e2e regression caught in panels.spec.ts). Since Modal
 * already unmounts (isOpen false → returns null) and remounts fresh
 * content on every distinct open, a plain class toggle is sufficient: the
 * CSS animation plays once per fresh mount, and cancelling later just
 * drops the class — the browser reverts to its un-animated resting
 * transform instantly, no DOM node destroyed.
 *
 * Split into its own file (not colocated with the Modal component) so
 * react-refresh's "only export components" rule stays satisfied —
 * Modal.tsx only exports the Modal component itself.
 */

import { createContext } from 'react';

export interface PanelGrowOrigin {
  dx: number;
  dy: number;
}

/** Provided once by App.tsx around the whole panel block; since only one
 *  panel is ever `isOpen` at a time, the live (uncaptured) context value
 *  always belongs to whichever panel is actually rendering it. */
export const PanelGrowOriginContext = createContext<PanelGrowOrigin | null>(null);

/** App.tsx wraps the panel block in `<PanelGrowOriginProvider value={...}>`;
 *  components/Modal.tsx reads it back via `useContext(PanelGrowOriginContext)`. */
export const PanelGrowOriginProvider = PanelGrowOriginContext.Provider;
