import { useEffect, useState } from 'react';

import {
  dispatchChipLabel,
  type DispatchEntry,
  hasViewableResult,
  pruneDispatchEntries,
  pruneSendFailures,
  type SendFailure,
  sendFailureChipLabel,
} from '../dispatch.js';

/** Tick cadence for re-evaluating auto-clear ages — chips don't need to be
 *  pixel-precise, just to disappear within a few seconds of their window. */
const PRUNE_TICK_MS = 5_000;

interface DispatchTrayProps {
  entries: DispatchEntry[];
  onDismiss: (id: string) => void;
  /** Opens the result view for an EXITED entry's resultTail — the only
   *  status with output worth viewing (see hasViewableResult). */
  onView: (id: string) => void;
  /** Sends that never got a server ack within DISPATCH_SEND_TIMEOUT_MS —
   *  dispatchRequest has no ack on the wire, so this is the only honest
   *  signal a silently-dropped send (bad provider, ringing cap, ...) gets. */
  sendFailures: SendFailure[];
}

/** Dispatch lifecycle tray (v1 mechanic #6b): one chip per in-flight or
 *  recently-terminal dispatch/focus request. GLYPH + WORD only (colorblind
 *  hard rule) — DENIED is sticky until explicitly dismissed; every other
 *  terminal status clears itself after ~60s so the tray never grows forever.
 *  Send-failure chips ("⚠ NOT QUEUED — machine") auto-clear the same way.
 *  EXITED chips are additionally clickable to view the run's resultTail. */
export function DispatchTray({ entries, onDismiss, onView, sendFailures }: DispatchTrayProps) {
  // Local prune tick: entries the hook hands us are never removed on a timer
  // by themselves (upsertDispatchEntry only inserts/updates) — this
  // component owns the "hide it once it's old enough" presentation rule.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), PRUNE_TICK_MS);
    return () => clearInterval(interval);
  }, []);

  const visible = pruneDispatchEntries(entries, now);
  const visibleFailures = pruneSendFailures(sendFailures, now);
  if (visible.length === 0 && visibleFailures.length === 0) return null;

  return (
    <div className="flex flex-col gap-4 items-start" data-testid="dispatch-tray">
      {visible.map((entry) => {
        const viewable = hasViewableResult(entry);
        return (
          <div
            key={entry.id}
            className={`pixel-panel py-4 px-10 text-sm flex items-center gap-8 ${viewable ? 'cursor-pointer' : ''}`}
            data-testid="dispatch-chip"
            onClick={viewable ? () => onView(entry.id) : undefined}
            role={viewable ? 'button' : undefined}
            title={viewable ? 'Click to view result' : undefined}
          >
            <span className="whitespace-nowrap">
              {entry.action === 'focus' ? '[FOCUS] ' : ''}
              {entry.machine}
              {entry.provider ? ` · ${entry.provider}` : ''} — {dispatchChipLabel(entry)}
            </span>
            {entry.status === 'denied' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss(entry.id);
                }}
                className="bg-transparent border-none cursor-pointer text-text-muted hover:text-text shrink-0
                  max-sm:min-w-44 max-sm:min-h-44 max-sm:flex max-sm:items-center max-sm:justify-center"
                title="Dismiss"
              >
                x
              </button>
            )}
          </div>
        );
      })}
      {visibleFailures.map((failure) => (
        <div
          key={failure.id}
          className="pixel-panel py-4 px-10 text-sm text-warning"
          data-testid="dispatch-send-failure-chip"
        >
          {sendFailureChipLabel(failure)}
        </div>
      ))}
    </div>
  );
}
