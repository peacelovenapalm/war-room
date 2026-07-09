import type { ReactNode } from 'react';

import { HUD_LAYER, type HudCorner } from '../../hudLayout.js';

interface HudStackProps {
  corner: HudCorner;
  /** Defaults to HUD_LAYER.BAR — pass HUD_LAYER.TRAY / .CRITICAL when this
   *  stack contains a member from that tier (see hudLayout.ts doc). */
  layer?: number;
  children: ReactNode;
}

// bottom-right's `bottom-88` is a measured vertical clearance, not a guess:
// BottomToolbar (bottom-left) is a single-row toolbar whose height is
// stable regardless of button count (~61px measured at both desktop and
// mobile viewports), anchored `bottom-10` desktop / `bottom-4` mobile — so
// its top edge sits ~71px (desktop) / ~65px (mobile) above the screen
// bottom at both. BottomToolbar's natural content width (~1237px at
// desktop, unconstrained) reaches under bottom-right's `right-28` column
// whenever the window is narrower than ~1300px — true at BOTH the
// iPhone-14 viewport AND our 1280px desktop test viewport, so this is a
// real cross-corner collision at desktop too, not mobile-only (it
// reproduces the G6 "SOUND: ON cut off by the v1.3 tag" finding,
// TUNING.md [G6]). `bottom-88` clears the taller (desktop, 71px) case with
// ~17px to spare at both — revisit if BottomToolbar ever grows a 2nd row.
const CORNER_CLASSES: Record<HudCorner, string> = {
  'top-left': 'top-8 left-8 items-start',
  'top-center': 'top-8 left-1/2 -translate-x-1/2 items-center',
  'top-right': 'top-8 right-8 items-end',
  'bottom-left': 'bottom-10 left-10 items-start flex-col-reverse max-sm:bottom-4 max-sm:left-4',
  'bottom-right': 'bottom-88 right-28 items-end flex-col-reverse',
};

/**
 * Reserved-slot stacking container for top/bottom-anchored HUD overlays
 * (KICKOFF v1.1 item 4). One instance per screen corner, anchored ONCE at a
 * fixed edge offset; every child lays out in normal flex flow instead of an
 * independent `absolute top-N`, so a new sibling never has to guess a pixel
 * offset that happens not to collide with what's already there — the flex
 * `gap` IS the reserved slot, and it adapts to each child's real rendered
 * height instead of an assumed one.
 *
 * `bottom-*` corners use `flex-col-reverse`: the FIRST child in DOM order
 * renders closest to the screen edge, later children stack away from it —
 * so callers list children nearest-edge-first, matching how they read.
 * Conditionally-rendered (null) children leave no gap.
 */
export function HudStack({ corner, layer = HUD_LAYER.BAR, children }: HudStackProps) {
  return (
    <div
      // pointer-events-none on the container + auto on direct children:
      // a flex column's cross-axis width matches its WIDEST row, so a
      // narrower row (e.g. EconomyHUD) leaves an "empty" strip that's still
      // part of the container's own box — without this, that empty strip
      // silently intercepted clicks meant for a neighboring corner's
      // control underneath it (found via e2e: EconomyHUD+TriagePanel in
      // top-right, at the iPhone-14 width, swallowed the STOP ALL click in
      // top-center). Children that must stay click-through themselves
      // (ProgressionHUD, EconomyHUD) mark that with `!pointer-events-none`
      // so it wins over this rule.
      className={`absolute flex flex-col gap-4 pointer-events-none [&>*]:pointer-events-auto ${CORNER_CLASSES[corner]}`}
      style={{ zIndex: layer }}
      data-testid={`hud-stack-${corner}`}
    >
      {children}
    </div>
  );
}
