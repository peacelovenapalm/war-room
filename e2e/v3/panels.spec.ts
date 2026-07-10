import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { WebSocketServer } from 'ws';

/**
 * Stage-3 panel-port e2e — KICKOFF-v3.1 §3 WS-A item 3 ("Tests for each
 * port"). Separate file from dpr.spec.ts (the PERMANENT DPR gate) so this
 * suite never risks that one's mock host — a deliberate duplication, not
 * DRY neglect (see KICKOFF-v3.1 note on the tension: this worktree owns
 * one agent at a time, but the DPR spec's script is asserted on verbatim
 * elsewhere and must not shift under an unrelated refactor).
 *
 * Desktop viewport (the desktop chrome model — prop hotspots + compact
 * dock — is what this suite covers; DPR/mobile framing has its own
 * permanent spec). GET /api/dispatch/machines is deliberately LEFT
 * UNMOCKED (404s, same as dpr.spec.ts) so the CALL modal's honest
 * "⚠ NO RUNNERS" gate is exercised for real, not hidden behind a mock.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');
const V3_DIST = path.join(REPO_ROOT, 'webview-v3', 'dist');
const VIEWPORT = { width: 1280, height: 860 };

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

const REST_JSON: Record<string, unknown> = {
  '/api/briefing': {
    todo: {
      date: '2026-07-10',
      startNow: ['ship the panel ports'],
      sections: [{ title: 'Blocked', count: 1 }],
    },
    tracker: {
      milestone: 'v3',
      gates: [{ id: 'g1', label: 'stage-3', status: 'IN_PROGRESS', done: 2, total: 5 }],
    },
    generatedAt: '2026-07-10T00:00:00Z',
  },
  '/api/shift': {
    today: {
      date: '2026-07-10',
      turnsCompleted: 4,
      tokensIn: 12000,
      tokensOut: 3400,
      crisesIgnited: 2,
      crisesResolved: 1,
      crisesOpen: 1,
      meanTimeToUnblockMs: 90_000,
      longestBlockedMs: 120_000,
      todosClosed: 3,
      gatesAdvanced: 1,
      outputTokensPerTurn: 850,
      efficiency: 'LEAN',
      generatedAt: '2026-07-10T00:00:00Z',
    },
    yesterday: null,
  },
  '/api/contracts': [
    {
      id: 'ct-1',
      source: 'priority',
      title: 'Ship stage-3 panel ports',
      sourceKey: 'todo-1',
      payoutCash: 50,
      payoutRep: 2,
      status: 'open',
      createdAt: 0,
    },
  ],
  '/api/chains/defs': [],
  '/api/chains/runs': [],
  '/api/standing-orders': [],
};

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

async function serveV3Dist(options: { stopAllFails?: boolean } = {}): Promise<StaticHost> {
  if (!fs.existsSync(path.join(V3_DIST, 'index.html'))) {
    throw new Error(`webview-v3 not built at ${V3_DIST}. Run 'npm run build:webview-v3' first.`);
  }
  const port = await getFreePort();
  const server = http.createServer((req, res) => {
    const requestPath = decodeURIComponent((req.url ?? '/').split('?')[0]);

    if (requestPath === '/api/automation/stop-all' && req.method === 'POST') {
      if (options.stopAllFails) {
        // The panel finding's exact scenario: an auth/validation failure —
        // parseable JSON, but neither res.ok nor body.ok.
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, haltedOrders: 0, haltedRuns: 0 }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, haltedOrders: 0, haltedRuns: 0 }));
      return;
    }
    if (requestPath === '/api/automation/resume' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, resumedOrders: 0 }));
      return;
    }
    if (requestPath in REST_JSON) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(REST_JSON[requestPath]));
      return;
    }
    // /api/dispatch/machines and anything else fall through to 404 —
    // deliberately unmocked (see file header).

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
        const message = JSON.parse(data.toString()) as { type?: string };
        if (message.type === 'webviewReady') {
          const script: object[] = [
            {
              type: 'existingAgents',
              agents: [1],
              folderNames: { '1': 'war-room' },
              externalAgents: {},
              machines: { '1': 'MACBOOK' },
              providers: { '1': 'claude' },
            },
            { type: 'agentStatus', id: 1, status: 'active' },
            {
              type: 'settingsLoaded',
              soundEnabled: true,
              lastSeenVersion: '1.0.0',
              extensionVersion: '1.0.1',
              watchAllSessions: false,
              alwaysShowLabels: false,
              hooksEnabled: true,
              hooksInfoShown: true,
              externalAssetDirectories: [],
            },
            {
              type: 'budgetUpdate',
              claude: {
                fiveHourUsedPct: 12,
                sevenDayUsedPct: 4,
                stale: false,
                receivedAt: Date.now(),
              },
              codex: { weeklyCap: null, weeklyUsed: 0, estimatedPct: null },
            },
          ];
          for (const serverMessage of script) socket.send(JSON.stringify(serverMessage));
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

test.describe('stage-3 panel ports (desktop chrome model)', () => {
  test('dock opens every panel; HELP/SETTINGS/DEBUG/SHIFT/BRIEFING/CONTRACTS/AUTOMATION render real content or an honest empty state', async ({
    browser,
  }) => {
    const host = await serveV3Dist();
    const context = await browser.newContext({ viewport: VIEWPORT });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });

      // Compact dock — every stage-3 panel is reachable from here (the
      // cross-platform affordance; PropHotspots is the desktop-only bonus
      // path for the five with a physical analog).
      const dock = page.getByTestId('panel-dock');
      await expect(dock).toBeVisible();
      for (const kind of [
        'call',
        'automation',
        'contracts',
        'shift',
        'briefing',
        'settings',
        'debug',
        'help',
      ]) {
        await expect(page.getByTestId(`dock-${kind}`)).toBeVisible();
      }

      // HELP: full vocabulary, categorized, `?` key also opens it.
      await page.getByTestId('dock-help').click();
      await expect(page.getByTestId('help-modal')).toBeVisible();
      await expect(page.getByTestId('help-category-signals')).toBeVisible();
      await page.getByTestId('modal-close').click();
      await expect(page.getByTestId('help-modal')).toBeHidden();
      await page.keyboard.press('?');
      await expect(page.getByTestId('help-modal')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('help-modal')).toBeHidden();

      // SETTINGS: real toggle, reflects settingsLoaded + flips on click.
      await page.getByTestId('dock-settings').click();
      const soundToggle = page.getByTestId('settings-sound');
      await expect(soundToggle).toBeChecked();
      await soundToggle.click();
      await expect(soundToggle).not.toBeChecked();
      await page.getByTestId('modal-close').click();

      // DEBUG: raw table with the one real agent.
      await page.getByTestId('dock-debug').click();
      await expect(page.getByTestId('debug-agent-table')).toBeVisible();
      await expect(page.getByTestId('debug-agent-row')).toHaveCount(1);
      await page.getByTestId('modal-close').click();

      // SHIFT: real /api/shift scorecard.
      await page.getByTestId('dock-shift').click();
      await expect(page.getByTestId('shift-panel')).toContainText('4 completed');
      await expect(page.getByTestId('shift-efficiency')).toContainText('LEAN');
      await page.getByTestId('modal-close').click();

      // BRIEFING: real /api/briefing todo + gate.
      await page.getByTestId('dock-briefing').click();
      await expect(page.getByTestId('briefing-panel')).toContainText('ship the panel ports');
      await expect(page.getByTestId('briefing-panel')).toContainText('stage-3');
      await page.getByTestId('modal-close').click();

      // CONTRACTS: real /api/contracts row + honest DISPATCH bridge into CALL.
      await page.getByTestId('dock-contracts').click();
      await expect(page.getByTestId('contracts-panel')).toContainText('Ship stage-3 panel ports');
      await page.getByTestId('contract-dispatch').click();
      await expect(page.getByTestId('call-modal')).toBeVisible();
      // Honest gate: /api/dispatch/machines 404s (unmocked) -> NO RUNNERS,
      // never a silently-empty or fake-success dropdown.
      await expect(page.getByTestId('call-no-runners')).toBeVisible();
      await page.getByTestId('modal-close').click();

      // AUTOMATION: STOP ALL is real (POST /api/automation/stop-all), then
      // RESUME needs its own explicit confirm click (never automatic). The
      // panel repeats the SAME control the HUD has (both hit the one real
      // endpoint) — scope to the panel's instance, not the HUD's.
      await page.getByTestId('dock-automation').click();
      const automationPanel = page.getByTestId('automation-panel');
      await expect(automationPanel).toBeVisible();
      await automationPanel.getByTestId('stop-all-control').click();
      await expect(automationPanel.getByTestId('resume-control')).toHaveText('▶ RESUME');
      // ONE lifted stop state (panel finding, StopAllControl.tsx:12): the
      // HUD's always-visible instance flips WITH the panel's — a second
      // operator glancing at the HUD can never read "not stopped" while
      // the panel says RESUME.
      await expect(page.locator('.hud').getByTestId('resume-control')).toBeVisible();
      await automationPanel.getByTestId('resume-control').click();
      await expect(automationPanel.getByTestId('resume-control')).toHaveText('⚠ CONFIRM RESUME');
      await automationPanel.getByTestId('resume-control').click();
      await expect(automationPanel.getByTestId('stop-all-control')).toBeVisible();
      await expect(page.locator('.hud').getByTestId('stop-all-control')).toBeVisible();
      await page.getByTestId('modal-close').click();

      // STOP ALL in the HUD stays clickable while a panel is open (hard
      // rule 8: never buried behind a modal backdrop).
      await page.getByTestId('dock-briefing').click();
      await expect(page.getByTestId('briefing-panel')).toBeVisible();
      const hudStopAll = page.locator('.hud').getByTestId('stop-all-control');
      await expect(hudStopAll).toBeVisible();
      await expect(hudStopAll).toBeInViewport();
    } finally {
      await context.close();
      await host.close();
    }
  });

  test('world prop hotspots open their panel (room-is-interface half of the desktop chrome model)', async ({
    browser,
  }) => {
    const host = await serveV3Dist();
    const context = await browser.newContext({ viewport: VIEWPORT });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });

      // Hotspot buttons only render once the world has painted at least
      // once (chipFrame becomes non-null) — their visibility itself is the
      // "real paint happened" signal here (dpr.spec.ts owns the dedicated
      // render-count / non-blank-canvas assertions).
      await expect(page.getByTestId('hotspot-call')).toBeVisible({ timeout: 20_000 });

      await page.getByTestId('hotspot-call').click();
      await expect(page.getByTestId('call-modal')).toBeVisible();
      await page.getByTestId('modal-close').click();

      await page.getByTestId('hotspot-shift').click();
      await expect(page.getByTestId('shift-panel')).toBeVisible();
    } finally {
      await context.close();
      await host.close();
    }
  });

  test('STOP ALL failure is honest: explicit ✗ FAILED, switch stays armed (hard rule 8)', async ({
    browser,
  }) => {
    // Panel finding (StopAllControl.tsx:20): a 403/{ok:false} response used
    // to flip the UI to "stopped" while automation kept running unattended.
    const host = await serveV3Dist({ stopAllFails: true });
    const context = await browser.newContext({ viewport: VIEWPORT });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });

      const hud = page.locator('.hud');
      await hud.getByTestId('stop-all-control').click();

      // Shape + label failure state (colorblind rule), never a silent flip.
      await expect(hud.getByTestId('stop-all-failed')).toBeVisible();
      await expect(hud.getByTestId('stop-all-failed')).toContainText('✗ STOP ALL FAILED');
      // Still armed: no RESUME anywhere — the halt was never confirmed.
      await expect(hud.getByTestId('stop-all-control')).toBeVisible();
      await expect(page.getByTestId('resume-control')).toHaveCount(0);
    } finally {
      await context.close();
      await host.close();
    }
  });
});
