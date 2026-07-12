/**
 * Pure logic for the GRAPH SEARCH panel (4C, T7 first slice) — kept
 * separate from GraphSearchPanel.tsx so the kind→glyph mapping, edge line
 * formatting, and hop-grouping are independently unit-testable without
 * rendering. Types mirror server/src/graphProvider.ts's shapes exactly
 * (same duplication discipline as state/opsReview.ts — never imported
 * across the client/server boundary).
 */

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
  available: boolean;
  query: string;
  matches: GraphNode[];
  resolved?: { node: GraphNode; edges: GraphNeighborEdge[] };
}

/** Colorblind hard rule: shape is the primary signal, never color alone.
 *  Unknown/absent kind falls back to a plain middle-dot. */
export function kindGlyph(kind: string | undefined): string {
  switch (kind) {
    case 'note':
      return '▤';
    case 'project':
      return '◆';
    case 'mirror':
      return '▣';
    case 'stub':
      return '○';
    default:
      return '·';
  }
}

/** A match row's display label — title, falling back to the raw id when no
 *  title is present (never a blank row). */
export function matchLabel(node: GraphNode): string {
  return node.title !== undefined && node.title.length > 0 ? node.title : node.id;
}

/** One resolved-edge line, mirroring the vault CLI's own `src -type-> dst`
 *  output format. Provenance is returned separately (never concatenated)
 *  so the caller can render it dimmed. */
export function formatEdgeLine(edge: GraphEdge): { text: string; provenance?: string } {
  return {
    text: `${edge.src} -${edge.type}-> ${edge.dst}`,
    provenance: edge.provenance,
  };
}

export interface HopGroup {
  hop: number;
  edges: GraphNeighborEdge[];
}

/** Groups resolved edges by hop distance, ascending — `[hop 1]` before
 *  `[hop 2]` etc., preserving each hop's original edge order. */
export function groupEdgesByHop(edges: GraphNeighborEdge[]): HopGroup[] {
  const byHop = new Map<number, GraphNeighborEdge[]>();
  for (const edge of edges) {
    const bucket = byHop.get(edge.hop);
    if (bucket) bucket.push(edge);
    else byHop.set(edge.hop, [edge]);
  }
  return [...byHop.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hop, hopEdges]) => ({ hop, edges: hopEdges }));
}
