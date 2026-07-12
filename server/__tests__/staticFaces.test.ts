/**
 * Static face routing tests (face-merge Tier 3, FACE-MERGE-PLAN.md).
 *
 * The cutover swaps which build serves at root: v3 "Living Studio" is the
 * root face, the old v1 face survives at /v1/ for one grace release, and
 * every old /v3 URL 301s to its root equivalent WITH the query string
 * intact (phone bookmarks + push-notification deep links like
 * /v3/?agentId=5). This seam has no other coverage — a silent mistake here
 * serves the wrong face at root or strands every existing bookmark.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

const { PixelAgentsServer } = await import('../src/server.js');
const { AgentStateStore } = await import('../src/agentStateStore.js');

describe('face-merge static routing', () => {
  let server: InstanceType<typeof PixelAgentsServer> | undefined;
  let rootFaceDir: string;
  let legacyFaceDir: string;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-static-faces-'));
    fs.mkdirSync(path.join(tmpBase, '.pixel-agents'), { recursive: true });
    // Marker index.html files — distinct content proves WHICH face served.
    rootFaceDir = path.join(tmpBase, 'dist-v3');
    legacyFaceDir = path.join(tmpBase, 'dist-legacy');
    fs.mkdirSync(rootFaceDir, { recursive: true });
    fs.mkdirSync(legacyFaceDir, { recursive: true });
    fs.writeFileSync(path.join(rootFaceDir, 'index.html'), `V3-FACE ${crypto.randomUUID()}`);
    fs.writeFileSync(path.join(legacyFaceDir, 'index.html'), 'LEGACY-FACE');
    server = new PixelAgentsServer();
  });

  afterEach(() => {
    server?.stop();
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  async function startServer(withLegacy: boolean): Promise<number> {
    const config = await server!.start({
      embedded: false,
      store: new AgentStateStore(),
      staticDir: rootFaceDir,
      ...(withLegacy ? { staticDirLegacy: legacyFaceDir } : {}),
    });
    return config.port;
  }

  it('serves the v3 face at root, incl. SPA history fallback for unknown paths', async () => {
    const port = await startServer(true);
    const root = await fetch(`http://127.0.0.1:${String(port)}/`);
    expect(root.status).toBe(200);
    expect(await root.text()).toContain('V3-FACE');
    const deep = await fetch(`http://127.0.0.1:${String(port)}/some/spa/route`);
    expect(await deep.text()).toContain('V3-FACE');
  });

  it('serves the legacy face at /v1/ with its own SPA fallback', async () => {
    const port = await startServer(true);
    const v1 = await fetch(`http://127.0.0.1:${String(port)}/v1/`);
    expect(await v1.text()).toContain('LEGACY-FACE');
    const v1deep = await fetch(`http://127.0.0.1:${String(port)}/v1/some/route`);
    expect(await v1deep.text()).toContain('LEGACY-FACE');
  });

  it('301s every old /v3 URL to the root equivalent, preserving the query string', async () => {
    const port = await startServer(true);
    const cases: Array<[string, string]> = [
      ['/v3', '/'],
      ['/v3/', '/'],
      ['/v3?x=1', '/?x=1'],
      ['/v3/?agentId=5', '/?agentId=5'],
      ['/v3/deep/route?open=agent&id=2', '/deep/route?open=agent&id=2'],
      // P6 codex review finding #1: extra slashes must NEVER yield a
      // protocol-relative '//host' Location (open redirect off-tailnet).
      ['/v3//evil.example/path?x=1', '/evil.example/path?x=1'],
      ['/v3///evil.example', '/evil.example'],
    ];
    for (const [from, to] of cases) {
      const res = await fetch(`http://127.0.0.1:${String(port)}${from}`, {
        redirect: 'manual',
      });
      expect(res.status, from).toBe(301);
      expect(res.headers.get('location'), from).toBe(to);
    }
  });

  it('without a legacy dir, /v1/ falls through to the root SPA fallback (no crash)', async () => {
    const port = await startServer(false);
    const res = await fetch(`http://127.0.0.1:${String(port)}/v1/anything`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('V3-FACE');
  });
});
