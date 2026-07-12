import { useEffect, useState } from 'react';

import { formatAge } from '../state/crisis';
import { daysStale, isMorningSourceStale, type MorningBriefing } from '../state/morning';
import { SEVERITY_GLYPHS } from '../state/opsReview';
import {
  compactTokens,
  EFFICIENCY_WORDS,
  formatClock,
  isShiftReportStale,
  type ShiftReport,
  type ShiftSnapshot,
} from '../state/shiftReport';
import { Modal } from './Modal';

const REFRESH_INTERVAL_MS = 60_000;
// The MORNING fold refreshes on its own slower cadence (mirrors
// BriefingPanel.tsx) — a digest/todo file changes once a day, not every
// minute like the game-derived SHIFT stats.
const MORNING_REFRESH_INTERVAL_MS = 5 * 60_000;

export interface ShiftPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

function Row({ glyph, word, value }: { glyph: string; word: string; value: string }) {
  return (
    <div className="shift-row" data-testid="shift-row">
      <span className="shift-row__label">
        {glyph} {word}
      </span>
      <span className="shift-row__value">{value}</span>
    </div>
  );
}

/** MORNING fold (v4 T7: "War Room IS morning") — today's daily-digest
 *  summary + todo top-3, both read from the same GET /api/briefing path
 *  BriefingPanel.tsx already uses. Absent sources render an honest
 *  "no source" line, never an empty-but-plausible section; a source dated
 *  before today renders a shape+word ◷ STALE marker (colorblind rule —
 *  never color alone). */
