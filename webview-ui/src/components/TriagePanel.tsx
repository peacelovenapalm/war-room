import { useEffect, useRef, useState } from 'react';

import { buildTriageRows, type TriageRow } from '../office/crisis.js';
import { formatAge } from '../office/crisis.js';
import type { OfficeState } from '../office/engine/officeState.js';

/** Board refresh cadence — ages tick visibly without RAF churn. */
const TICK_MS = 500;
/** How long the ✓ ALL CLEAR flash stays after the last crisis resolves. */
const ALL_CLEAR_MS = 4_000;

interface TriagePanelProps {
  officeState: OfficeState;
}

/** One-line cause for a burning agent (waitingFor beats local fallbacks). */
function causeFor(officeState: OfficeState, id: number): string | undefined {
  const ch = officeState.characters.get(id);
  if (!ch) return undefined;
  if (ch.pollState?.state === 'blocked' && ch.pollState.waitingFor) {
    return ch.pollState.waitingFor;
  }
  if (ch.bubbleType === 'permission') return 'Needs approval';
  if (ch.bubbleType === 'waiting' && ch.waitingAwaitingInput) return 'Waiting for input';
  return undefined;
}

/**
 * TRIAGE incident board (v1 mechanic #1, the signature element).
 *
 * Docked top-right; auto-appears when ≥1 crisis exists. Rows are live fires
 * (stage silhouette glyph + word + identity + cause + age) and un-acked
 * debris, ordered by age × severity — the top row is always the thing to
 * deal with next. Colorblind hard rule: every signal is SHAPE + TEXT; the
 * board must read fully in grayscale.
 */
export function TriagePanel({ officeState }: TriagePanelProps) {
  const [now, setNow] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const allClearUntilRef = useRef(0);
  const prevCountRef = useRef(0);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const fires = [...officeState.characters.entries()]
    .filter(([, ch]) => ch.crisis && ch.matrixEffect !== 'despawn')
    .map(([id, ch]) => ({
      agentId: id,
      since: ch.crisis!.since,
      identity: officeState.agentIdentity(id),
      cause: causeFor(officeState, id),
    }));
  const rows = buildTriageRows(fires, [...officeState.debris.values()], now);

  // The calm moment: the board flashes ✓ ALL CLEAR when the last row resolves.
  if (prevCountRef.current > 0 && rows.length === 0) {
    allClearUntilRef.current = now + ALL_CLEAR_MS;
  }
  prevCountRef.current = rows.length;

  const showAllClear = rows.length === 0 && now < allClearUntilRef.current;
  if (rows.length === 0 && !showAllClear) return null;

  if (showAllClear) {
    return (
      <div className="absolute top-8 right-8 z-30 triage-panel" data-testid="triage-panel">
        <div className="triage-panel__allclear" data-testid="triage-all-clear">
          ✓ ALL CLEAR
        </div>
      </div>
    );
  }

  if (collapsed) {
    return (
      <button
        className="absolute top-8 right-8 z-30 triage-panel triage-panel__header"
        onClick={() => setCollapsed(false)}
        data-testid="triage-panel-collapsed"
        title="Expand the triage board"
      >
        ⚠ TRIAGE ({rows.length}) ▸
      </button>
    );
  }

  return (
    <div
      className="absolute top-8 right-8 z-30 triage-panel flex flex-col"
      data-testid="triage-panel"
    >
      <button
        className="triage-panel__header text-left"
        onClick={() => setCollapsed(true)}
        title="Collapse the triage board"
      >
        ⚠ TRIAGE — {rows.length} OPEN ▾
      </button>
      <div className="triage-panel__rows">
        {rows.map((row) => (
          <TriageRowView key={row.rowKey} row={row} officeState={officeState} />
        ))}
      </div>
    </div>
  );
}

function TriageRowView({ row, officeState }: { row: TriageRow; officeState: OfficeState }) {
  return (
    <div
      className={`triage-row ${row.loud ? 'triage-row--loud' : ''}`}
      data-testid="triage-row"
      data-kind={row.kind}
      data-stage={row.stage ?? 'debris'}
    >
      <span className="triage-row__stage">
        {row.glyph} {row.word}
      </span>
      <span className="triage-row__identity">{row.identity}</span>
      <span className="triage-row__cause" title={row.cause}>
        {row.cause}
      </span>
      <span className="triage-row__age tabular-nums">{formatAge(row.ageMs)}</span>
      {row.debrisKey && (
        <button
          className="triage-row__clear"
          onClick={() => officeState.acknowledgeDebris(row.debrisKey!)}
          title="Acknowledge — clear this debris"
        >
          CLEAR
        </button>
      )}
    </div>
  );
}
