import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { test, expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

/**
 * THROWAWAY forensics probe — KICKOFF-v2.0 Phase 1.1. NOT part of the
 * product e2e suite. Reproduces the "office canvas broken on real iPhone"
 * report (poor load / wrong scale / assets never render) under Playwright
 * WebKit + an iPhone device profile — the closest proxy to iOS Safari
 * available on a Mac — and compares against desktop WebKit and Chromium's
 * iPhone emulation (the config that gave a FALSE PASS during the original
 * v1.1 fix). Run via:
 *
 *   npx playwright test --config .planning/v2/forensics/playwright.forensics.config.ts
 *
 * Minimal re-implementation of e2e/helpers/standalone.ts's host-spawn logic
 * (not imported) because that helper unconditionally calls
 * page.setViewportSize({width:1280,height:800}), which would clobber the
 * iPhone device viewport/DPR the project under test sets up.
 */

const REPO_ROOT = path.resolve(__dirname, '../../..');
const STANDALONE_CLI = path.join(REPO_ROOT, 'dist', 'cli.js');
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitForHttpOk(url: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`GET ${url} -> ${response.status.toString()}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for ${url}`);
}

interface Host {
  hostUrl: string;
  process: ChildProcessWithoutNullStreams;
  tmpHome: string;
  workspaceDir: string;
  getLogs: () => string;
}

async function spawnHost(): Promise<Host> {
  if (!fs.existsSync(STANDALONE_CLI)) {
    throw new Error(`Standalone CLI not built at ${STANDALONE_CLI}. Run 'npm run build' first.`);
  }
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'war-room-forensics-home-'));
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'war-room-forensics-ws-'));
  const hostPort = await getFreePort();
  const hostUrl = `http://127.0.0.1:${hostPort}`;
  const child = spawn(
    process.execPath,
    [STANDALONE_CLI, '--port', String(hostPort), '--host', '127.0.0.1'],
    {
      cwd: workspaceDir,
      env: { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome },
      stdio: 'pipe',
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => (stdout += c.toString()));
  child.stderr.on('data', (c) => (stderr += c.toString()));
  await waitForHttpOk(`${hostUrl}/api/health`);
  return {
    hostUrl,
    process: child,
    tmpHome,
    workspaceDir,
    getLogs: () => [stdout.trim(), stderr.trim()].filter(Boolean).join('\n'),
  };
}

async function stopHost(host: Host): Promise<void> {
  if (host.process.exitCode !== null || host.process.killed) return;
  host.process.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => host.process.once('exit', () => resolve())),
    delay(2000),
  ]);
  if (host.process.exitCode === null && !host.process.killed) host.process.kill('SIGKILL');
  fs.rmSync(host.tmpHome, { recursive: true, force: true });
  fs.rmSync(host.workspaceDir, { recursive: true, force: true });
}

/** Record every HTMLCanvasElement.getContext() call before any app code
 *  runs, so we see EXACTLY what context type/attributes Pixi negotiated on
 *  this engine (not what we assume pixi.js@8.19.0's Application.init picks). */
async function installGlProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    (window as unknown as { __glProbe: unknown[] }).__glProbe = calls;
    const orig = HTMLCanvasElement.prototype.getContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (HTMLCanvasElement.prototype as any).getContext = function (
      this: HTMLCanvasElement,
      type: string,
      options?: unknown,
    ) {
      // eslint-disable-next-line prefer-rest-params
      const ctx = orig.apply(this, arguments as unknown as [string, unknown]);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const info: any = { type, options, gotContext: !!ctx };
        if (ctx && (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl')) {
          const gl = ctx as WebGLRenderingContext;
          info.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
          info.maxRenderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
          info.maxViewportDims = Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array);
          info.contextAttributes = gl.getContextAttributes();
          const dbg = gl.getExtension('WEBGL_debug_renderer_info');
          if (dbg) {
            info.unmaskedRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
            info.unmaskedVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
          }
        }
        calls.push(info);
      } catch (e) {
        calls.push({ type, error: String(e) });
      }
      return ctx;
    };
  });
}