function MorningSection({ briefing }: { briefing: MorningBriefing | null }) {
  const todo = briefing?.todo ?? null;
  const digest = briefing?.digest ?? null;

  return (
    <div className="shift-morning" data-testid="shift-morning">
      <h3 className="shift-morning__title">☀ MORNING</h3>
      <div className="shift-morning__block" data-testid="shift-morning-digest">
        <span className="shift-morning__label">FLAGS</span>
        {!digest ? (
          <span className="modal__muted">no digest source configured</span>
        ) : (
          <>
            <span>{digest.flagsSummary || 'nothing flagged'}</span>
            {isMorningSourceStale(digest.date) && (
              <span className="modal__warn" data-testid="shift-morning-digest-stale">
                {' '}
                ◷ STALE {daysStale(digest.date)}d
              </span>
            )}
          </>
        )}
      </div>
      <div className="shift-morning__block" data-testid="shift-morning-todo">
        <span className="shift-morning__label">START NOW</span>
        {!todo ? (
          <span className="modal__muted">no todo source configured</span>
        ) : todo.startNow.length === 0 ? (
          <span className="modal__muted">nothing flagged for right now</span>
        ) : (
          <>
            <ol className="shift-morning__todo-list">
              {todo.startNow.slice(0, 3).map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ol>
            {isMorningSourceStale(todo.date) && (
              <span className="modal__warn" data-testid="shift-morning-todo-stale">
                ◷ STALE {daysStale(todo.date)}d
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function YesterdayCard({ report }: { report: ShiftReport }) {
  return (
    <div className="shift-yesterday" data-testid="shift-yesterday">
      <div className="shift-yesterday__head">◐ YESTERDAY — {report.date}</div>
      <div>
        {report.turnsCompleted} turns · {compactTokens(report.tokensOut)} tokens out ·{' '}
        {report.crisesResolved}/{report.crisesIgnited} crises resolved ·{' '}
        <strong>{report.efficiency ?? 'n/a'}</strong>
      </div>
    </div>
  );
}

/** SHIFT REPORT (KICKOFF-v3.1 stage-3 port): today's scorecard from real
 *  events — completed turns, real token spend, crisis throughput. Fetches
 *  GET /api/shift on open + every 60s. Efficiency rewards LOW spend. */
export function ShiftPanel({ isOpen, onClose }: ShiftPanelProps) {
  const [snapshot, setSnapshot] = useState<ShiftSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [morning, setMorning] = useState<MorningBriefing | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/shift');
        if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
        const data = (await res.json()) as ShiftSnapshot;
        if (!cancelled) {
          setSnapshot(data);
          setError(false);
          setLastUpdatedAt(Date.now());
        }
      } catch {
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

  // MORNING fold: same GET /api/briefing path BriefingPanel.tsx uses,
  // fetched independently on its own slower cadence — a failure here
  // never blocks the game-derived SHIFT stats above from rendering.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/briefing');
        if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
        const data = (await res.json()) as MorningBriefing;
        if (!cancelled) setMorning(data);
      } catch {
        // Honest empty state (no source configured) — MorningSection
        // already renders "no source" for a null briefing; no separate
        // error banner needed for a secondary fold.
      }
    };
    void load();
    const interval = setInterval(() => void load(), MORNING_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isOpen]);

  const report = snapshot?.today ?? null;
  const stale = isShiftReportStale(report !== null, error);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`SHIFT REPORT${report ? ` — ${report.date}` : ''}`}
      testId="shift-panel"
    >
      {error && !report && <div className="modal__warn">⚠ unable to reach /api/shift</div>}
      {stale && (
        <div className="modal__warn" data-testid="shift-stale">
          ⚠ STALE — last updated {lastUpdatedAt !== null ? formatClock(lastUpdatedAt) : '—'}
        </div>
      )}
      <MorningSection briefing={morning} />
      {report && (
        <>
          <div className="shift-rows">
            <Row glyph="✓" word="TURNS" value={`${String(report.turnsCompleted)} completed`} />
            <Row
              glyph="⚠"
              word="CRISES"
              value={`${String(report.crisesIgnited)} ignited · ${String(report.crisesResolved)} resolved · ${String(report.crisesOpen)} open`}
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
          <div className="shift-efficiency" data-testid="shift-efficiency">
            <strong>✦ EFFICIENCY </strong>
            {report.efficiency === null ? (
              <span className="modal__muted">no completed turns yet today</span>
            ) : (
              <>
                <strong>{report.efficiency}</strong>
                <span className="modal__muted">
                  {' '}
                  · {report.outputTokensPerTurn} output tokens per completed turn —{' '}
                  {EFFICIENCY_WORDS[report.efficiency]}
                </span>
              </>
            )}
          </div>
          <p className="modal__footnote">
            Counted from real events today: hook turn-ends, JSONL token usage, poller
            blocked-episodes. Lower spend is always the better score.
          </p>
          {snapshot?.opsReview && (
            <div className="shift-ops-line" data-testid="shift-ops-line">
              {snapshot.opsReview.topFinding ? (
                <>
                  <span>
                    {SEVERITY_GLYPHS[snapshot.opsReview.topFinding.severity].glyph}{' '}
                    {SEVERITY_GLYPHS[snapshot.opsReview.topFinding.severity].word}
                  </span>
                  <span className="modal__muted"> · {snapshot.opsReview.topFinding.summary}</span>
                </>
              ) : (
                <span className="modal__muted">✓ ops: all clear</span>
              )}
              <span className="modal__muted">
                {' '}
                ({snapshot.opsReview.counts.alert} alert · {snapshot.opsReview.counts.warn} warn ·{' '}
                {snapshot.opsReview.counts.info} info — see OPS REVIEW)
              </span>
            </div>
          )}
          {snapshot && (
            <div className="shift-auto-line" data-testid="shift-auto-line">
              <span className="modal__muted">
                ⚙ {snapshot.autoActionCount} auto-action{snapshot.autoActionCount === 1 ? '' : 's'}{' '}
                today
              </span>
            </div>
          )}
          {snapshot?.yesterday && <YesterdayCard report={snapshot.yesterday} />}
        </>
      )}
    </Modal>
  );
}
