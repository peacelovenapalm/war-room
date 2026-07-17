import { useEffect, useRef, useState } from 'react';

import { GRAPH_SEARCH_DEBOUNCE_MS, MEMORY_ATTRIBUTION_FEEDBACK_MS } from '../constants';
import {
  type DecisionSearchMatch,
  dedupeMatches,
  formatEdgeLine,
  type GraphNode,
  type GraphSearchResult,
  groupEdgesByHop,
  kindGlyph,
  matchLabel,
  type MemoryAttribution,
  recordMemoryAttribution,
} from '../net/graphFacts';
import { Modal } from './Modal';

export interface GraphSearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

function MatchRow({ node, onTap }: { node: GraphNode; onTap: (id: string) => void }) {
  return (
    <button
      type="button"
      className="graph-search__match"
      data-testid="graph-search-match"
      onClick={() => {
        onTap(node.id);
      }}
    >
      <span className="graph-search__match-glyph">{kindGlyph(node.kind)}</span>
      <span className="graph-search__match-title">{matchLabel(node)}</span>
      <span className="modal__muted">{node.id}</span>
    </button>
  );
}

function ResolvedBlock({ resolved }: { resolved: NonNullable<GraphSearchResult['resolved']> }) {
  const groups = groupEdgesByHop(resolved.edges);
  return (
    <div className="graph-search__resolved" data-testid="graph-search-resolved">
      <div className="graph-search__resolved-head">
        <span className="graph-search__match-glyph">{kindGlyph(resolved.node.kind)}</span>
        <strong>{matchLabel(resolved.node)}</strong>
        <span className="modal__muted">{resolved.node.id}</span>
      </div>
      {groups.map((group) => (
        <div key={group.hop} className="graph-search__hop" data-testid="graph-search-hop-group">
          <div className="modal__muted">[hop {group.hop}]</div>
          {group.edges.map((edge, i) => {
            const line = formatEdgeLine(edge);
            return (
              <div key={i} className="graph-search__edge" data-testid="graph-search-edge">
                <span>{line.text}</span>
                {line.provenance !== undefined && (
                  <span className="modal__muted"> — {line.provenance}</span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function DecisionBlock({ decision }: { decision: DecisionSearchMatch }) {
  return (
    <article className="graph-search__decision" data-testid="graph-search-decision">
      <div className="graph-search__decision-answer">
        <strong>◆ ANSWER — {decision.answer}</strong>
        <span className="modal__muted">topic: {decision.topic}</span>
      </div>
      {decision.stale && (
        <div className="modal__warn" data-testid="graph-search-decision-stale">
          ◷ STALE — older than the decision freshness window
        </div>
      )}
      {decision.contradiction && (
        <div className="modal__warn" data-testid="graph-search-decision-contradiction">
          ⚑ CONTRADICTION — competing answer{decision.competingAnswers.length === 1 ? '' : 's'}:{' '}
          {decision.competingAnswers.join(' · ')}
        </div>
      )}
      <details className="graph-search__receipts">
        <summary>▸ RECEIPTS ({String(decision.receipts.length)})</summary>
        {decision.receipts.map((receipt) => (
          <div key={receipt.receiptId} className="graph-search__receipt">
            <div>
              {receipt.date} · session {receipt.sessionId} · line {String(receipt.lineNumber)}
            </div>
            <div>“{receipt.verbatim}”</div>
            <div className="modal__muted">{receipt.notePath}</div>
          </div>
        ))}
      </details>
    </article>
  );
}

/** GRAPH SEARCH panel (4C, T7 first slice): search the vault knowledge
 *  graph via GET /api/graph/search. Debounced text input, one-tap-real
 *  match rows (tapping re-queries with that node's exact id, which
 *  resolves it), and a DEPTH control that re-runs the current query. The
 *  server's `available: false` (store not mounted on this deployment) is
 *  rendered as an explicit honest line — never an empty-but-plausible
 *  result. */
export function GraphSearchPanel({ isOpen, onClose }: GraphSearchPanelProps) {
  const [query, setQuery] = useState('');
  const [depth, setDepth] = useState<1 | 2>(1);
  const [result, setResult] = useState<GraphSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attributionFeedback, setAttributionFeedback] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeq = useRef(0);
  const hasQuery = query.trim().length > 0;

  // Reset the form on each fresh open — "adjust state while rendering"
  // (react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes),
  // not an effect: mirrors CallModal.tsx's wasOpen pattern.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setQuery('');
      setResult(null);
      setError(false);
      setLoading(false);
      setDepth(1);
      setAttributionFeedback(null);
    }
  }

  useEffect(() => {
    if (!isOpen || !hasQuery) return;
    const seq = ++requestSeq.current;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const run = async () => {
        setLoading(true);
        try {
          const res = await fetch(
            `/api/graph/search?q=${encodeURIComponent(query)}&depth=${String(depth)}`,
          );
          if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
          const data = (await res.json()) as GraphSearchResult;
          if (requestSeq.current === seq) {
            setResult(data);
            setError(false);
            setLoading(false);
          }
        } catch {
          if (requestSeq.current === seq) {
            setError(true);
            setLoading(false);
          }
        }
      };
      void run();
    }, GRAPH_SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [isOpen, hasQuery, query, depth]);

  useEffect(
    () => () => {
      if (feedbackRef.current) clearTimeout(feedbackRef.current);
    },
    [],
  );

  const attribute = (value: MemoryAttribution) => {
    void recordMemoryAttribution(value).then((ok) => {
      setAttributionFeedback(
        ok
          ? value === 'graph-answered'
            ? '✓ RECORDED — graph answered'
            : '↺ RECORDED — had to re-derive'
          : '⚠ NOT RECORDED — tap to retry',
      );
      if (feedbackRef.current) clearTimeout(feedbackRef.current);
      feedbackRef.current = setTimeout(
        () => setAttributionFeedback(null),
        MEMORY_ATTRIBUTION_FEEDBACK_MS,
      );
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="GRAPH SEARCH" testId="graph-search-panel">
      <div className="graph-search__controls">
        <input
          type="text"
          className="graph-search__input"
          data-testid="graph-search-input"
          placeholder="Search the vault knowledge graph…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
        />
        <div className="graph-search__depth" data-testid="graph-search-depth">
          {([1, 2] as const).map((d) => {
            const active = depth === d;
            return (
              <button
                key={d}
                type="button"
                className={active ? 'verb verb--active' : 'verb'}
                data-testid={`graph-search-depth-${String(d)}`}
                aria-pressed={active}
                onClick={() => {
                  setDepth(d);
                }}
              >
                {/* Shape+word active signal (colorblind hard rule) — the
                    ACTIVE depth must read as visibly selected, not merely
                    disabled/dimmed (panel finding M7: the old `disabled`
                    styling made the selected button read as the OFF one). */}
                {active ? '●' : '○'} DEPTH {d}
              </button>
            );
          })}
        </div>
      </div>

      {!hasQuery && (
        <div className="modal__muted" data-testid="graph-search-hint">
          Type to search the vault knowledge graph.
        </div>
      )}

      {hasQuery && error && <div className="modal__warn">⚠ unable to reach /api/graph/search</div>}

      {hasQuery && loading && (
        <div className="modal__muted" data-testid="graph-search-loading">
          … SEARCHING
        </div>
      )}

      {hasQuery && !loading && result && !result.available && (
        <div className="modal__warn" data-testid="graph-search-unavailable">
          ⊘ NO GRAPH — store not mounted on this deployment
        </div>
      )}

      {hasQuery && !loading && result?.decisions?.available && (
        <section className="graph-search__decisions" data-testid="graph-search-decisions">
          <div className="graph-search__lane-label">◆ DECISIONS — ANSWER FIRST</div>
          {result.decisions.matches.length === 0 ? (
            <div className="modal__muted">no decision receipts</div>
          ) : (
            result.decisions.matches.map((decision) => (
              <DecisionBlock key={decision.topic} decision={decision} />
            ))
          )}
        </section>
      )}

      {hasQuery && !loading && result && !result.decisions?.available && (
        <div className="modal__warn" data-testid="graph-search-decisions-unavailable">
          ⊘ NO MEMORY — WAR_ROOM_VAULT_DIR not configured
        </div>
      )}

      {hasQuery && !loading && result && result.available && (
        <>
          {(() => {
            const dedupedMatches = dedupeMatches(result.matches, result.resolved?.node.id);
            return (
              <>
                {dedupedMatches.length === 0 && result.resolved === undefined && (
                  <div className="modal__muted">no matches</div>
                )}
                {dedupedMatches.length > 0 && (
                  <div className="graph-search__matches" data-testid="graph-search-matches">
                    {dedupedMatches.map((node) => (
                      <MatchRow
                        key={node.id}
                        node={node}
                        onTap={(id) => {
                          setQuery(id);
                        }}
                      />
                    ))}
                  </div>
                )}
              </>
            );
          })()}
          {result.resolved !== undefined && <ResolvedBlock resolved={result.resolved} />}
        </>
      )}

      {hasQuery && !loading && result && (
        <div className="graph-search__attribution" data-testid="graph-search-attribution">
          <span className="modal__muted">DID THIS SETTLE IT?</span>
          <button
            type="button"
            className="verb"
            onClick={() => {
              attribute('graph-answered');
            }}
          >
            ✓ THIS ANSWERED IT
          </button>
          <button
            type="button"
            className="verb"
            onClick={() => {
              attribute('rederived');
            }}
          >
            ↺ HAD TO RE-DERIVE
          </button>
          {attributionFeedback && <span>{attributionFeedback}</span>}
        </div>
      )}
    </Modal>
  );
}
