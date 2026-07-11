import { useEffect, useState } from 'react';

import { type OpsFinding, type OpsReview, SEVERITY_GLYPHS } from '../state/opsReview';
import { Modal } from './Modal';

const REFRESH_INTERVAL_MS = 60_000;

export interface OpsReviewPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

function FindingRow({ finding }: { finding: OpsFinding }) {
  const [expanded, setExpanded] = useState(false);
  const { glyph, word } = SEVERITY_GLYPHS[finding.severity];
  return (
    <div
      className={`ops-finding ops-finding--${finding.severity}`}
      data-testid="ops-finding"
      data-severity={finding.severity}
    >
      <button
        type="button"
        className="ops-finding__head"
        data-testid="ops-finding-toggle"
        onClick={() => {
          setExpanded((e) => !e);
        }}
      >
        <span className="ops-finding__severity">
          {glyph} {word}
        </span>
        <span className="ops-finding__summary">{finding.summary}</span>
      </button>
      {expanded && (
        <div className="ops-finding__body" data-testid="ops-finding-detail">
          <p className="ops-finding__detail">{finding.detail}</p>
          {finding.receipts.length > 0 && (
            <ul className="ops-finding__receipts" data-testid="ops-finding-receipts">
              {finding.receipts.map((r, i) => (
                <li key={i}>
                  <strong>{r.label}:</strong> {r.value}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** OPS REVIEW panel (T3 self-healing ladder, RUNG 1): a read-only Ops
 *  Advisor findings list — GET /api/ops/review on open + every 60s while
 *  open (matches the server's own cache TTL, so a refresh mid-window is
 *  usually free). Every finding cites its raw receipts, expandable per
 *  row (one-tap-real) — this panel never acts, gates, or spawns anything.
 */
export function OpsReviewPanel({ isOpen, onClose }: OpsReviewPanelProps) {
  const [review, setReview] = useState<OpsReview | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/ops/review');
        if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
        const data = (await res.json()) as OpsReview;
        if (!cancelled) {
          setReview(data);
          setError(false);
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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="OPS REVIEW" testId="ops-review-panel">
      {error && !review && <div className="modal__warn">⚠ unable to reach /api/ops/review</div>}
      {review && (
        <div className="ops-findings" data-testid="ops-findings">
          {review.findings.map((f) => (
            <FindingRow key={f.id} finding={f} />
          ))}
        </div>
      )}
      <p className="modal__footnote">
        Read-only observations over existing telemetry — waste and stale-telemetry patterns, each
        citing the raw events behind it. Never acts, gates, or spawns anything.
      </p>
    </Modal>
  );
}
