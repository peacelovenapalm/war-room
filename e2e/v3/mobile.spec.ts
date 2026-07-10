import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { WebSocketServer } from 'ws';

/**
 * Stage-4 phone-layout e2e — KICKOFF-v3.1 WS-A item 4(b)/(c): cold-open
 * board, FLOOR FEED, and the push-landing deep link ("Board + auto-opened
 * crisis sheet"). A SEPARATE file from dpr.spec.ts on purpose (same
 * rationale as panels.spec.ts's header note) — this suite never risks the
 * permanent DPR gate's mock host or script.
 *
 * Phone viewport, default (non-boosted) device scale factor — DPR-3
 * specific assertions already live in dpr.spec.ts; this file is about
 * LAYOUT and DATA, not backing-store math.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');
const V3_DIST = path.join(REPO_ROOT, 'webview-v3', 'dist');
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

const MOCK_SERVER_SCRIPT: object[] = [
  {
    type: 'existingAgents',
    agents: [1, 2],
    folderNames: { '1': 'war-room', '2': 'turffinder' },
    externalAgents: {},
    machines: { '1': 'MACBOOK', '2': 'MACBOOK' },
    providers: { '1': 'claude', '2': 'claude' },
    sessionIds: { '2': 'sess-mobile-2' },
    cwds: { '2': '/Users/greg/code/turffinder' },
  },
  { type: 'agentStatus', id: 1, status: 'active' },
  { type: 'agentStatus', id: 2, status: 'active' },
];

interface StaticHost {
  url: string;
  close: () => Promise<void>;
}

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

/** Minimal static file server over webview-v3/dist, with a scripted mock
 *  `/ws` and per-agent tail chunks (both agents get output, interleaved,
 *  so the merged FLOOR FEED has real multi-agent content to assert on). */
