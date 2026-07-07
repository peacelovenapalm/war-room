import { useEffect, useState } from 'react';

import { formatAge } from '../office/crisis.js';
import { Modal } from './ui/Modal.js';

/** Refresh cadence while the panel is open. */
const REFRESH_INTERVAL_MS = 60 * 1000;

interface ShiftReport {
  date: string;
  turnsCompleted: number;
  tokensIn: number;
  tokensOut: number;
  crisesIgnited: number;
  crisesResolved: number;
  crisesOpen: number;
  meanTimeToUnblockMs: number | null;
  longestBlockedMs: number;
  todosClosed: number | null;
  gatesAdvanced: number | null;
  outputTokensPerTurn: number | null;
  efficiency: 'LEAN' | 'STEADY' | 'HEAVY' | null;
  generatedAt: string;
}

interface ShiftPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

function compactTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Colorblind rule: WORD carries the grade; color is reinforcement only. */
const EFFICIENCY_WORDS: Record<NonNullable<ShiftReport['efficiency']>, string> = {
  LEAN: 'LEAN — low spend per completed turn. Keep it up.',
  STEADY: 'STEADY — normal spend per completed turn.',
  HEAVY: 'HEAVY — high spend per completed turn. Worth a look.',
};

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

/** SHIFT REPORT (v1 mechanic #2): today's scorecard from real events —
 *  completed turns, real token spend, crisis throughput, briefing deltas.
 *  Efficiency REWARDS LOW SPEND (tokens are money) — the grade is a WORD.
 *  In-dashboard only; push delivery is an open question for Greg. */
export function ShiftPanel({ isOpen, onClose }: ShiftPanelProps) {
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/shift');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ShiftReport;
        if (!cancelled) {
          setReport(data);
          setError(false);
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
          </>
        )}
      </div>
    </Modal>
  );
}
