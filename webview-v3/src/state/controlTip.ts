/**
 * ControlTip — hover/long-press tooltip timing + positioning logic
 * (T1a face-merge port of webview-ui/src/components/ui/ControlTooltip.tsx,
 * restyled to v3's plain-CSS terminal chrome — see components/ControlTip.tsx
 * for the React wrapper). Positioning is factored out here as a pure
 * function so it's unit-testable without a DOM harness (this workspace's
 * vitest environment is 'node' — see cssZIndex.test.ts's header for the
 * same constraint).
 *
 * Placement strategy deliberately avoids needing the bubble's rendered
 * width to clamp it to the viewport: a 3-zone horizontal alignment
 * (left/center/right, keyed off the trigger's own position) plus a
 * top-edge flip (above -> below) covers every real call site — the HUD
 * strip, the PanelDock column, TriageBoard rows, the AgentDrawer, and the
 * CallModal mode toggle — without a two-pass measure-then-position render.
 */

export const HOVER_DELAY_MS = 500;
export const LONG_PRESS_MS = 450;

const GAP_PX = 6;
/** Below this distance from the viewport top, flip the bubble under the
 *  trigger instead of over it — covers the HUD strip chips and the first
 *  PanelDock row on short viewports. */
const TOP_FLIP_THRESHOLD_PX = 40;

export interface TipRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
}

export interface TipViewport {
  width: number;
}

export type TipSide = 'above' | 'below';
export type TipAlign = 'left' | 'center' | 'right';

export interface TipPlacement {
  side: TipSide;
  align: TipAlign;
  /** CSS `top` px, paired with `side` (component applies `translateY(-100%)`
   *  for 'above' so the bubble's bottom edge sits at this coordinate,
   *  `translateY(0)` for 'below' so the bubble's top edge sits here). */
  top: number;
  /** CSS `left` px, paired with `align` for the matching translateX. */
  left: number;
}

/** Pure — no DOM reads. Caller passes the trigger's live
 *  getBoundingClientRect() plus window.innerWidth. */
export function computeTipPlacement(trigger: TipRect, viewport: TipViewport): TipPlacement {
  const side: TipSide = trigger.top < TOP_FLIP_THRESHOLD_PX ? 'below' : 'above';
  const top = side === 'above' ? trigger.top - GAP_PX : trigger.bottom + GAP_PX;

  const centerX = trigger.left + trigger.width / 2;
  const thirdWidth = viewport.width / 3;
  let align: TipAlign;
  let left: number;
  if (centerX < thirdWidth) {
    align = 'left';
    left = trigger.left;
  } else if (centerX > viewport.width - thirdWidth) {
    align = 'right';
    left = trigger.right;
  } else {
    align = 'center';
    left = centerX;
  }
  return { side, align, top, left };
}
