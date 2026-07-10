import { useEffect, useState } from 'react';

import {
  dispatchChipLabel,
  type DispatchEntry,
  hasViewableResult,
  pruneDispatchEntries,
  pruneSendFailures,
  type SendFailure,
  sendFailureChipLabel,
} from '../net/dispatchFacts';

const PRUNE_TICK_MS = 5_000;

export interface DispatchTrayProps {
  entries: DispatchEntry[];
  sendFailures: SendFailure[];
  onDismiss: (id: string) => void;
  onView: (entry: DispatchEntry) => void;
}

/** Dispatch lifecycle tray (KICKOFF-v3.1 stage-3 port): one chip per
 *  in-flight or recently-terminal dispatch. GLYPH + WORD only — DENIED is
 *  sticky (dismiss only); every other terminal status auto-clears.
 *  Bottom-left strip, mirrors PinDock's always-visible placement. */
export function DispatchTray({ entries, sendFailures, onDismiss, onView }: DispatchTrayProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, PRUNE_TICK_MS);
    return () => {
      clearInterval(interval);
    };
  }, []);

  const visible = pruneDispatchEntries(entries, now);
  const visibleFailures = pruneSendFailures(sendFailures, now);
  if (visible.length === 0 && visibleFailures.length === 0) return null;

  return (
    <div className="dispatch-tray" data-testid="dispatch-tray">
      {visible.map((entry) => {
        const viewable = hasViewableResult(entry);
        return (
          <div
            key={entry.id}
            className={viewable ? 'dispatch-chip dispatch-chip--clickable' : 'dispatch-chip'}
            data-testid="dispatch-chip"
            role={viewable ? 'button' : undefined}
            onClick={
              viewable
                ? () => {
                    onView(entry);
                  }
                : undefined
            }
          >
            <span>
              {entry.action === 'focus' ? '[FOCUS] ' : ''}
              {entry.machine}
              {entry.provider ? ` · ${entry.provider}` : ''} — {dispatchChipLabel(entry)}
            </span>
            {entry.status === 'denied' && (
              <button
                type="button"
                className="dispatch-chip__dismiss"
                title="Dismiss"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss(entry.id);
                }}
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
      {visibleFailures.map((failure) => (
        <div
          key={failure.id}
          className="dispatch-chip dispatch-chip--warn"
          data-testid="dispatch-send-failure-chip"
        >
          {sendFailureChipLabel(failure)}
        </div>
      ))}
    </div>
  );
}
