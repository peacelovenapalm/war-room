/**
 * Knowledge-graph provider (v4 Phase 4C — T7 first slice).
 *
 * Reads the Brain2 vault's Phase-9 graph store (`_meta/graph/nodes.jsonl` +
 * `edges.jsonl`) from WAR_ROOM_GRAPH_DIR — a read-only docker mount on
 * NEXUS (see .planning/runbooks/nexus-war-room-deploy.sh), the same
 * env-var + tolerant-read + 60s-TTL discipline as briefingProvider.ts.
 *
 * The store is plain JSONL (one JSON object per line), so the query logic
 * from vault/scripts/graph_query.py ports directly — no python, no
 * subprocess, no new runtime dependency. Missing/unreadable store →
 * `available: false`, one ⚠ log line, never a throw (a deployment without
 * the mount is honestly graph-less, same posture as a missing todo dir).
 *
 * Freshness caveat (deliberate, documented): the NEXUS vault clone is
 * hard-reset to origin on a cron — the graph is as current as the last
 * committed graph_build.py run, not live.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface GraphNode {
  id: string;
  kind?: string;
  title?: string;
  path?: string;
  type?: string;
  layer?: string;
  project?: string;
  status?: string;
}

export interface GraphEdge {
  src: string;
  dst: string;
  type: string;
  form?: string;
  provenance?: string;
  confidence?: number;
  seen?: string;
}

export interface GraphNeighborEdge extends GraphEdge {
  /** 1-based hop distance from the resolved node. */
  hop: number;
}

export interface GraphSearchResult {
  /** false when the store isn't mounted/readable — the UI renders an
   *  honest "NO GRAPH" state, never an empty-but-plausible result. */
  available: boolean;
  query: string;
  /** Substring matches (id/title/path-stem, case-insensitive), capped. */
  matches: GraphNode[];
  /** Set only when the query resolved to exactly ONE node (python
   *  find_node discipline: exact id/title/stem/`:suffix` match). */
  resolved?: { node: GraphNode; edges: GraphNeighborEdge[] };
}

const CACHE_TTL_MS = 60_000;
export const GRAPH_SEARCH_MAX_MATCHES = 20;
export const GRAPH_NEIGHBOR_MAX_DEPTH = 3;
/** Neighbor-edge cap per response — the board prop renders a list, not a
 *  full graph dump (569 edges today, but never trust a store size). */
export const GRAPH_NEIGHBOR_MAX_EDGES = 200;

interface GraphStore {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
}

let cache: { at: number; store: GraphStore | null } | null = null;

function readJsonl<T>(file: string): T[] {
  const out: T[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // One corrupt line never poisons the store — skip it (tolerant, same
      // posture as briefingProvider's per-file tolerance).
    }
  }
  return out;
}

function loadStore(now: number): GraphStore | null {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.store;
  const dir = process.env['WAR_ROOM_GRAPH_DIR'];
  let store: GraphStore | null = null;
  if (!dir) {
    console.log('[Graph] ⚠ WAR_ROOM_GRAPH_DIR not set -- graph search disabled');
  } else {
    try {
      const nodes = new Map<string, GraphNode>();
      for (const n of readJsonl<GraphNode>(path.join(dir, 'nodes.jsonl'))) {
        if (typeof n.id === 'string' && n.id.length > 0) nodes.set(n.id, n);
      }
      const edges = readJsonl<GraphEdge>(path.join(dir, 'edges.jsonl')).filter(
        (e) => typeof e.src === 'string' && typeof e.dst === 'string' && typeof e.type === 'string',
      );
      store = { nodes, edges };
    } catch (err) {
      console.log(`[Graph] ⚠ graph store unreadable at ${dir}: ${String(err)}`);
      store = null;
    }
  }
  cache = { at: now, store };
  return store;
}

/** Test-only: force the next query to re-read the store. */
export function clearGraphCache(): void {
  cache = null;
}

function stem(p: string | undefined): string {
  if (!p) return '';
  const base = p.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/** Exact-resolution port of graph_query.py find_node (id, title, stem,
 *  `:suffix` — all case-insensitive). Returns the node id ONLY when the
 *  match is unambiguous. */
function resolveNode(store: GraphStore, name: string): string | undefined {
  if (store.nodes.has(name)) return name;
  const low = name.toLowerCase();
  const hits: string[] = [];
  for (const [nid, n] of store.nodes) {
    if (
      low === nid.toLowerCase() ||
      low === String(n.title ?? '').toLowerCase() ||
      low === stem(n.path).toLowerCase() ||
      nid.toLowerCase().endsWith(':' + low)
    ) {
      hits.push(nid);
    }
  }
  return hits.length === 1 ? hits[0] : undefined;
}

/** Depth-bounded frontier sweep, ported from graph_query.py cmd_neighbors
 *  (direction 'both'). */
function neighborEdges(store: GraphStore, start: string, depth: number): GraphNeighborEdge[] {
  const out: GraphNeighborEdge[] = [];
  let frontier = new Set([start]);
  const seen = new Set([start]);
  for (let hop = 1; hop <= depth; hop++) {
    const next = new Set<string>();
    for (const e of store.edges) {
      if (out.length >= GRAPH_NEIGHBOR_MAX_EDGES) return out;
      if (frontier.has(e.src)) {
        out.push({ ...e, hop });
        next.add(e.dst);
      } else if (frontier.has(e.dst)) {
        out.push({ ...e, hop });
        next.add(e.src);
      }
    }
    frontier = new Set([...next].filter((n) => !seen.has(n)));
    for (const n of next) seen.add(n);
    if (frontier.size === 0) break;
  }
  return out;
}

/** Search the graph: substring matches + (when unambiguous) 1..depth-hop
 *  neighbor edges. Pure read — no state beyond the TTL cache. */
export function searchGraph(query: string, depth = 1, now: number = Date.now()): GraphSearchResult {
  const store = loadStore(now);
  const q = query.trim();
  if (!store) return { available: false, query: q, matches: [] };
  if (q === '') return { available: true, query: q, matches: [] };

  const low = q.toLowerCase();
  const matches: GraphNode[] = [];
  for (const n of store.nodes.values()) {
    if (matches.length >= GRAPH_SEARCH_MAX_MATCHES) break;
    if (
      n.id.toLowerCase().includes(low) ||
      String(n.title ?? '')
        .toLowerCase()
        .includes(low)
    ) {
      matches.push(n);
    }
  }

  const boundedDepth = Math.min(Math.max(1, Math.trunc(depth)), GRAPH_NEIGHBOR_MAX_DEPTH);
  const resolvedId = resolveNode(store, q);
  const resolved =
    resolvedId !== undefined
      ? {
          node: store.nodes.get(resolvedId) as GraphNode,
          edges: neighborEdges(store, resolvedId, boundedDepth),
        }
      : undefined;

  return { available: true, query: q, matches, resolved };
}
