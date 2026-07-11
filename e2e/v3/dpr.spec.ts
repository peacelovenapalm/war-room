import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

import { type Browser, expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { WebSocketServer } from 'ws';

/**
 * PERMANENT DPR-3 regression e2e — KICKOFF-v3.1 Milestone 1 ("DPR done
 * right"), MOBILE-FORENSICS constraint 4 made a standing gate.
 *
 * Serves the BUILT webview-v3 bundle over plain HTTP, renders it in
 * Playwright WebKit at a 390x664 CSS viewport with deviceScaleFactor 3
 * (the real-iPhone proxy that caught the v2 blank canvas), and asserts:
 *   1. non-blank canvas CONTENT via pixel sampling (not just element
 *      presence — a sized-but-empty canvas was the v2 failure mode);
 *   2. the backing store is capped at 2x CSS size (resolution cap), while
 *      at DSF 1 it is exactly 1x;
 *   3. camera framing is IDENTICAL at DSF 1 and DSF 3 for the same CSS
 *      viewport — zoom derived from DPR (the root cause, twice, in v2)
 *      fails this immediately.
 *
 * Modeled on .planning/v2/forensics/mobile-forensics.spec.ts (host-spawn +
 * dense-grid canvas sampler). Instead of spawning dist/cli.js (which serves
 * the frozen webview-ui, not webview-v3), the static host carries a
 * scripted mock `/ws` speaking the real core/asyncapi.yaml protocol —
 * the same mock-not-real-Claude pattern the existing e2e suite uses. It
 * replies to webviewReady with existingAgents + agentCreated + agentStatus
 * so real-agent desk occupancy is asserted, not just the empty floor.
 */

/** Scripted server messages (shapes from core/src/messages.ts). */
const MOCK_SERVER_SCRIPT: object[] = [
  {
    type: 'existingAgents',
    agents: [1, 2],
    agentMeta: {},
    folderNames: { '1': 'war-room', '2': 'turffinder' },
    externalAgents: {},
    machines: { '1': 'MACBOOK', '2': 'MACBOOK' },
    providers: { '1': 'claude', '2': 'claude' },
    sessionIds: { '2': 'sess-e2e-2' },
    cwds: { '2': '/Users/greg/code/turffinder' },
    pids: { '2': 4242 },
  },
  { type: 'agentCreated', id: 3, folderName: 'brain2-vault', machine: 'NEXUS' },
  { type: 'agentStatus', id: 1, status: 'active' },
  { type: 'agentStatus', id: 3, status: 'waiting', awaitingInput: true },
  // Poll-driven blocked crisis, 150s old → a ▲ FIRE row on the triage board
  // (stage thresholds: fire at 90s, alarm at 240s).
  {
    type: 'agentPollState',
    id: 2,
    state: 'blocked',
    waitingFor: 'Approve: apply migration 0042? (y/n)',
    ageMs: 150_000,
  },
  { type: 'agentTokenUsage', id: 2, inputTokens: 12_345, outputTokens: 678 },
];
const MOCK_AGENT_COUNT = 3;
/** id1 WORKING · id2 poll-blocked + id3 awaitingInput NEEDS INPUT · none down. */
const EXPECTED_TALLY = '◉ 3 · ▶ 1 · ⚠ 2 · ✗ 0';
/** Chunks replayed by the mock when a client subscribes to agent 2's tail. */
const MOCK_TAIL_CHUNKS = ['● Bash(npm test)\n', 'Running 46 tests…\n'];

interface AssetStoreStatsLike {
  manifestState: 'idle' | 'loading' | 'ready' | 'failed';
  chunksLoaded: number;
  chunksTotal: number | null;
  spritesKnown: number;
}

declare global {
  interface Window {
    /** Installed by webview-v3/src/testHooks.ts under the e2e flag. */
    __warRoomV3TestHooks?: {
      getRenderCount: () => number;
      getAgentCount: () => number;
      getResolution: () => number;
      getCameraState: () => { zoom: number; offsetX: number; offsetY: number } | null;
      getAssetStats: () => {
        props: AssetStoreStatsLike;
        characters: AssetStoreStatsLike;
        images: AssetStoreStatsLike;
      };
    };
  }
}

const REPO_ROOT = path.resolve(__dirname, '../..');
const V3_DIST = path.join(REPO_ROOT, 'dist', 'webview-v3');
const SCREENSHOT_DIR = path.join(REPO_ROOT, 'test-results', 'e2e-v3', 'screenshots');
const VIEWPORT = { width: 390, height: 664 };

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate a free port'));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

interface StaticHost {
  url: string;
  close: () => Promise<void>;
}

/** Minimal static file server over webview-v3/dist (base './' bundle). */
async function serveV3Dist(): Promise<StaticHost> {
  if (!fs.existsSync(path.join(V3_DIST, 'index.html'))) {
    throw new Error(
      `webview-v3 not built at ${V3_DIST}. Run 'npm run build:webview-v3' first (npm run e2e:v3-dpr does).`,
    );
  }
  const port = await getFreePort();
  const server = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      return;
    }
    const requestPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    const resolved = path.normalize(path.join(V3_DIST, relative));
    if (!resolved.startsWith(V3_DIST + path.sep) && resolved !== path.join(V3_DIST, 'index.html')) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.readFile(resolved, (error, data) => {
      if (error) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(resolved)] ?? 'application/octet-stream',
      });
      res.end(data);
    });
  });
  // Mock server plane on the same origin the app dials (`/ws`): replies to
  // webviewReady with the scripted real-protocol messages above.
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket) => {
    socket.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as {
          type?: string;
          source?: string;
          id?: string;
        };
        if (message.type === 'webviewReady') {
          for (const serverMessage of MOCK_SERVER_SCRIPT) {
            socket.send(JSON.stringify(serverMessage));
          }
        }
        // Streaming plane: replay agent 2's retained tail on subscribe (the
        // same replay semantics as server/src/clientMessageHandler.ts).
        if (message.type === 'tailSubscribe' && message.source === 'agent' && message.id === '2') {
          MOCK_TAIL_CHUNKS.forEach((chunk, seq) => {
            socket.send(
              JSON.stringify({
                type: 'outputChunk',
                source: 'agent',
                id: '2',
                seq,
                stream: 'transcript',
                chunk,
                truncated: false,
              }),
            );
          });
        }
      } catch {
        // Ignore non-JSON frames.
      }
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${String(port)}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }),
  };
}

