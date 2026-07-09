import { type ReactNode, useState } from 'react';

interface ControlTooltipProps {
  label: string;
  /** Which side of the trigger the popup opens on — top-anchored HUD
   *  controls (zoom, economy, triage) open downward so they stay under the
   *  screen edge; bottom-anchored ones (toolbar, kill in a modal) open
   *  upward. Caller picks based on its own on-screen position. */
  side?: 'top' | 'bottom';
  /** 'inline-flex' (default) shrink-wraps to the trigger's content, right
   *  for buttons/icon groups. 'flex' is for wrapping something that must
   *  keep its own full-width block layout (e.g. a TriagePanel row) — pass
   *  it together with a `w-full` in `className` so the wrapper doesn't
   *  shrink the row back down to content width. Only one display utility
   *  is ever emitted, so callers never fight a conflicting Tailwind class. */
  display?: 'inline-flex' | 'flex';
  /** Extra classes on the wrapper span. Needed at call sites nested inside
   *  a `pointer-events-none!` click-through HUD chip (e.g. EconomyHUD) —
   *  pass `pointer-events-auto` there so hover/focus can register on just
   *  the wrapped content, without touching the chip's own click-through
   *  behavior (hudLayout.ts / HudStack.tsx). */
  className?: string;
  /** Puts the wrapper itself in the tab order (`tabIndex=0`) so keyboard
   *  focus can reach it. Needed ONLY when `children` isn't already
   *  naturally focusable (e.g. EconomyHUD's plain display spans) — leave
   *  false when wrapping a Button/row that already takes focus itself,
   *  or Tab would stop twice on the same control. */
  focusable?: boolean;
  /** data-testid on the wrapper span — only needed at the one call site
   *  above (`focusable`) where e2e must target the wrapper directly to
   *  drive keyboard focus, since the wrapped content has no id of its own
   *  to focus instead. */
  testId?: string;
  children: ReactNode;
}

/**
 * Hover + keyboard-focus popup for the ~10 most-used controls (KICKOFF v1.1
 * item 8). The `title` attribute already used throughout this app is a
 * native browser tooltip — slow to appear and never shown on keyboard
 * focus, so it doesn't satisfy "contextual tooltips" as a discoverability
 * upgrade. This is plain React state + CSS, no new dependency, and is
 * intentionally separate from Tooltip.tsx (that component is a dismissable
 * first-run announcement card, not a hover tooltip).
 */
export function ControlTooltip({
  label,
  side = 'bottom',
  display = 'inline-flex',
  className = '',
  focusable = false,
  testId,
  children,
}: ControlTooltipProps) {
  const [visible, setVisible] = useState(false);

  return (
    <span
      className={`relative ${display} ${className}`}
      data-testid={testId}
      tabIndex={focusable ? 0 : undefined}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          data-testid="control-tooltip"
          className={`pixel-panel absolute left-1/2 -translate-x-1/2 py-3 px-6 text-xs whitespace-nowrap
            pointer-events-none ${side === 'top' ? 'bottom-full mb-4' : 'top-full mt-4'}`}
          style={{ zIndex: 999 }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