async function serveV3Dist(): Promise<StaticHost> {
  if (!fs.existsSync(path.join(V3_DIST, 'index.html'))) {
    throw new Error(
      `webview-v3 not built at ${V3_DIST}. Run 'npm run build:webview-v3' first (npm run e2e:v3-dpr does).`,
    );
  }
  const port = await getFreePort();
  const server = http.createServer((req, res) => {
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
        // FLOOR FEED source data: subscribing to either agent replays one
        // chunk each, on separate streams, so a merged-order assertion
        // actually exercises the cross-stream merge (not just one stream).
        if (message.type === 'tailSubscribe' && message.source === 'agent') {
          const chunkText = message.id === '1' ? 'war-room building…\n' : 'turffinder tests…\n';
          socket.send(
            JSON.stringify({
              type: 'outputChunk',
              source: 'agent',
              id: message.id,
              seq: 0,
              stream: 'transcript',
              chunk: chunkText,
              truncated: false,
            }),
          );
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

test.describe('phone layout (stage 4)', () => {
  test('cold open: world strip + triage board both render above the fold, no scroll needed', async ({
    browser,
  }) => {
    const host = await serveV3Dist();
    const context = await browser.newContext({
      viewport: VIEWPORT,
      isMobile: true,
      hasTouch: true,
    });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });

      // Board is the phone cold open (KICKOFF-v3.1 mobile decision): its
      // header is visible without any scroll or extra tap.
      const boardHeader = page.locator('.triage-board__header');
      await expect(boardHeader).toBeVisible();
      const box = await boardHeader.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeLessThan(VIEWPORT.height);

      // The world strip renders ABOVE the board (GAME-DESIGN-V3 §3.2 item
      // 2 — "the whole floor at a glance" before the board carries verbs).
      const canvas = page.locator('[data-testid="iso-canvas"]');
      const canvasBox = await canvas.boundingBox();
      expect(canvasBox).not.toBeNull();
      expect(canvasBox!.y).toBeLessThan(box!.y);

      // GRAYSCALE stays reachable on phone (rejected hidden-on-phone
      // pattern, carried from stage 2 — still true after the stage-4 HUD
      // additions).
      await expect(page.getByTestId('hud-grayscale')).toBeVisible();
    } finally {
      await context.close();
      await host.close();
    }
  });

  test("FLOOR FEED merges both agents' tails, agent-labeled, below the board", async ({
    browser,
  }) => {
    const host = await serveV3Dist();
    const context = await browser.newContext({
      viewport: VIEWPORT,
      isMobile: true,
      hasTouch: true,
    });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });

      const feed = page.getByTestId('floor-feed-log');
      await expect(feed).toContainText('war-room building…', { timeout: 20_000 });
      await expect(feed).toContainText('turffinder tests…');
      // Real agent-name labels, not placeholder/guessed text.
      await expect(feed).toContainText('[war-room]');
      await expect(feed).toContainText('[turffinder]');
    } finally {
      await context.close();
      await host.close();
    }
  });

  test("push-landing deep link (?agentId=2) auto-opens that agent's crisis sheet", async ({
    browser,
  }) => {
    const host = await serveV3Dist();
    const context = await browser.newContext({
      viewport: VIEWPORT,
      isMobile: true,
      hasTouch: true,
    });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/?agentId=2`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });

      // Board is STILL the cold-open surface underneath (unconditional) —
      // the deep link adds an auto-opened sheet on top of it, never
      // replaces it.
      await expect(page.locator('.triage-board__header')).toBeVisible();

      // No tap performed — the drawer opens on its own once agent 2 lands.
      const drawer = page.getByTestId('agent-drawer');
      await expect(drawer).toBeVisible({ timeout: 20_000 });
      await expect(drawer).toContainText('sess-mobile-2');
      await expect(drawer).toContainText('/Users/greg/code/turffinder');
    } finally {
      await context.close();
      await host.close();
    }
  });

  test('panel dock on phone: labeled, 44px, in-flow below the FLOOR FEED (never an overlay)', async ({
    browser,
  }) => {
    const host = await serveV3Dist();
    const context = await browser.newContext({
      viewport: VIEWPORT,
      isMobile: true,
      hasTouch: true,
    });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });

      // Stage-5 finding: the absolute bottom dock obscured the feed's newest
      // lines and dropped its text labels (glyph-only ▤/▦/▥ fails the
      // shape+label hard rule). Locked in: every dock button shows its text
      // label at ≥44px, and the dock sits BELOW the feed in flow.
      const dock = page.getByTestId('panel-dock');
      await expect(dock).toBeVisible();
      for (const [kind, label] of [
        ['call', 'CALL'],
        ['shift', 'SHIFT'],
        ['contracts', 'CONTRACTS'],
        ['briefing', 'BRIEFING'],
        ['help', 'HELP'],
      ] as const) {
        const item = page.getByTestId(`dock-${kind}`);
        await expect(item.locator('.panel-dock__label')).toHaveText(label);
        await expect(item.locator('.panel-dock__label')).toBeVisible();
        const box = await item.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.width).toBeGreaterThanOrEqual(44);
      }

      const feed = page.getByTestId('floor-feed-log');
      await expect(feed).toContainText('war-room building…', { timeout: 20_000 });
      const feedBox = await feed.boundingBox();
      const dockBox = await dock.boundingBox();
      expect(feedBox).not.toBeNull();
      expect(dockBox).not.toBeNull();
      // Feed ends at or above the dock's top edge — no overlap.
      expect(feedBox!.y + feedBox!.height).toBeLessThanOrEqual(dockBox!.y + 1);
    } finally {
      await context.close();
      await host.close();
    }
  });

  test('an invalid/absent deep link never auto-opens a drawer (honest no-op)', async ({
    browser,
  }) => {
    const host = await serveV3Dist();
    const context = await browser.newContext({
      viewport: VIEWPORT,
      isMobile: true,
      hasTouch: true,
    });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/?agentId=not-a-number`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });
      await page.waitForTimeout(500);
      await expect(page.getByTestId('agent-drawer')).toHaveCount(0);
    } finally {
      await context.close();
      await host.close();
    }
  });
});