/** Record every WS message's declared `type` field + byte length, and any
 *  close/error events — tells us whether asset payloads actually ARRIVE at
 *  the client, independent of whether Pixi then paints them. */
async function installWsProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: unknown[] = [];
    (window as unknown as { __wsProbe: unknown[] }).__wsProbe = log;
    const OriginalWebSocket = window.WebSocket;
    const Proxied = new Proxy(OriginalWebSocket, {
      construct(target, args) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const socket = Reflect.construct(target, args as any) as WebSocket;
        socket.addEventListener('open', () => log.push({ at: Date.now(), kind: 'open' }));
        socket.addEventListener('message', (event: MessageEvent) => {
          try {
            const data = event.data as unknown;
            const byteLen = typeof data === 'string' ? data.length : -1;
            let msgType = 'unknown';
            if (typeof data === 'string') {
              try {
                msgType = (JSON.parse(data) as { type?: string }).type ?? 'unknown';
              } catch {
                msgType = '__unparseable__';
              }
            }
            log.push({ at: Date.now(), kind: 'message', msgType, byteLen });
          } catch {
            // best-effort probe only
          }
        });
        socket.addEventListener('error', () => log.push({ at: Date.now(), kind: 'error' }));
        socket.addEventListener('close', (e: CloseEvent) =>
          log.push({ at: Date.now(), kind: 'close', code: e.code, reason: e.reason }),
        );
        return socket;
      },
    });
    window.WebSocket = Proxied as unknown as typeof WebSocket;
  });
}

/** Dense-grid canvas content sampler, same method as
 *  e2e/tests/standalone/disappearing-view.spec.ts's canvasShowsContent —
 *  duplicated here (not imported) to keep this probe fully standalone. */
async function sampleCanvas(
  page: Page,
): Promise<{ distinctColors: number; hasContent: boolean; width: number; height: number }> {
  const locator = page.locator('[data-testid="office-canvas"]');
  const count = await locator.count();
  if (count === 0) return { distinctColors: 0, hasContent: false, width: 0, height: 0 };
  const buffer = await locator.screenshot();
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;
  const GRID = 16;
  const colors = new Set<string>();
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const x = Math.min(width - 1, Math.floor((width * (gx + 0.5)) / GRID));
      const y = Math.min(height - 1, Math.floor((height * (gy + 0.5)) / GRID));
      const idx = (width * y + x) * 4;
      colors.add(`${data[idx]},${data[idx + 1]},${data[idx + 2]},${data[idx + 3]}`);
    }
  }
  return { distinctColors: colors.size, hasContent: colors.size > 1, width, height };
}

/**
 * DPR-cost isolation: pixiApp.ts sets `resolution: window.devicePixelRatio`
 * (KICKOFF v1.1 item 2b, commit a44ede6) — on a DPR-3 phone that's 9x the
 * device-pixel fill rate of DPR-1. Runs once (webkit-iphone14 project only)
 * against a single running host, comparing two fresh WebKit contexts that
 * differ ONLY in deviceScaleFactor, to isolate the resolution cost from
 * network/host variance.
 */