/** Dense-grid canvas content sampler (same method as the v2 forensics probe
 *  and disappearing-view.spec.ts): screenshot the canvas element, sample a
 *  16x16 grid, count distinct RGBA values. A blank canvas has exactly 1. */
function sampleDistinctColors(buffer: Buffer): number {
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;
  const GRID = 16;
  const colors = new Set<string>();
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const x = Math.min(width - 1, Math.floor((width * (gx + 0.5)) / GRID));
      const y = Math.min(height - 1, Math.floor((height * (gy + 0.5)) / GRID));
      const idx = (width * y + x) * 4;
      colors.add(
        `${String(data[idx])},${String(data[idx + 1])},${String(data[idx + 2])},${String(data[idx + 3])}`,
      );
    }
  }
  return colors.size;
}

interface RunResult {
  deviceScaleFactor: number;
  pageDpr: number;
  distinctColors: number;
  cssWidth: number;
  cssHeight: number;
  backingWidth: number;
  backingHeight: number;
  resolution: number;
  camera: { zoom: number; offsetX: number; offsetY: number };
  agentCount: number;
  /** Real WS-B sprite sheets that actually decoded (KICKOFF-v3.1 "wire real
   *  sprites in") — chunksLoaded > 0, not just the placeholder fallback. */
  propSheetsLoaded: number;
  characterSheetsLoaded: number;
}

