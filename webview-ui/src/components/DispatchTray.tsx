import { useEffect, useState } from 'react';

import { dispatchChipLabel, type DispatchEntry, pruneDispatchEntries } from '../dispatch.js';

/** Tick cadence for re-evaluating auto-clear ages — chips don't need to be
 *  pixel-precise, just to disappear within a few seconds of their window. */
const PRUNE_TICK_MS = 5_000;

interface DispatchTrayProps {
  entries: DispatchEntry[];
  onDismiss: (id: string) => void;
}

/** Dispatch lifecycle tray (v1 mechanic #6b): one chip per in-flight or
 *  recently-terminal dispatch/focus request. GLYPH + WORD only (colorblind
 *  hard rule) — DENIED is sticky until explicitly dismissed; every other
 *  terminal status clears itself after ~60s so the tray never grows forever. */
export function DispatchTray({ entries, onDismiss }: DispatchTrayProps) {
  // Local prune tick: entries the hook hands us are never removed on a timer
  // by themselves (upsertDispatchEntry only inserts/updates) — this
  // component owns the "hide it once it's old enough" presentation rule.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), PRUNE_TICK_MS);
    return () => clearInterval(interval);
  }, []);

  const visible = pruneDispatchEntries(entries, now);
  if (visible.length === 0) return null;

  return (
    <div className="absolute bottom-64 left-10 z-20 flex flex-col gap-4 items-start">
      {visible.map((entry) => (
        <div
          key={entry.id}
          className="pixel-panel py-4 px-10 text-sm flex items-center gap-8"
          data-testid="dispatch-chip"
        >
          <span className="whitespace-nowrap">
            {entry.action === 'focus' ? '[FOCUS] ' : ''}
            {entry.machine}
            {entry.provider ? ` · ${entry.provider}` : ''} — {dispatchChipLabel(entry)}
          </span>
          {entry.status === 'denied' && (
            <button
              onClick={() => onDismiss(entry.id)}
              className="bg-transparent border-none cursor-pointer text-text-muted hover:text-text shrink-0"
              title="Dismiss"
            >
              x
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