test('DPR 1 vs DPR 3 init + settle cost', async ({ browser }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'webkit-iphone14',
    'single-run comparison, gated to one project',
  );
  const host = await spawnHost();
  try {
    async function run(deviceScaleFactor: number) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 664 },
        deviceScaleFactor,
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        (window as unknown as { __PIXEL_AGENTS_E2E?: boolean }).__PIXEL_AGENTS_E2E = true;
      });
      const t0 = Date.now();
      await page.goto(`${host.hostUrl}/`);
      await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible({ timeout: 20_000 });
      const tMounted = Date.now() - t0;
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                (
                  window as unknown as {
                    __pixelAgentsTestHooks?: { getPixiInitCount?: () => number };
                  }
                ).__pixelAgentsTestHooks?.getPixiInitCount?.() ?? 0,
            ),
          { timeout: 20_000 },
        )
        .toBe(1);
      const tPixiReady = Date.now() - t0;
      const canvasMetrics = await page.evaluate(() => {
        const canvas = document.querySelector(
          '[data-testid="office-canvas"]',
        ) as HTMLCanvasElement | null;
        return canvas ? { widthAttr: canvas.width, heightAttr: canvas.height } : null;
      });
      await page.addStyleTag({
        content: `body * { visibility: hidden !important; } [data-testid="office-canvas"], [data-testid="office-canvas"] * { visibility: visible !important; }`,
      });
      await page.screenshot({
        path: path.join(
          SCREENSHOT_DIR,
          `dpr${String(deviceScaleFactor)}-narrow-viewport-canvas-isolated.png`,
        ),
      });
      await context.close();
      return { deviceScaleFactor, tMounted, tPixiReady, canvasMetrics };
    }

    const dpr1 = await run(1);
    const dpr3 = await run(3);
    const result = {
      dpr1,
      dpr3,
      devicePixelRatioMultiplier: dpr3.canvasMetrics
        ? (dpr3.canvasMetrics.widthAttr * dpr3.canvasMetrics.heightAttr) /
          (dpr1.canvasMetrics!.widthAttr * dpr1.canvasMetrics!.heightAttr)
        : null,
    };
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(SCREENSHOT_DIR, 'dpr-comparison.json'),
      JSON.stringify(result, null, 2),
    );
    console.log(`[forensics] DPR comparison: ${JSON.stringify(result)}`);
  } finally {
    await stopHost(host);
  }
});

