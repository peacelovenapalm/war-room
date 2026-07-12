/**
 * Knowledge-graph provider tests (4C, T7 first slice) — the JSONL port of
 * vault/scripts/graph_query.py: tolerant load, substring search, exact
 * resolution (id/title/stem/:suffix), depth-bounded neighbor sweep, and the
 * honest available:false posture when the mount is absent.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearGraphCache, GRAPH_SEARCH_MAX_MATCHES, searchGraph } from '../src/graphProvider.js';

let tmpDir: string;
const savedEnv = process.env['WAR_ROOM_GRAPH_DIR'];

function writeStore(nodes: object[], edges: object[]): void {
  fs.writeFileSync(
    path.join(tmpDir, 'nodes.jsonl'),
    nodes.map((n) => JSON.stringify(n)).join('\n'),
  );
  fs.writeFileSync(
    path.join(tmpDir, 'edges.jsonl'),
    edges.map((e) => JSON.stringify(e)).join('\n'),
  );
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-provider-'));
  process.env['WAR_ROOM_GRAPH_DIR'] = tmpDir;
  clearGraphCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (savedEnv === undefined) delete process.env['WAR_ROOM_GRAPH_DIR'];
  else process.env['WAR_ROOM_GRAPH_DIR'] = savedEnv;
  clearGraphCache();
});

const NODES = [
  { id: 'note:Maps/TWE MOC', kind: 'note', title: 'TWE MOC', path: 'Maps/TWE MOC.md' },
  { id: 'project:twe', kind: 'project', title: 'TWE' },
  { id: 'note:Home', kind: 'note', title: 'Home', path: 'Home.md' },
  { id: 'stub:orphan', kind: 'stub', title: 'orphan' },
];
const EDGES = [
  {
    src: 'note:Home',
    dst: 'note:Maps/TWE MOC',
    type: 'links_to',
    form: 'DER',
    provenance: 'Home.md#body',
  },
  {
    src: 'note:Maps/TWE MOC',
    dst: 'project:twe',
    type: 'describes',
    form: 'FM',
    provenance: 'frontmatter',
  },
];

describe('searchGraph', () => {
  it('missing env → available:false, never a throw', () => {
    delete process.env['WAR_ROOM_GRAPH_DIR'];
    clearGraphCache();
    expect(searchGraph('twe')).toEqual({ available: false, query: 'twe', matches: [] });
  });

  it('missing files under a set env → available:false (honest, no 500 path)', () => {
    // dir exists but has no jsonl files
    expect(searchGraph('twe').available).toBe(false);
  });

  it('substring search matches id and title case-insensitively, capped', () => {
    writeStore(NODES, EDGES);
    const result = searchGraph('twe');
    expect(result.available).toBe(true);
    expect(result.matches.map((m) => m.id).sort()).toEqual(['note:Maps/TWE MOC', 'project:twe']);

    const many = Array.from({ length: GRAPH_SEARCH_MAX_MATCHES + 10 }, (_, i) => ({
      id: `note:bulk-${String(i)}`,
      title: `bulk ${String(i)}`,
    }));
    writeStore(many, []);
    clearGraphCache();
    expect(searchGraph('bulk').matches).toHaveLength(GRAPH_SEARCH_MAX_MATCHES);
  });

  it('exact resolution (title / stem / :suffix) returns 1-hop neighbor edges both directions', () => {
    writeStore(NODES, EDGES);
    const result = searchGraph('TWE MOC'); // exact title match
    expect(result.resolved?.node.id).toBe('note:Maps/TWE MOC');
    // Both the inbound links_to and the outbound describes, hop 1.
    expect(result.resolved?.edges.map((e) => `${e.src}>${e.dst}@${String(e.hop)}`).sort()).toEqual([
      'note:Home>note:Maps/TWE MOC@1',
      'note:Maps/TWE MOC>project:twe@1',
    ]);
  });

  it('depth 2 sweeps a second hop; ambiguous names resolve to nothing', () => {
    writeStore(NODES, EDGES);
    const deep = searchGraph('Home', 2);
    expect(deep.resolved?.node.id).toBe('note:Home');
    expect(deep.resolved?.edges.some((e) => e.hop === 2)).toBe(true);

    // Two nodes titled the same → ambiguous → matches only, no resolved.
    writeStore(
      [
        { id: 'note:A', title: 'same' },
        { id: 'note:B', title: 'same' },
      ],
      [],
    );
    clearGraphCache();
    expect(searchGraph('same').resolved).toBeUndefined();
  });

  it('tolerates corrupt jsonl lines (skips them, keeps the rest)', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'nodes.jsonl'),
      `${JSON.stringify(NODES[0])}\nnot json at all\n${JSON.stringify(NODES[1])}`,
    );
    fs.writeFileSync(path.join(tmpDir, 'edges.jsonl'), 'also not json');
    const result = searchGraph('twe');
    expect(result.available).toBe(true);
    expect(result.matches).toHaveLength(2);
  });
});
