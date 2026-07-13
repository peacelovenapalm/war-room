import { useEffect, useState } from 'react';

import type { ConnectionStatus } from '../net/connection';
import {
  fetchMorningSurface,
  formatDataAge,
  isAllCalm,
  isBoardStale,
  isMorningJsonStale,
  MORNING_REFRESH_INTERVAL_MS,
  type MorningSurface,
} from '../net/morningFacts';
import { clearAppBadge, setAppBadgeCount } from '../state/appBadge';
import {
  clearParkedDraft,
  listParkedDrafts,
  parkDraft,
  type ParkedDraft,
} from '../state/parkedDrafts';
import { Modal } from './Modal';

export interface MorningPanelProps {
  isOpen: boolean;
  onClose: () => void;
  connectionStatus: ConnectionStatus;
}

function StaleTag({ stale, ageSeconds }: { stale: boolean; ageSeconds: number | null }) {
  if (!stale) return null;
  return (
    <span className="modal__warn" data-testid="morning-stale">
      ◷ STALE {formatDataAge(ageSeconds)}
    </span>
  );
}

/**
 * MORNING view (V6-1 "one glance, one push", V6-DESIGN §V6-1). The board's
 * own fold of what used to be spread across the notifier's morning page +
 * the board + the PR list + a terminal: morning.json's top-3/flags/PRs,
 * live NEEDS-INPUT + HELD BUDGET board state, the overnight receipts
 * window, and the clean-morning streak (V6-6). An explicit "✓ ALL CALM"
 * state renders when isAllCalm() is genuinely true — never a blank when
 * data hasn't loaded yet (that's the `surface === null` branch instead).
 *
 * V6-2: the PWA badge mirrors needsYouCount, best-effort (appBadge.ts),
 * cleared on open/close. V6-3: offline actions PARK — REFRESH tapped
 * while disconnected lands in a visible PARKED DRAFTS list instead of
 * firing or silently failing; retry always requires an explicit re-tap.
 */
