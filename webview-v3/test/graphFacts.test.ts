import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatEdgeLine,
  type GraphEdge,
  type GraphNeighborEdge,
  type GraphNode,
  groupEdgesByHop,
  kindGlyph,
  matchLabel,
  recordMemoryAttribution,
} from '../src/net/graphFacts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('kindGlyph — colorblind shape-primary mapping', () => {
  it('maps each known kind to its distinct shape', () => {
    expect(kindGlyph('note')).toBe('▤');
    expect(kindGlyph('project')).toBe('◆');
    expect(kindGlyph('mirror')).toBe('▣');
    expect(kindGlyph('stub')).toBe('○');
  });

  it('falls back to a plain dot for unknown or absent kinds — never blank', () => {
    expect(kindGlyph('something-else')).toBe('·');
    expect(kindGlyph(undefined)).toBe('·');
  });
});

describe('matchLabel', () => {
  it('prefers the title when present', () => {
    const node: GraphNode = { id: 'n1', title: 'My Note' };
    expect(matchLabel(node)).toBe('My Note');
  });

  it('falls back to the raw id when title is absent or empty', () => {
    expect(matchLabel({ id: 'n1' })).toBe('n1');
    expect(matchLabel({ id: 'n1', title: '' })).toBe('n1');
  });
});

describe('formatEdgeLine', () => {
  it('renders the vault CLI style "src -type-> dst" and returns provenance separately', () => {
    const edge: GraphEdge = { src: 'a', dst: 'b', type: 'links', provenance: 'inline-link' };
    expect(formatEdgeLine(edge)).toEqual({ text: 'a -links-> b', provenance: 'inline-link' });
  });

  it('omits provenance when the edge carries none', () => {
    const edge: GraphEdge = { src: 'a', dst: 'b', type: 'links' };
    expect(formatEdgeLine(edge)).toEqual({ text: 'a -links-> b', provenance: undefined });
  });
});

describe('groupEdgesByHop', () => {
  it('groups edges by hop distance, sorted ascending, preserving per-hop order', () => {
    const edges: GraphNeighborEdge[] = [
      { src: 'a', dst: 'b', type: 'links', hop: 2 },
      { src: 'a', dst: 'c', type: 'links', hop: 1 },
      { src: 'c', dst: 'd', type: 'links', hop: 1 },
    ];
    expect(groupEdgesByHop(edges)).toEqual([
      {
        hop: 1,
        edges: [
          { src: 'a', dst: 'c', type: 'links', hop: 1 },
          { src: 'c', dst: 'd', type: 'links', hop: 1 },
        ],
      },
      { hop: 2, edges: [{ src: 'a', dst: 'b', type: 'links', hop: 2 }] },
    ]);
  });

  it('returns an empty array for no edges', () => {
    expect(groupEdgesByHop([])).toEqual([]);
  });
});

describe('recordMemoryAttribution', () => {
  it('posts the closed attribution value to the tally endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    expect(await recordMemoryAttribution('graph-answered')).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/memory/tally', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attribution: 'graph-answered' }),
    });
  });

  it('returns false on a rejected or unreachable tally', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect(await recordMemoryAttribution('rederived')).toBe(false);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await recordMemoryAttribution('rederived')).toBe(false);
  });
});
