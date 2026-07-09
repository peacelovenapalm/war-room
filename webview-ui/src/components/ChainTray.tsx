import { useEffect, useState } from 'react';

import { chainRunChipLabel, type ChainRunClient, pruneChainRuns } from '../chain.js';

const PRUNE_TICK_MS = 5_000;

interface ChainTrayProps {
  runs: ChainRunClient[];
  receivedAtById: Record<string, number>;
  onDismiss: (id: string) => void;
}

/** Chain run tray (v2 mechanic G3 — GAME-DESIGN.md §7.1): one chip per
 *  in-flight or recently-terminal chain run. GLYPH + WORD only (colorblind
 *  hard rule) — FAILED is sticky until explicitly dismissed; every other
 *  terminal status clears itself after ~60s. Sits above DispatchTray so
 *  the two lifecycles never visually merge. */
export function ChainTray({ runs, receivedAtById, onDismiss }: ChainTrayProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), PRUNE_TICK_MS);
    return () => clearInterval(interval);
  }, []);

  const visible = pruneChainRuns(runs, now, receivedAtById);
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-4 items-start" data-testid="chain-tray">
      {visible.map((run) => (
        <div
          key={run.id}
          className="pixel-panel py-4 px-10 text-sm flex items-center gap-8"
          data-testid="chain-run-chip"
        >
          <span className="whitespace-nowrap">CHAIN — {chainRunChipLabel(run)}</span>
          {run.status === 'failed' && (
            <button
              onClick={() => onDismiss(run.id)}
              className="bg-transparent border-none cursor-pointer text-text-muted hover:text-text shrink-0
                max-sm:min-w-44 max-sm:min-h-44 max-sm:flex max-sm:items-center max-sm:justify-center"
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
