import { useEffect, useRef } from 'react';

import type { TailStreamState } from '../state/tailStore';
import { pausedCount } from '../state/tailStore';
import { ControlTip } from './ControlTip';

/** "Near bottom" band for autoscroll — scrolled within this many px of the
 *  end keeps following; scrolled further up never yanks the reader down. */
const NEAR_BOTTOM_PX = 40;

export interface TailSheetProps {
  /** Stream state; undefined = subscribed but nothing retained yet. */
  state: TailStreamState | undefined;
  onTogglePause: () => void;
  /** ⊞ PIN TAIL / ✕ UNPIN (desktop dock). Omitted = no pin affordance. */
  onTogglePin?: () => void;
  pinned?: boolean;
}

/**
 * DOM terminal panel — the FOCUSED streaming depth (GAME-DESIGN-V3 §4).
 * Monospace, selectable, near-bottom-only autoscroll, ⏸ PAUSE with a
 * buffered "+N WHILE PAUSED" counter (chunks are never dropped by pausing).
 * Text is DOM ALWAYS (stage-2 decision) — this panel never touches canvas.
 */
export function TailSheet({ state, onTogglePause, onTogglePin, pinned }: TailSheetProps) {
  const logRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);

  const entryCount = state?.entries.length ?? 0;
  useEffect(() => {
    const log = logRef.current;
    if (!log || !nearBottomRef.current) return;
    log.scrollTop = log.scrollHeight;
  }, [entryCount]);

  const buffered = state ? pausedCount(state) : 0;
  const paused = state?.paused ?? false;

  return (
    <div className="tail-sheet" data-testid="tail-sheet">
      <div className="tail-sheet__bar">
        <span className="tail-sheet__title">LIVE TAIL</span>
        {paused && buffered > 0 && (
          <span className="tail-sheet__paused-count" data-testid="tail-paused-count">
            +{String(buffered)} NEW WHILE PAUSED
          </span>
        )}
        <span className="tail-sheet__bar-spacer" />
        <ControlTip label="Freezes the live tail — new lines buffer as +N NEW WHILE PAUSED (lossless).">
          <button type="button" className="verb" data-testid="tail-pause" onClick={onTogglePause}>
            {paused ? '▶ RESUME' : '⏸ PAUSE'}
          </button>
        </ControlTip>
        {onTogglePin && (
          <ControlTip label="Docks this agent's tail in the desktop pin strip (3 slots max).">
            <button type="button" className="verb" data-testid="tail-pin" onClick={onTogglePin}>
              {pinned ? '✕ UNPIN' : '⊞ PIN TAIL'}
            </button>
          </ControlTip>
        )}
      </div>
      <div
        className="tail-sheet__log"
        data-testid="tail-log"
        ref={logRef}
        onScroll={() => {
          const log = logRef.current;
          if (!log) return;
          nearBottomRef.current =
            log.scrollHeight - log.scrollTop - log.clientHeight <= NEAR_BOTTOM_PX;
        }}
      >
        {state?.truncated === true && (
          <div className="tail-sheet__truncated">… earlier output evicted (server ring cap)</div>
        )}
        {entryCount === 0 ? (
          <div className="tail-sheet__empty">■ NO OUTPUT YET — subscribed, waiting for chunks</div>
        ) : (
          state?.entries.map((entry) => (
            <span
              key={entry.seq}
              className={
                entry.stream === 'stderr'
                  ? 'tail-sheet__chunk tail-sheet__chunk--stderr'
                  : 'tail-sheet__chunk'
              }
            >
              {entry.text}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
