import { type ReactNode, useEffect, useRef, useState } from 'react';

import {
  computeTipPlacement,
  HOVER_DELAY_MS,
  LONG_PRESS_MS,
  type TipPlacement,
} from '../state/controlTip';

export interface ControlTipProps {
  /** Short, honest, one-line tip text — never describes a capability that
   *  isn't actually wired (T1a rule). */
  label: string;
  /** 'inline-flex' (default) shrink-wraps to the trigger — right for a
   *  single button/chip. 'flex' is for wrapping a full-width row (a
   *  PanelDock entry) — pass it together with a `w-full`-equivalent class
   *  on the trigger itself so the wrapper doesn't shrink the row back
   *  down to content width. */
  display?: 'inline-flex' | 'flex';
  /** Extra classes on the wrapper span. */
  className?: string;
  /** data-testid on the wrapper span (rarely needed — most e2e assertions
   *  target the trigger's own data-testid, which still works: the wrapper
   *  is transparent to layout and to child event bubbling). */
  testId?: string;
  children: ReactNode;
}

/**
 * Hover + keyboard-focus + long-press tooltip (T1a face-merge port of
 * webview-ui's ControlTooltip.tsx, restyled to v3's plain-CSS terminal
 * chrome — no Tailwind). Colorblind-safe by construction: the bubble is
 * shape (a bordered box) + text, no color-only signal.
 *
 * Touch is first-class, not an afterthought: a long-press (~450ms) reveals
 * the tip and arms `suppressNextClick` so the browser's synthetic click
 * that follows touchend does NOT also activate the wrapped button — a
 * long-press to read a tip must never fire the control it's labeling.
 */
export function ControlTip({
  label,
  display = 'inline-flex',
  className = '',
  testId,
  children,
}: ControlTipProps) {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [placement, setPlacement] = useState<TipPlacement | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const pressTimer = useRef<number | undefined>(undefined);
  const suppressNextClick = useRef(false);

  const clearTimers = () => {
    if (hoverTimer.current !== undefined) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = undefined;
    }
    if (pressTimer.current !== undefined) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = undefined;
    }
  };

  const reveal = () => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPlacement(computeTipPlacement(rect, { width: window.innerWidth }));
    setVisible(true);
  };

  const hide = () => {
    setVisible(false);
  };

  // Dismiss on scroll (e.g. the phone panel-dock's own horizontal scroll,
  // or the page) — a fixed-position bubble anchored to a now-stale rect
  // must not linger.
  useEffect(() => {
    if (!visible) return;
    const onScroll = () => {
      hide();
    };
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [visible]);

  useEffect(() => clearTimers, []);

  return (
    <span
      ref={wrapperRef}
      className={`control-tip control-tip--${display}${className ? ` ${className}` : ''}`}
      data-testid={testId}
      onMouseEnter={() => {
        clearTimers();
        hoverTimer.current = window.setTimeout(reveal, HOVER_DELAY_MS);
      }}
      onMouseLeave={() => {
        clearTimers();
        hide();
      }}
      onFocus={(event) => {
        // :focus-visible only — a mouse-driven click focus shouldn't also
        // pop the tip (the hover path already covers that case).
        const target = event.target;
        if (target instanceof Element && target.matches(':focus-visible')) {
          reveal();
        }
      }}
      onBlur={() => {
        hide();
      }}
      onTouchStart={() => {
        clearTimers();
        suppressNextClick.current = false;
        pressTimer.current = window.setTimeout(() => {
          reveal();
          suppressNextClick.current = true;
        }, LONG_PRESS_MS);
      }}
      onTouchMove={() => {
        // A scroll/drag cancels the pending long-press — this isn't a press.
        clearTimers();
      }}
      onTouchEnd={() => {
        clearTimers();
        if (suppressNextClick.current) {
          hide();
        }
      }}
      onTouchCancel={() => {
        // OS-cancelled touch (system gesture, scroll interrupt): the bubble
        // would otherwise stick at a stale anchor and the armed
        // suppressNextClick would swallow a LATER non-touch activation
        // (keyboard Enter on a hybrid device) — P6 codex review finding #4.
        clearTimers();
        hide();
        suppressNextClick.current = false;
      }}
      onClickCapture={(event) => {
        // The long-press already showed the tip; the synthetic click that
        // follows touchend must not ALSO activate the wrapped control.
        if (suppressNextClick.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressNextClick.current = false;
        }
      }}
    >
      {children}
      {visible && placement && (
        <span
          role="tooltip"
          data-testid="control-tip-bubble"
          className="control-tip__bubble"
          style={{
            top: placement.top,
            left: placement.left,
            transform: `translate(${
              placement.align === 'left' ? '0' : placement.align === 'right' ? '-100%' : '-50%'
            }, ${placement.side === 'above' ? '-100%' : '0'})`,
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
