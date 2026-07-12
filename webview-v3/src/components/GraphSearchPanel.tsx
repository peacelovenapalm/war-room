import { useEffect, useRef, useState } from 'react';

import {
  formatEdgeLine,
  type GraphNode,
  type GraphSearchResult,
  groupEdgesByHop,
  kindGlyph,
  matchLabel,
} from '../net/graphFacts';
import { Modal } from './Modal';

const DEBOUNCE_MS = 300;

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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [isOpen, hasQuery, query, depth]);

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
          {([1, 2] as const).map((d) => (
            <button
              key={d}
              type="button"
              className="verb"
              data-testid={`graph-search-depth-${String(d)}`}
              aria-pressed={depth === d}
              disabled={depth === d}
              onClick={() => {
                setDepth(d);
              }}
            >
              DEPTH {d}
            </button>
          ))}
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

      {hasQuery && !loading && result && result.available && (
        <>
          {result.matches.length === 0 && result.resolved === undefined && (
            <div className="modal__muted">no matches</div>
          )}
          {result.matches.length > 0 && (
            <div className="graph-search__matches" data-testid="graph-search-matches">
              {result.matches.map((node) => (
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
          {result.resolved !== undefined && <ResolvedBlock resolved={result.resolved} />}
        </>
      )}
    </Modal>
  );
}