export function MorningPanel({ isOpen, onClose, connectionStatus }: MorningPanelProps) {
  const [surface, setSurface] = useState<MorningSurface | null>(null);
  const [error, setError] = useState(false);
  const [parked, setParked] = useState<ParkedDraft[]>([]);

  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setError(false);
      setParked(
        typeof window === 'undefined'
          ? []
          : listParkedDrafts(window.localStorage).filter((d) => d.kind === 'morning-refresh'),
      );
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = async () => {
      const data = await fetchMorningSurface();
      if (cancelled) return;
      if (data) {
        setSurface(data);
        setError(false);
      } else {
        setError(true);
      }
    };
    void load();
    const interval = setInterval(() => void load(), MORNING_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isOpen]);

  // V6-2: badge mirrors the live needsYouCount whenever it's known,
  // regardless of whether the panel itself is open (the badge is a
  // lock-screen-adjacent signal, not a panel-scoped one) -- cleared the
  // instant the panel is opened (Greg has now seen it).
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    if (isOpen) {
      clearAppBadge(navigator);
    } else if (surface) {
      setAppBadgeCount(navigator, surface.needsYouCount);
    }
  }, [isOpen, surface]);

  const handleRefresh = () => {
    if (connectionStatus !== 'live') {
      const draft = parkDraft(typeof window === 'undefined' ? undefined : window.localStorage, {
        kind: 'morning-refresh',
        label: 'REFRESH (offline — parked)',
      });
      setParked((prev) => [...prev, draft]);
      return;
    }
    void fetchMorningSurface().then((data) => {
      if (data) {
        setSurface(data);
        setError(false);
      } else {
        setError(true);
      }
    });
  };

  const handleRetryParked = (draft: ParkedDraft) => {
    clearParkedDraft(typeof window === 'undefined' ? undefined : window.localStorage, draft.id);
    setParked((prev) => prev.filter((d) => d.id !== draft.id));
    handleRefresh();
  };

  const handleClearParked = (id: string) => {
    clearParkedDraft(typeof window === 'undefined' ? undefined : window.localStorage, id);
    setParked((prev) => prev.filter((d) => d.id !== id));
  };

  const calm = surface !== null && isAllCalm(surface);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="☀ MORNING" testId="morning-panel" wide>
      <div className="modal__intro">
        One glance: needs-you, held jobs, overnight receipts, and the morning top 3.
      </div>

      {error && !surface && <div className="modal__warn">⚠ unable to reach /api/morning</div>}

      {surface && (
        <>
          {surface.degraded && (
            <div className="modal__warn" data-testid="morning-degraded">
              ⊘ DEGRADED — {surface.degradedReasons.join('; ')}
            </div>
          )}

          {calm && (
            <div className="modal__intro" data-testid="morning-all-calm">
              ✓ ALL CALM — nothing needs you
            </div>
          )}

          <div className="morning__section" data-testid="morning-needs-input">
            <span className="morning__section-label">
              ⚠ NEEDS INPUT ({String(surface.board.needsInput.count)})
            </span>
            <StaleTag
              stale={isBoardStale(surface.board)}
              ageSeconds={surface.board.dataAgeSeconds}
            />
            {surface.board.needsInput.count === 0 ? (
              <div className="modal__muted">none</div>
            ) : (
              <ul className="morning__list">
                {surface.board.needsInput.names.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="morning__section" data-testid="morning-held-budget">
            <span className="morning__section-label">
              ◷ HELD BUDGET ({String(surface.board.heldBudget.count)})
            </span>
            {surface.board.heldBudget.count === 0 ? (
              <div className="modal__muted">none</div>
            ) : (
              <ul className="morning__list">
                {surface.board.heldBudget.jobs.map((job, i) => (
                  <li key={`${job.machine}-${String(i)}`}>
                    {job.machine} — {job.promptPreview}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="morning__section" data-testid="morning-top3">
            <span className="morning__section-label">TOP 3</span>
            <StaleTag
              stale={isMorningJsonStale(surface.morningJson)}
              ageSeconds={surface.morningJson.dataAgeSeconds}
            />
            {!surface.morningJson.available ? (
              <div className="modal__warn" data-testid="morning-json-unavailable">
                ⊘ NO DATA — morning.json not available on this deployment
              </div>
            ) : surface.morningJson.top3.length === 0 ? (
              <div className="modal__muted">nothing queued</div>
            ) : (
              <ol className="morning__list">
                {surface.morningJson.top3.map((item) => (
                  <li key={item.n}>
                    {item.action}
                    {item.why && <span className="modal__muted"> — {item.why}</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {surface.morningJson.available && (
            <div className="morning__section" data-testid="morning-flags">
              <span className="morning__section-label">FLAGS</span>
              <div>{surface.morningJson.flags ?? 'nothing flagged'}</div>
            </div>
          )}

          {surface.morningJson.available && (
            <div className="morning__section" data-testid="morning-prs">
              <span className="morning__section-label">
                ✉ OPEN ROUTINE PRS ({String(surface.morningJson.prs.count)})
              </span>
              {surface.morningJson.prs.count === 0 ? (
                <div className="modal__muted">none</div>
              ) : (
                <ul className="morning__list">
                  {surface.morningJson.prs.list.map((pr) => (
                    <li key={pr.number}>
                      #{pr.number} {pr.title} ({pr.branch})
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="morning__section" data-testid="morning-overnight">
            <span className="morning__section-label">
              OVERNIGHT ({String(surface.overnight.receiptCount)})
            </span>
            {surface.overnight.receiptCount === 0 ? (
              <div className="modal__muted">no overnight actions</div>
            ) : (
              <ul className="morning__list">
                {surface.overnight.receipts.map((r, i) => (
                  <li key={`${r.ts}-${String(i)}`}>
                    {r.pending ? '⊘ PENDING' : r.ok ? '✓ EXECUTED' : '✗ FAILED'} {r.actionKind} —{' '}
                    {r.detail}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="morning__section" data-testid="morning-streak">
            <span className="morning__section-label">CLEAN-MORNING STREAK</span>
            <div>{surface.streak.count}</div>
            {surface.streak.lastBreachReason && (
              <div className="modal__muted">
                last breach: {surface.streak.lastBreachReason}
                {surface.streak.lastBreachAt ? ` (${surface.streak.lastBreachAt})` : ''}
              </div>
            )}
          </div>

          <footer className="morning__section" data-testid="morning-memory-footer">
            <span className="morning__section-label">◇ MEMORY RUNG 1</span>
            <div>
              {surface.memory.writePathEnabled
                ? `${surface.memory.writeMode === 'staged' ? '◇ STAGED' : '◆ DIRECT'} — ${String(surface.memory.cleanDayCount)}/7 clean days${surface.memory.promotionEligible ? ' · ✓ PROMOTION ELIGIBLE' : ''}`
                : '⊘ DISABLED — WAR_ROOM_VAULT_DIR not configured'}
            </div>
            <div>
              ▣ SURFACES / MORNING: {String(surface.memory.surfacesOpenedPerMorning)} · ✓ GRAPH
              ANSWERED: {String(surface.memory.graphAnswered)} · ↺ RE-DERIVED:{' '}
              {String(surface.memory.rederived)}
            </div>
            <div className="modal__muted">
              attribution counters are process-local and honestly reset on restart
            </div>
          </footer>

          <button
            type="button"
            className="verb"
            data-testid="morning-refresh"
            onClick={handleRefresh}
          >
            ↻ REFRESH
          </button>
        </>
      )}

      {parked.length > 0 && (
        <div className="morning__section" data-testid="morning-parked-drafts">
          <span className="morning__section-label">PARKED DRAFTS ({String(parked.length)})</span>
          <ul className="morning__list">
            {parked.map((draft) => (
              <li key={draft.id}>
                {draft.label}
                <button
                  type="button"
                  className="verb"
                  data-testid="morning-parked-retry"
                  onClick={() => {
                    handleRetryParked(draft);
                  }}
                >
                  ▸ RETRY
                </button>
                <button
                  type="button"
                  className="verb"
                  data-testid="morning-parked-clear"
                  onClick={() => {
                    handleClearParked(draft.id);
                  }}
                >
                  ✕ CLEAR
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