async function runAtDsf(
  browser: Browser,
  hostUrl: string,
  deviceScaleFactor: number,
): Promise<RunResult> {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    (window as unknown as { __PIXEL_AGENTS_E2E?: boolean }).__PIXEL_AGENTS_E2E = true;
  });
  await page.goto(`${hostUrl}/`);

  const canvas = page.locator('[data-testid="iso-canvas"]');
  await expect(canvas).toBeVisible({ timeout: 20_000 });

  // Wait for a real paint, not a timeout: the app bumps renderCount after
  // each renderWorld pass (test hooks are e2e-gated in webview-v3/src).
  await expect
    .poll(() => page.evaluate(() => window.__warRoomV3TestHooks?.getRenderCount() ?? 0), {
      timeout: 20_000,
    })
    .toBeGreaterThanOrEqual(1);

  // Live agents over the mock WS: webviewReady -> existingAgents(2) +
  // agentCreated(1) must land as 3 occupied placeholder desks.
  await expect
    .poll(() => page.evaluate(() => window.__warRoomV3TestHooks?.getAgentCount() ?? 0), {
      timeout: 20_000,
    })
    .toBe(MOCK_AGENT_COUNT);
  await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE');
  await expect(page.getByTestId('hud-agents')).toHaveText(EXPECTED_TALLY);

  // Real sprite sheets actually decoded — not just the skeleton-first
  // placeholder art. The office geometry (floor/wall/desk/coffee/plant)
  // requests its sheets unconditionally from frame 1 (webview-v3/src/App.tsx
  // mount effect), and occupied desks pull in a character sheet once real
  // agents land above. Real PNG decode over localhost, so a slightly longer
  // timeout than the render/agent polls above.
  await expect
    .poll(
      () =>
        page.evaluate(() => window.__warRoomV3TestHooks?.getAssetStats().props.chunksLoaded ?? 0),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);
  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.__warRoomV3TestHooks?.getAssetStats().characters.chunksLoaded ?? 0,
        ),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0);

  const metrics = await page.evaluate(() => {
    const element = document.querySelector('[data-testid="iso-canvas"]');
    if (!(element instanceof HTMLCanvasElement)) return null;
    const rect = element.getBoundingClientRect();
    const hooks = window.__warRoomV3TestHooks;
    const assetStats = hooks?.getAssetStats();
    return {
      pageDpr: window.devicePixelRatio,
      cssWidth: rect.width,
      cssHeight: rect.height,
      backingWidth: element.width,
      backingHeight: element.height,
      resolution: hooks?.getResolution() ?? -1,
      camera: hooks?.getCameraState() ?? null,
      agentCount: hooks?.getAgentCount() ?? -1,
      propSheetsLoaded: assetStats?.props.chunksLoaded ?? 0,
      characterSheetsLoaded: assetStats?.characters.chunksLoaded ?? 0,
    };
  });
  if (!metrics || !metrics.camera) throw new Error('canvas metrics/test hooks unavailable');

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `dsf${String(deviceScaleFactor)}-full.png`),
  });
  const canvasShot = await canvas.screenshot({
    path: path.join(SCREENSHOT_DIR, `dsf${String(deviceScaleFactor)}-canvas.png`),
  });
  const distinctColors = sampleDistinctColors(canvasShot);

  await context.close();
  return {
    deviceScaleFactor,
    pageDpr: metrics.pageDpr,
    distinctColors,
    cssWidth: metrics.cssWidth,
    cssHeight: metrics.cssHeight,
    backingWidth: metrics.backingWidth,
    backingHeight: metrics.backingHeight,
    resolution: metrics.resolution,
    camera: metrics.camera,
    agentCount: metrics.agentCount,
    propSheetsLoaded: metrics.propSheetsLoaded,
    characterSheetsLoaded: metrics.characterSheetsLoaded,
  };
}

