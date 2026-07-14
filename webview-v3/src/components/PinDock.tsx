import { useNow } from '../hooks/useNow';
import type { AgentMap } from '../net/agentStore';
import type { TailMap } from '../state/tailStore';
import { tailKey } from '../state/tailStore';
import { deriveVisualState, STATE_CHIPS } from '../state/visualState';

export interface PinDockProps {
  pins: readonly number[];
  agents: AgentMap;
  tails: TailMap;
  /** Transient rejection line ("⚠ DOCK FULL — unpin one first"). */
  notice: string | null;
  onUnpin: (agentId: number) => void;
  /** Click a slot to promote it to the drawer. */
  onPromote: (agentId: number) => void;
}

/** Last N tail entries previewed per dock slot. */
const PREVIEW_ENTRIES = 2;

/**
 * Pinned-tail dock (desktop bottom strip) — the PERSISTENT streaming depth.
 * Exactly 3 slots (state/pinDock.ts); the rejection notice renders here so
 * "the dock is full" is said where the dock lives.
 */
export function PinDock({ pins, agents, tails, notice, onUnpin, onPromote }: PinDockProps) {
  const now = useNow(pins.length > 0);
  if (pins.length === 0 && notice === null) return null;
  return (
    <footer className="pin-dock" data-testid="pin-dock">
      {notice !== null && (
        <div className="pin-dock__notice" data-testid="pin-dock-notice">
          {notice}
        </div>
      )}
      <div className="pin-dock__slots">
        {pins.map((agentId) => {
          const record = agents.get(agentId);
          const chip = record ? STATE_CHIPS[deriveVisualState(record, now)] : undefined;
          const stream = tails.get(tailKey('agent', String(agentId)));
          const preview = stream?.entries.slice(-PREVIEW_ENTRIES) ?? [];
          return (
            <div className="pin-slot" data-testid="pin-slot" key={agentId}>
              <div className="pin-slot__head">
                <button
                  type="button"
                  className="pin-slot__promote"
                  title="Open this agent's drawer"
                  onClick={() => {
                    onPromote(agentId);
                  }}
                >
                  {record ? record.name : `#${String(agentId)} (gone)`}
                  {chip ? ` · ${chip.glyph} ${chip.label}` : ' · ✕ CLOSED'}
                </button>
                <button
                  type="button"
                  className="verb"
                  title="Unpin this tail"
                  onClick={() => {
                    onUnpin(agentId);
                  }}
                >
                  ✕
                </button>
              </div>
              <div className="pin-slot__tail">
                {preview.length === 0 ? (
                  <span className="tail-sheet__empty">■ NO OUTPUT YET</span>
                ) : (
                  preview.map((entry) => (
                    <span
                      key={`${entry.stream}:${String(entry.seq)}`}
                      className="tail-sheet__chunk"
                    >
                      {entry.text}
                    </span>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </footer>
  );
}
