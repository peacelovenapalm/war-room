import { useEffect, useState } from 'react';

import { formatAge } from '../office/crisis.js';
import {
  compactTokens,
  EFFICIENCY_WORDS,
  formatClock,
  isShiftReportStale,
  type ShiftReport,
  type ShiftSnapshot,
} from '../shiftReport.js';
import { Modal } from './ui/Modal.js';

/** Refresh cadence while the panel is open. */
const REFRESH_INTERVAL_MS = 60 * 1000;

interface ShiftPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

function Row({ glyph, word, value }: { glyph: string; word: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-8 py-3 text-sm" data-testid="shift-row">
      <span className="flex items-center gap-5 min-w-0">
        <span className="shrink-0 leading-none">{glyph}</span>
        <span className="shrink-0 font-bold">{word}</span>
      </span>
      <span className="shrink-0 tabular-nums text-right">{value}</span>
    </div>
  );
}

/** Compact single-line summary of a closed day — used for the YESTERDAY
 *  card. Deliberately terser than the live scorecard (it's history, not
 *  the thing you're acting on right now). */
function YesterdayCard({ report }: { report: ShiftReport }) {
  return (
    <div className="mt-8 pt-8 border-t border-border" data-testid="shift-yesterday">
      <div className="text-2xs font-bold uppercase tracking-wide text-text-muted mb-3">
        ◐ YESTERDAY — {report.date}
      </div>
      <div className="text-sm">
        {report.turnsCompleted} turns · {compactTokens(report.tokensOut)} tokens out ·{' '}
        {report.crisesResolved}/{report.crisesIgnited} crises resolved ·{' '}
        <span className="font-bold">{report.efficiency ?? 'n/a'}</span>
      </div>
    </div>
  );
}

/** SHIFT REPORT (v1 mechanic #2): today's scorecard from real events —
 *  completed turns, real token spend, crisis throughput, briefing deltas.
 *  Efficiency REWARDS LOW SPEND (tokens are money) — the grade is a WORD.
 *  Also shows yesterday's closed ledger and marks the numbers STALE (shape
 *  + text) whenever a refresh fails instead of silently showing old data
 *  as fresh. Push delivery to the morning page / Bark is a separate,
 *  server-side feature (WAR_ROOM_PUSH_URLS) — this panel is unaffected by
 *  whether push is configured. */
export function ShiftPanel({ isOpen, onClose }: ShiftPanelProps) {
  const [snapshot, setSnapshot] = useState<ShiftSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/shift');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ShiftSnapshot;
        if (!cancelled) {
          setSnapshot(data);
          setError(false);
          setLastUpdatedAt(Date.now());
        }
      } catch (err) {
        console.log('[ShiftPanel] failed to fetch /api/shift:', err);
        if (!cancelled) setError(true);
      }
    };
    void load();
    const interval = setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isOpen]);

  const report = snapshot?.today ?? null;
  // Stale = we have data on screen but the most recent refresh failed —
  // never silently keep showing old numbers as if they were fresh.
  const stale = isShiftReportStale(report !== null, error);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`SHIFT REPORT${report ? ` — ${report.date}` : ''}`}
      className="max-w-md w-full"
    >
      <div className="px-10 pb-8 max-h-[70vh] overflow-auto">
        {error && !report && (
          <div className="text-sm text-status-permission mb-8">⚠ unable to reach /api/shift</div>
        )}
        {stale && (
          <div className="text-sm font-bold text-status-permission mb-8" data-testid="shift-stale">
            ⚠ STALE — last updated {lastUpdatedAt !== null ? formatClock(lastUpdatedAt) : '—'}
          </div>
        )}
        {report && (
          <>
            <div className="flex flex-col divide-y divide-border mb-8">
              <Row glyph="✓" word="TURNS" value={`${report.turnsCompleted} completed`} />
              <Row
                glyph="⚠"
                word="CRISES"
                value={`${report.crisesIgnited} ignited · ${report.crisesResolved} resolved · ${report.crisesOpen} open`}
              />
              <Row
                glyph="◷"
                word="MEAN UNBLOCK"
                value={
                  report.meanTimeToUnblockMs !== null
                    ? `${formatAge(report.meanTimeToUnblockMs)} (worst ${formatAge(report.longestBlockedMs)})`
                    : '— none resolved yet'
                }
              />
              <Row
                glyph="◔"
                word="TOKENS"
                value={`${compactTokens(report.tokensIn)} in · ${compactTokens(report.tokensOut)} out`}
              />
              <Row
                glyph="○"
                word="TODOS CLOSED"
                value={report.todosClosed !== null ? String(report.todosClosed) : 'no source'}
              />
              <Row
                glyph="◆"
                word="GATES ADVANCED"
                value={report.gatesAdvanced !== null ? String(report.gatesAdvanced) : 'no source'}
              />
            </div>
            <div className="text-sm" data-testid="shift-efficiency">
              <span className="font-bold">✦ EFFICIENCY </span>
              {report.efficiency === null ? (
                <span className="text-text-muted">no completed turns yet today</span>
              ) : (
                <>
                  <span className="font-bold">{report.efficiency}</span>
                  <span className="text-text-muted">
                    {' '}
                    · {report.outputTokensPerTurn} output tokens per completed turn —{' '}
                    {EFFICIENCY_WORDS[report.efficiency]}
                  </span>
                </>
              )}
            </div>
            <p className="text-2xs text-text-muted mt-8">
              Counted from real events today: hook turn-ends, JSONL token usage, poller
              blocked-episodes. Todo/gate deltas measure from the day&apos;s first activity. Lower
              spend is always the better score.
            </p>
            {snapshot?.yesterday && <YesterdayCard report={snapshot.yesterday} />}
          </>
        )}
      </div>
    </Modal>
  );
}