test('office canvas forensics', async ({ page, browserName }, testInfo) => {
  const host = await spawnHost();
  const consoleMessages: { type: string; text: string }[] = [];
  const pageErrors: string[] = [];
  const networkLog: {
    url: string;
    status?: number;
    method: string;
    resourceType: string;
    failure?: string;
  }[] = [];

  page.on('console', (msg) => consoleMessages.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('requestfailed', (req) =>
    networkLog.push({
      url: req.url(),
      method: req.method(),
      resourceType: req.resourceType(),
      failure: req.failure()?.errorText,
    }),
  );
  page.on('response', (res) =>
    networkLog.push({
      url: res.url(),
      status: res.status(),
      method: res.request().method(),
      resourceType: res.request().resourceType(),
    }),
  );

  try {
    await installGlProbe(page);
    await installWsProbe(page);
    // App.tsx only calls installTestHooks() (exposes window.__pixelAgentsTestHooks,
    // incl. getPixiInitCount) when runtime.ts's isE2E reads this flag as true.
    await page.addInitScript(() => {
      (window as unknown as { __PIXEL_AGENTS_E2E?: boolean }).__PIXEL_AGENTS_E2E = true;
    });

    const viewportBefore = page.viewportSize();
    const t0 = Date.now();
    await page.goto(`${host.hostUrl}/`);

    let mounted = true;
    let mountError: string | null = null;
    try {
      await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible({ timeout: 20_000 });
    } catch (e) {
      mounted = false;
      mountError = String(e);
    }
    const tMounted = Date.now() - t0;

    // Let the ticker run + WS asset messages arrive + Pixi paint a few frames.
    await page.waitForTimeout(2000);
    const tSettled = Date.now() - t0;

    const glProbe = await page.evaluate(
      () => (window as unknown as { __glProbe?: unknown[] }).__glProbe ?? [],
    );
    const wsProbe = await page.evaluate(
      () => (window as unknown as { __wsProbe?: unknown[] }).__wsProbe ?? [],
    );
    const pixiInitCount = await page.evaluate(
      () =>
        (
          window as unknown as {
            __pixelAgentsTestHooks?: { getPixiInitCount?: () => number };
          }
        ).__pixelAgentsTestHooks?.getPixiInitCount?.() ?? null,
    );

    const canvasMetrics = await page.evaluate(() => {
      const canvas = document.querySelector(
        '[data-testid="office-canvas"]',
      ) as HTMLCanvasElement | null;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return {
        widthAttr: canvas.width,
        heightAttr: canvas.height,
        styleWidth: canvas.style.width,
        styleHeight: canvas.style.height,
        boundingClientRect: {
          width: rect.width,
          height: rect.height,
          top: rect.top,
          left: rect.left,
        },
        dpr: window.devicePixelRatio,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        documentScrollWidth: document.documentElement.scrollWidth,
        documentScrollHeight: document.documentElement.scrollHeight,
        visualViewportScale: window.visualViewport?.scale ?? null,
        visualViewportWidth: window.visualViewport?.width ?? null,
      };
    });

    const canvasContent = mounted
      ? await sampleCanvas(page)
      : { distinctColors: 0, hasContent: false, width: 0, height: 0 };

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const shotPath = path.join(SCREENSHOT_DIR, `${testInfo.project.name}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });
    const canvasShotPath = path.join(SCREENSHOT_DIR, `${testInfo.project.name}-canvas-only.png`);
    if (mounted && (await page.locator('[data-testid="office-canvas"]').count()) > 0) {
      await page.locator('[data-testid="office-canvas"]').screenshot({ path: canvasShotPath });
    }
    // Runtime-only: hide every DOM element EXCEPT the canvas, to rule out
    // overlay panels bleeding into the element-scoped screenshot above (they
    // are absolutely positioned and can overlap the canvas's bounding box).
    // Not a source change — a page.addStyleTag call, undone by page teardown.
    if (mounted) {
      await page.addStyleTag({
        content: `
          body * { visibility: hidden !important; }
          [data-testid="office-canvas"], [data-testid="office-canvas"] * { visibility: visible !important; }
        `,
      });
      const clearShotPath = path.join(
        SCREENSHOT_DIR,
        `${testInfo.project.name}-canvas-isolated.png`,
      );
      await page.screenshot({ path: clearShotPath, fullPage: false });
    }

    const relevantNetwork = networkLog.filter(
      (n) =>
        n.status !== undefined &&
        (n.status >= 400 || n.resourceType === 'image' || n.url.includes('/assets/')),
    );
    const failedNetwork = networkLog.filter((n) => n.failure !== undefined);

    const report = {
      project: testInfo.project.name,
      browserName,
      viewportBefore,
      mounted,
      mountError,
      timing: { tMounted, tSettled },
      pixiInitCount,
      canvasMetrics,
      canvasContent,
      glProbeCalls: glProbe,
      wsProbeLog: wsProbe,
      consoleErrors: consoleMessages.filter((m) => m.type === 'error'),
      consoleWarnings: consoleMessages.filter((m) => m.type === 'warning'),
      consoleAll: consoleMessages,
      pageErrors,
      networkFailed: failedNetwork,
      networkRelevant: relevantNetwork,
      networkTotalRequests: networkLog.length,
      hostLogs: host.getLogs(),
      screenshotPath: shotPath,
    };

    const jsonPath = path.join(SCREENSHOT_DIR, `${testInfo.project.name}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(`[forensics] wrote ${jsonPath}`);
    console.log(
      `[forensics] ${testInfo.project.name}: mounted=${mounted} tMounted=${tMounted}ms tSettled=${tSettled}ms canvasContent=${JSON.stringify(canvasContent)} pixiInitCount=${pixiInitCount}`,
    );
    console.log(
      `[forensics] ${testInfo.project.name}: canvasMetrics=${JSON.stringify(canvasMetrics)}`,
    );
    console.log(`[forensics] ${testInfo.project.name}: glProbe=${JSON.stringify(glProbe)}`);
  } finally {
    await stopHost(host);
  }
});
