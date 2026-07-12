import { useEffect, useState } from 'react';

import {
  dispatchChipLabel,
  type DispatchEntry,
  hasViewableResult,
  isTerminalDispatchStatus,
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
  /** T5 fleet controls, DAILY FLEET SPEND CEILING — the explicit human
   *  override for a HELD ('queued-budget') entry. */
  onRelease: (id: string) => void;
  /** T6 CLEAR DONE — bulk-dismiss every terminal entry at once. */
  onClearDone: () => void;
}

/** Dispatch lifecycle tray (KICKOFF-v3.1 stage-3 port, T6 persistence pass):
 *  one chip per in-flight or terminal dispatch. GLYPH + WORD only — T6
 *  ("the session disappears after reading" — Greg): NOTHING auto-clears by
 *  age any more. Every terminal chip (isTerminalDispatchStatus) carries its
 *  own ✕ DISMISS and stays until explicitly cleared, individually or via
 *  the tray-level CLEAR DONE; in-flight chips (ringing/answered/queued-
 *  budget) are never dismissible. Bottom-left strip, mirrors PinDock's
 *  always-visible placement. */
export function DispatchTray({
  entries,
  sendFailures,
  onDismiss,
  onView,
  onRelease,
  onClearDone,
}: DispatchTrayProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, PRUNE_TICK_MS);
    return () => {
      clearInterval(interval);
    };
  }, []);

  // pruneDispatchEntries is now a no-op filter (T6 — kept as the one call
  // site for a future change), so `visible` is just `entries` in receipt
  // order; `now` still drives the send-failure prune tick below.
  const visible = pruneDispatchEntries(entries, now);
  const visibleFailures = pruneSendFailures(sendFailures, now);
  if (visible.length === 0 && visibleFailures.length === 0) return null;

  const hasTerminal = visible.some((entry) => isTerminalDispatchStatus(entry.status));

  return (
    <div className="dispatch-tray" data-testid="dispatch-tray">
      {visible.map((entry) => {
        const viewable = hasViewableResult(entry);
        const terminal = isTerminalDispatchStatus(entry.status);
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
            {terminal && (
              <button
                type="button"
                className="dispatch-chip__dismiss"
                title="Dismiss"
                data-testid="dispatch-chip-dismiss"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss(entry.id);
                }}
              >
                ✕
              </button>
            )}
            {entry.status === 'queued-budget' && (
              <button
                type="button"
                className="dispatch-chip__release"
                title="Release — send to the runner now, bypassing the daily ceiling for this one request"
                data-testid="dispatch-chip-release"
                onClick={(e) => {
                  e.stopPropagation();
                  onRelease(entry.id);
                }}
              >
                RELEASE
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
      {hasTerminal && (
        <button
          type="button"
          className="dispatch-tray__clear-done"
          data-testid="dispatch-clear-done"
          onClick={onClearDone}
        >
          ✕ CLEAR DONE
        </button>
      )}
    </div>
  );
}