test('DPR-3 WebKit 390x664: non-blank iso canvas, capped resolution, DSF-1 framing parity', async ({
  browser,
}) => {
  const host = await serveV3Dist();
  try {
    const dsf3 = await runAtDsf(browser, host.url, 3);
    const dsf1 = await runAtDsf(browser, host.url, 1);
    console.log(`[v3-dpr] ${JSON.stringify({ dsf3, dsf1 })}`);

    // The environment actually is what it claims (guards a silent config drift).
    expect(dsf3.pageDpr).toBe(3);
    expect(dsf1.pageDpr).toBe(1);

    // 1. Non-blank canvas CONTENT at DSF 3 — the v2 failure was exactly a
    //    sized-but-blank canvas at deviceScaleFactor 3. And at DSF 1.
    expect(dsf3.distinctColors).toBeGreaterThan(1);
    expect(dsf1.distinctColors).toBeGreaterThan(1);

    // 2. Resolution cap (min(DPR, 2)): backing store is 2x CSS at DSF 3,
    //    1x at DSF 1. ±2px for rounding.
    expect(dsf3.resolution).toBe(2);
    expect(dsf1.resolution).toBe(1);
    expect(Math.abs(dsf3.backingWidth - dsf3.cssWidth * 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(dsf3.backingHeight - dsf3.cssHeight * 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(dsf1.backingWidth - dsf1.cssWidth)).toBeLessThanOrEqual(2);
    expect(Math.abs(dsf1.backingHeight - dsf1.cssHeight)).toBeLessThanOrEqual(2);

    // 3. Camera parity: same CSS viewport => identical fit-to-view framing,
    //    whatever the device density. Any DPR leak into the camera breaks this.
    expect(Math.abs(dsf3.camera.zoom - dsf1.camera.zoom)).toBeLessThan(1e-6);
    expect(Math.abs(dsf3.camera.offsetX - dsf1.camera.offsetX)).toBeLessThan(1e-6);
    expect(Math.abs(dsf3.camera.offsetY - dsf1.camera.offsetY)).toBeLessThan(1e-6);

    // 4. Canvas fills the viewport width (fit-to-view had a real area to work with).
    expect(dsf3.cssWidth).toBeGreaterThanOrEqual(VIEWPORT.width - 2);

    // 5. Real agents occupied desks in both contexts (asserted per-run via
    //    the poll above; re-checked here so the report shows the counts).
    expect(dsf3.agentCount).toBe(MOCK_AGENT_COUNT);
    expect(dsf1.agentCount).toBe(MOCK_AGENT_COUNT);

    // 6. Real WS-B sprite sheets loaded and drew — not just placeholder
    //    art — at BOTH densities (asserted per-run via the poll above;
    //    re-checked here so the report shows the counts, and distinctColors
    //    is meaningfully higher than the old placeholder-only baseline
    //    given real art's shading/texture variety).
    expect(dsf3.propSheetsLoaded).toBeGreaterThan(0);
    expect(dsf3.characterSheetsLoaded).toBeGreaterThan(0);
    expect(dsf1.propSheetsLoaded).toBeGreaterThan(0);
    expect(dsf1.characterSheetsLoaded).toBeGreaterThan(0);
    expect(dsf3.distinctColors).toBeGreaterThan(20);
    expect(dsf1.distinctColors).toBeGreaterThan(20);
  } finally {
    await host.close();
  }
});

test('crisis surfaces at DSF-3: board order+verbs, honest gates, drawer facts, live tail, grayscale', async ({
  browser,
}) => {
  const host = await serveV3Dist();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      (window as unknown as { __PIXEL_AGENTS_E2E?: boolean }).__PIXEL_AGENTS_E2E = true;
    });
    await page.goto(`${host.url}/`);

    // Board: two crisis rows ordered age × severity — the 2:30 FIRE (poll-
    // blocked) above the fresh SMOKE (awaitingInput).
    const rows = page.getByTestId('triage-row');
    await expect(rows).toHaveCount(2, { timeout: 20_000 });
    await expect(rows.nth(0)).toHaveAttribute('data-stage', 'fire');
    await expect(rows.nth(0)).toContainText('▲ FIRE');
    await expect(rows.nth(0)).toContainText('#2 [MACBOOK] turffinder');
    await expect(rows.nth(0)).toContainText('Approve: apply migration 0042? (y/n)');
    await expect(rows.nth(0)).toContainText('→ ✱ ALARM at 4:00');
    await expect(rows.nth(1)).toHaveAttribute('data-stage', 'smoke');

    // One-hand touch grammar: rows and verbs ≥44px at phone size.
    const rowBox = await rows.nth(0).boundingBox();
    expect(rowBox).not.toBeNull();
    expect(rowBox!.height).toBeGreaterThanOrEqual(44);
    const approve = rows.nth(0).getByTestId('verb-approve');
    const approveBox = await approve.boundingBox();
    expect(approveBox).not.toBeNull();
    expect(approveBox!.height).toBeGreaterThanOrEqual(44);
    expect(approveBox!.width).toBeGreaterThanOrEqual(44);

    // Honest gate: the wire has no remote approve — one tap and the row
    // SAYS SO instead of faking a success.
    await approve.click();
    await expect(rows.nth(0).getByTestId('gate-notice')).toContainText('⊘ NO REMOTE GATE');

    // ▸ DESK → bottom-sheet drawer with the full v1 fact set + live tail
    // (tailSubscribe → mock ring replay).
    await rows.nth(0).getByTestId('verb-desk').click();
    const drawer = page.getByTestId('agent-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('sess-e2e-2');
    await expect(drawer).toContainText('/Users/greg/code/turffinder');
    await expect(drawer).toContainText('⚠ NEEDS INPUT');
    await expect(drawer).toContainText('12.3k in · 678 out');
    // KILL is honestly unavailable: pid known but no live runner behind the
    // static host (GET /api/dispatch/machines 404s → empty list).
    await expect(drawer.getByTestId('kill-disabled-reason')).toContainText('NO RUNNER');
    await expect(drawer.getByTestId('tail-log')).toContainText('● Bash(npm test)');
    await expect(drawer.getByTestId('tail-log')).toContainText('Running 46 tests…');

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'dsf3-crisis.png') });

    // ◑ GRAYSCALE actually applies the filter (colorblind hard-rule gate).
    await page.getByTestId('hud-grayscale').click();
    await expect(page.locator('.app')).toHaveClass(/grayscale/);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'dsf3-crisis-grayscale.png') });
  } finally {
    await context.close();
    await host.close();
  }
});
