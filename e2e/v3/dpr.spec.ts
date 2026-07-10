import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

import { type Browser, expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

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
 * dense-grid canvas sampler), but standalone-static: webview-v3 paints its
 * placeholder world with no server (skeleton-first hard rule), so no
 * dist/cli.js host is needed here.
 */

declare global {
  interface Window {
    /** Installed by webview-v3/src/testHooks.ts under the e2e flag. */
    __warRoomV3TestHooks?: {
      getRenderCount: () => number;
      getAgentCount: () => number;
      getResolution: () => number;
      getCameraState: () => { zoom: number; offsetX: number; offsetY: number } | null;
    };
  }
}

const REPO_ROOT = path.resolve(__dirname, '../..');
const V3_DIST = path.join(REPO_ROOT, 'webview-v3', 'dist');
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
  await new Promise<void>((resolve) => {
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${String(port)}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
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

  const metrics = await page.evaluate(() => {
    const element = document.querySelector('[data-testid="iso-canvas"]');
    if (!(element instanceof HTMLCanvasElement)) return null;
    const rect = element.getBoundingClientRect();
    const hooks = window.__warRoomV3TestHooks;
    return {
      pageDpr: window.devicePixelRatio,
      cssWidth: rect.width,
      cssHeight: rect.height,
      backingWidth: element.width,
      backingHeight: element.height,
      resolution: hooks?.getResolution() ?? -1,
      camera: hooks?.getCameraState() ?? null,
      agentCount: hooks?.getAgentCount() ?? -1,
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
  } finally {
    await host.close();
  }
});
