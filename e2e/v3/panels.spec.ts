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
const V3_DIST = path.join(REPO_ROOT, 'dist', 'webview-v3');
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
    // v4 T7 "SHIFT absorbs morning" — the digest fold consumed by the
    // panel's MORNING section (ShiftPanel.tsx).
    digest: {
      date: '2026-07-10',
      flagsSummary: 'vault-health: 2 issues · project-pulse: 1 flagged',
      topStandingFlags: ['oldest-flag — open 10d (project-pulse)'],
    },
    generatedAt: '2026-07-10T00:00:00Z',
  },
  // v4 T7 routine inbox tray — newest-first fixture across two routines.
  '/api/inbox': {
    available: true,
    entries: [
      { routine: 'summary', filename: '2026-07-10-digest.md', mtimeMs: 0, ageMs: 3_600_000 },
      { routine: 'todo', filename: '2026-07-10.md', mtimeMs: 0, ageMs: 7_200_000 },
    ],
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
    opsReview: {
      generatedAt: '2026-07-10T00:00:00Z',
      counts: { info: 0, warn: 1, alert: 0 },
      topFinding: { summary: 'agent 2 blocked 5m on MACBOOK', severity: 'warn' },
    },
    // T3 rung 3: SHIFT fold's auto-action count — real receipts, zero on a
    // shipped-empty whitelist (this fixture's default world).
    autoActionCount: 0,
  },
  '/api/ops/review': {
    generatedAt: '2026-07-10T00:00:00Z',
    findings: [
      {
        id: 'blocked-age-2',
        kind: 'blocked-age',
        severity: 'warn',
        summary: 'agent 2 blocked 5m on MACBOOK',
        detail: 'waitingFor: Approve: apply migration 0042? (y/n)',
        receipts: [
          { label: 'agentId', value: '2' },
          { label: 'machine', value: 'MACBOOK' },
        ],
        // RUNG 2 gated proposals — real endpoint/message shapes, exercised
        // end-to-end below (tap -> confirm -> mock host receives it).
        proposedActions: [
          {
            verb: 'kill',
            label: 'KILL agent 2 (pid 812) on MACBOOK',
            params: { machine: 'MACBOOK', pid: 812 },
          },
          {
            verb: 'focus',
            label: 'FOCUS agent 2 (pid 812) on MACBOOK',
            params: { machine: 'MACBOOK', pid: 812 },
          },
          {
            verb: 'dispatch-nudge',
            label:
              'DISPATCH NUDGE on MACBOOK: check agent 2, blocked on: Approve: apply migration 0042? (y/n)',
            params: {
              machine: 'MACBOOK',
              cwd: '/Users/dev/war-room',
              provider: 'claude',
              prompt:
                'Agent 2 on MACBOOK (/Users/dev/war-room) has been blocked 5m, waiting for: "Approve: apply migration 0042? (y/n)". Please check on it, make the requested decision if you safely can, and unblock it.',
            },
          },
        ],
      },
      {
        id: 'dispatch-waste-failed',
        kind: 'dispatch-waste',
        severity: 'warn',
        summary: 'a dispatch on MACBOOK exited nonzero',
        detail: 'exitCode: 1',
        receipts: [{ label: 'machine', value: 'MACBOOK' }],
        proposedActions: [
          {
            verb: 'requeue',
            label: 'REQUEUE: fix the flaky test on MACBOOK',
            params: { reworkId: 'rework-1' },
          },
        ],
      },
    ],
  },
  // T3 rung 3: default fixture world is a shipped-empty whitelist —
  // exercised as its own honest OFF-state assertion below.
  '/api/ops/auto': {
    actions: { 'requeue-failed-dispatch': { enabled: false } },
    receipts: [],
    whitelistLine: 'AUTO: OFF — whitelist empty',
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
  // GRAPH SEARCH (4C, T7 first slice) — default fixture world is an
  // available-but-empty store; tests that need matches/resolved override
  // via serveV3Dist's graphSearchOverride option below.
  '/api/graph/search': { available: true, query: '', matches: [] },
};

interface StaticHost {
  url: string;
  close: () => Promise<void>;
  /** Every WS frame the mock host received from the client, in order —
   *  excludes the initial webviewReady handshake. Used to assert the
   *  OPS REVIEW panel's FOCUS/DISPATCH-NUDGE proposals fire the exact
   *  same dispatchRequest shape CallModal/AgentDrawer already send. */
  receivedMessages: Record<string, unknown>[];
  /** HTTP POSTs the mock host received (path only) — used to assert the
   *  T5 fleet controls RELEASE button fires the real route. */
  receivedHttpPosts: { path: string }[];
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

async function serveV3Dist(
  options: {
    stopAllFails?: boolean;
    killOutcome?: 'killed' | 'denied';
    redispatchFails?: boolean;
    /** T3 rung 3: override REST_JSON's default AUTO-OFF fixture, e.g. an
     *  enabled whitelist with real receipts. */
    autoStatusOverride?: unknown;
    /** T5 fleet controls — opts a test INTO a live GET /api/dispatch/machines
     *  response (the suite default deliberately leaves it unmocked so the
     *  CALL modal's honest "NO RUNNERS" gate is exercised for real — see
     *  file header). Only set this for a test that needs the CALL modal's
     *  provider form to actually render. */
    dispatchMachinesOverride?: unknown;
    /** T5 fleet controls — extra dispatchUpdate broadcasts pushed right
     *  after the webviewReady script, to seed CAPPED/HELD tray chips. */
    extraDispatchUpdates?: object[];
    /** Any other extra broadcasts pushed right after the webviewReady
     *  script (e.g. T2/T4 tests seeding agentPollState.waitingFor so the
     *  ANSWER composer's option parser has real text to work with). */
    extraMessages?: object[];
    /** T2/T4 remote-answer plane — advertises agent 1 as `managed: true`
     *  in the existingAgents script (the board's only license to render
     *  ANSWER). Defaults false — agent 1 is DESK-only unless a test opts in. */
    agentManaged?: boolean;
    /** T2/T4 remote-answer plane — GET /api/agents/answer/:id outcome for
     *  the answer this suite's POST route mints. */
    answerOutcome?: 'delivered' | 'denied';
    answerDenyReason?: string;
    /** T2/T4 remote-answer plane — canned GET /api/agents/answers receipts. */
    answerReceiptsOverride?: unknown[];
    /** GRAPH SEARCH (4C) — overrides every GET /api/graph/search response
     *  regardless of query string, so a single test can exercise the
     *  NO-GRAPH honest state or a matches+resolved payload. */
    graphSearchOverride?: unknown;
    /** INBOX (v4 T7 slice 2) — overrides REST_JSON's default GET
     *  /api/inbox fixture, e.g. the honest available:false state. */
    inboxOverride?: unknown;
  } = {},
): Promise<StaticHost> {
  if (!fs.existsSync(path.join(V3_DIST, 'index.html'))) {
    throw new Error(`webview-v3 not built at ${V3_DIST}. Run 'npm run build:webview-v3' first.`);
  }
  const port = await getFreePort();
  const receivedMessages: Record<string, unknown>[] = [];
  const receivedHttpPosts: { path: string }[] = [];
  const killRequestId = 'kill-req-1';
  const answerRequestId = 'answer-req-1';
  const server = http.createServer((req, res) => {
    const requestPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const requestQuery = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');

    // v4 T7 routine inbox tray — the one fixture entry the panel opens by
    // default (routine=summary, file=2026-07-10-digest.md, per
    // REST_JSON['/api/inbox']'s newest fixture row above).
    if (
      requestPath === '/api/inbox/content' &&
      requestQuery.get('routine') === 'summary' &&
      requestQuery.get('file') === '2026-07-10-digest.md'
    ) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content: '# Daily digest — 2026-07-10\n\nsome digest body\n' }));
      return;
    }

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
    // OPS REVIEW rung-2 proposals — the exact real endpoints being reused
    // (net/killAgent.ts's requestKill/pollKillOutcome, and the pre-existing
    // /api/rework/:id/redispatch route — zero new server capability).
    if (requestPath === '/api/agents/kill' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: killRequestId }));
      return;
    }
    if (requestPath === `/api/agents/kill/${killRequestId}` && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (options.killOutcome === 'denied') {
        res.end(JSON.stringify({ status: 'denied', reason: 'no runner replied' }));
      } else {
        res.end(JSON.stringify({ status: 'killed' }));
      }
      return;
    }
    // T2/T4 remote-answer plane — same "canned response, no body parsing
    // needed" tolerance as the KILL routes above (the drawer's exact
    // request shape is asserted via the rendered confirm-step text, not a
    // captured POST body).
    if (requestPath === '/api/agents/answer' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: answerRequestId }));
      return;
    }
    if (requestPath === `/api/agents/answer/${answerRequestId}` && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (options.answerOutcome === 'denied') {
        res.end(JSON.stringify({ status: 'denied', reason: options.answerDenyReason }));
      } else {
        res.end(JSON.stringify({ status: options.answerOutcome ?? 'delivered' }));
      }
      return;
    }
    if (requestPath === '/api/agents/answers' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ answers: options.answerReceiptsOverride ?? [] }));
      return;
    }
    if (requestPath === '/api/rework/rework-1/redispatch' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (options.redispatchFails) {
        res.end(JSON.stringify({ ok: false, reason: 'not-piled' }));
      } else {
        res.end(JSON.stringify({ ok: true, dispatchId: 'd-99' }));
      }
      return;
    }
    if (requestPath === '/api/graph/search' && options.graphSearchOverride !== undefined) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(options.graphSearchOverride));
      return;
    }
    if (requestPath === '/api/inbox' && options.inboxOverride !== undefined) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(options.inboxOverride));
      return;
    }
    if (requestPath === '/api/ops/auto' && options.autoStatusOverride !== undefined) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(options.autoStatusOverride));
      return;
    }
    if (
      requestPath === '/api/dispatch/machines' &&
      options.dispatchMachinesOverride !== undefined
    ) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(options.dispatchMachinesOverride));
      return;
    }
    // T5 fleet controls, DAILY FLEET SPEND CEILING — the explicit override.
    if (/^\/api\/dispatch\/[^/]+\/release$/.test(requestPath) && req.method === 'POST') {
      receivedHttpPosts.push({ path: requestPath });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
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
        const message = JSON.parse(data.toString()) as { type?: string } & Record<string, unknown>;
        if (message.type === 'webviewReady') {
          const script: object[] = [
            {
              type: 'existingAgents',
              agents: [1],
              folderNames: { '1': 'war-room' },
              externalAgents: {},
              machines: { '1': 'MACBOOK' },
              providers: { '1': 'claude' },
              pids: { '1': 4242 },
              // T2/T4 remote-answer plane — the board's ONLY license to
              // render ANSWER; false (agent absent from the map) is the
              // honest default every other test in this suite relies on.
              ...(options.agentManaged ? { managed: { '1': true } } : {}),
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
          for (const extra of options.extraDispatchUpdates ?? []) {
            socket.send(JSON.stringify(extra));
          }
          for (const extra of options.extraMessages ?? []) {
            socket.send(JSON.stringify(extra));
          }
        } else {
          receivedMessages.push(message);
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
    receivedMessages,
    receivedHttpPosts,
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
        'ops',
        'graph-search',
        'inbox',
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

      // SHIFT: real /api/shift scorecard, plus the T3 Ops Advisor's
      // compact opsReview fold (top finding + severity counts).
      await page.getByTestId('dock-shift').click();
      await expect(page.getByTestId('shift-panel')).toContainText('4 completed');
      await expect(page.getByTestId('shift-efficiency')).toContainText('LEAN');
      await expect(page.getByTestId('shift-ops-line')).toContainText(
        'agent 2 blocked 5m on MACBOOK',
      );
      await expect(page.getByTestId('shift-ops-line')).toContainText('1 warn');
      // T3 rung 3: SHIFT fold's honest auto-action count — zero on this
      // fixture's shipped-empty whitelist.
      await expect(page.getByTestId('shift-auto-line')).toContainText('0 auto-actions today');
      // v4 T7 "SHIFT absorbs morning": the MORNING fold's digest summary +
      // todo top-3, both sourced from the same GET /api/briefing fixture.
      await expect(page.getByTestId('shift-morning-digest')).toContainText(
        'vault-health: 2 issues · project-pulse: 1 flagged',
      );
      await expect(page.getByTestId('shift-morning-todo')).toContainText('ship the panel ports');
      await page.getByTestId('modal-close').click();

      // OPS REVIEW (T3 self-healing ladder, rung 1): real /api/ops/review
      // findings list, receipts expand per-row (one-tap-real), shape+label
      // severity glyph (colorblind rule).
      await page.getByTestId('dock-ops').click();
      await expect(page.getByTestId('ops-review-panel')).toBeVisible();
      const finding = page.getByTestId('ops-finding').first();
      await expect(finding).toContainText('WARN');
      await expect(finding).toContainText('agent 2 blocked 5m on MACBOOK');
      await expect(page.getByTestId('ops-finding-detail')).toHaveCount(0); // collapsed by default
      await page.getByTestId('ops-finding-toggle').first().click();
      await expect(page.getByTestId('ops-finding-detail')).toBeVisible();
      await expect(page.getByTestId('ops-finding-receipts')).toContainText('agentId: 2');
      // T3 rung 3: AUTO section renders the honest OFF state — a fresh
      // deploy's shipped-empty whitelist, never a fabricated "on".
      await expect(page.getByTestId('ops-auto-whitelist-line')).toHaveText(
        'AUTO: OFF — whitelist empty',
      );
      await expect(page.getByTestId('ops-auto-receipts')).toHaveCount(0);
      await page.getByTestId('modal-close').click();

      // BRIEFING: real /api/briefing todo + gate.
      await page.getByTestId('dock-briefing').click();
      await expect(page.getByTestId('briefing-panel')).toContainText('ship the panel ports');
      await expect(page.getByTestId('briefing-panel')).toContainText('stage-3');
      await page.getByTestId('modal-close').click();

      // INBOX (v4 T7 slice 2): newest-first routine list, one-tap open
      // renders the real markdown body inline.
      await page.getByTestId('dock-inbox').click();
      await expect(page.getByTestId('inbox-panel')).toBeVisible();
      const entries = page.getByTestId('inbox-entry');
      await expect(entries).toHaveCount(2);
      await expect(entries.first()).toContainText('summary');
      await expect(entries.first()).toContainText('2026-07-10-digest.md');
      await entries.first().click();
      await expect(page.getByTestId('inbox-content')).toContainText('some digest body');
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

  test('agent drawer header (✕ CLOSE) renders below the HUD and actually closes — never buried under the z-60 strip', async ({
    browser,
  }) => {
    // Regression (real-device acceptance, 2026-07-10): the drawer was
    // anchored at the app root with top:0, so on desktop its header row —
    // including ✕ CLOSE — rendered underneath the HUD (z-index 60) and the
    // drawer could not be dismissed. The drawer now lives inside .surfaces
    // (the below-HUD region). Before the fix this test fails twice over:
    // toBeInViewport on an obscured button, then the intercepted click.
    const host = await serveV3Dist();
    const context = await browser.newContext({ viewport: VIEWPORT });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/?agentId=1`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });

      const drawer = page.getByTestId('agent-drawer');
      await expect(drawer).toBeVisible({ timeout: 20_000 });

      const close = page.getByTestId('drawer-close');
      await expect(close).toBeInViewport();
      // The close button must clear the HUD strip entirely.
      const hudBox = await page.locator('.hud').boundingBox();
      const closeBox = await close.boundingBox();
      expect(hudBox).not.toBeNull();
      expect(closeBox).not.toBeNull();
      expect(closeBox!.y).toBeGreaterThanOrEqual(hudBox!.y + hudBox!.height);

      await close.click();
      await expect(page.getByTestId('agent-drawer')).toHaveCount(0);
    } finally {
      await context.close();
      await host.close();
    }
  });

  test('T2/T4 remote-answer plane: unmanaged agent stays DESK-only; a managed agent gets ANSWER, one-tap options, verbatim confirm, and DELIVERING…→✓ DELIVERED', async ({
    browser,
  }) => {
    const host = await serveV3Dist({ agentManaged: false });
    const context = await browser.newContext({ viewport: VIEWPORT });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/?agentId=1`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });
      await expect(page.getByTestId('agent-drawer')).toBeVisible({ timeout: 20_000 });

      // Unmanaged (the honest default) — DESK-only explainer, no composer.
      await expect(page.getByTestId('answer-desk-only')).toBeVisible();
      await expect(page.getByTestId('answer-composer')).toHaveCount(0);
    } finally {
      await context.close();
      await host.close();
    }
  });

  test('T2/T4 remote-answer plane: managed agent — one-tap options prefill, confirm shows verbatim text, send reaches DELIVERING…→✓ DELIVERED, receipts render', async ({
    browser,
  }) => {
    const host = await serveV3Dist({
      agentManaged: true,
      answerOutcome: 'delivered',
      answerReceiptsOverride: [
        {
          id: 'answer-req-0',
          machine: 'MACBOOK',
          managedSessionRef: 'd-1',
          text: 'an earlier answer',
          status: 'delivered',
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      extraMessages: [
        {
          type: 'agentPollState',
          id: 1,
          state: 'blocked',
          waitingFor: 'Approve the migration?\n1. Yes, apply it\n2. No, skip it',
          ageMs: 0,
        },
      ],
    });
    const context = await browser.newContext({ viewport: VIEWPORT });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/?agentId=1`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });
      await expect(page.getByTestId('agent-drawer')).toBeVisible({ timeout: 20_000 });

      // Managed — the honest explainer is gone, the real composer renders.
      await expect(page.getByTestId('answer-desk-only')).toHaveCount(0);
      const composer = page.getByTestId('answer-composer');
      await expect(composer).toBeVisible();

      // Pre-existing receipt renders verbatim on load (one-tap-real).
      await expect(page.getByTestId('answer-receipt')).toContainText('an earlier answer');
      await expect(page.getByTestId('answer-receipt')).toContainText('DELIVERED');

      // Defensively parsed AskUserQuestion options render as one-tap choices.
      const options = page.getByTestId('answer-option');
      await expect(options).toHaveCount(2);
      await options.filter({ hasText: 'Yes, apply it' }).click();

      // Verbatim-prompt discipline: the confirm step shows the EXACT text,
      // nothing summarized/truncated, before anything is sent.
      await expect(page.getByTestId('answer-confirm-text')).toHaveText('Yes, apply it');

      await page.getByTestId('answer-confirm-send').click();
      // No fake states: DELIVERING… while the outcome poll is in flight.
      await expect(page.getByTestId('answer-status')).toContainText('DELIVERING', {
        timeout: 2_000,
      });
      await expect(page.getByTestId('answer-status')).toContainText('✓ DELIVERED', {
        timeout: 5_000,
      });
    } finally {
      await context.close();
      await host.close();
    }
  });

  test('T2/T4 remote-answer plane: a runner deny renders ✗ FAILED with the reason honestly, never an optimistic success', async ({
    browser,
  }) => {
    const host = await serveV3Dist({
      agentManaged: true,
      answerOutcome: 'denied',
      answerDenyReason: 'session-dead',
    });
    const context = await browser.newContext({ viewport: VIEWPORT });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/?agentId=1`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });
      await expect(page.getByTestId('answer-composer')).toBeVisible({ timeout: 20_000 });

      await page.getByTestId('answer-text').fill('please retry the migration');
      await page.getByTestId('answer-next').click();
      await expect(page.getByTestId('answer-confirm-text')).toHaveText(
        'please retry the migration',
      );
      await page.getByTestId('answer-confirm-send').click();
      await expect(page.getByTestId('answer-status')).toContainText('✗ FAILED — session-dead', {
        timeout: 5_000,
      });
    } finally {
      await context.close();
      await host.close();
    }
  });

  test('T4 session launch: CALL modal PERSISTENT SESSION mode disables machines without the sessions capability and sends action:session with no timeout field', async ({
    browser,
  }) => {
    const host = await serveV3Dist({
      dispatchMachinesOverride: [
        {
          machine: 'MACBOOK',
          providers: ['claude'],
          roots: ['/Users/dev/war-room'],
          focus: true,
          sessions: true,
        },
        {
          machine: 'NEXUS',
          providers: ['claude'],
          roots: ['/data'],
          focus: false,
          sessions: false,
        },
      ],
    });
    const context = await browser.newContext({ viewport: VIEWPORT });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });

      await page.getByTestId('dock-call').click();
      await expect(page.getByTestId('call-modal')).toBeVisible();
      await page.getByTestId('call-mode-session').click();

      const machineSelect = page.locator('select').first();
      // The option itself is disabled (native <option disabled>) — the
      // honest "sessions not enabled" label, not an omission.
      await expect(machineSelect.locator('option', { hasText: 'NEXUS' })).toHaveAttribute(
        'disabled',
        '',
      );
      await expect(machineSelect.locator('option', { hasText: 'NEXUS' })).toContainText(
        'sessions not enabled',
      );
      await expect(machineSelect.locator('option', { hasText: 'MACBOOK' })).not.toHaveAttribute(
        'disabled',
        '',
      );

      await machineSelect.selectOption('MACBOOK');
      await expect(page.getByTestId('call-session-disabled-hint')).toHaveCount(0);
      // No TIME CAP field in session mode.
      await expect(page.getByTestId('call-timeout-input')).toHaveCount(0);

      await page.locator('select').nth(1).selectOption('claude'); // PROVIDER
      await page.locator('select').nth(2).selectOption('/Users/dev/war-room'); // PROJECT

      await page.getByTestId('call-submit').click();
      const sessionMessage = host.receivedMessages.find(
        (m) => m.type === 'dispatchRequest' && m.action === 'session',
      );
      expect(sessionMessage).toBeDefined();
      expect(sessionMessage?.machine).toBe('MACBOOK');
      expect(sessionMessage?.timeoutSec).toBeUndefined();
    } finally {
      await context.close();
      await host.close();
    }
  });

  test('4B: CALL modal SKILL dropdown prefixes the prompt and PERMISSION plan mode adds permissionMode to the outgoing dispatchRequest', async ({
    browser,
  }) => {
    const host = await serveV3Dist({
      dispatchMachinesOverride: [
        {
          machine: 'MACBOOK',
          providers: ['claude'],
          roots: ['/Users/dev/war-room'],
          focus: true,
          sessions: true,
          skills: ['plan-review', 'code-review'],
        },
        {
          machine: 'NEXUS',
          providers: ['claude'],
          roots: ['/data'],
          focus: false,
          sessions: false,
          skills: [],
        },
      ],
    });
    const context = await browser.newContext({ viewport: VIEWPORT });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });

      await page.getByTestId('dock-call').click();
      await expect(page.getByTestId('call-modal')).toBeVisible();

      const machineSelect = page.locator('select').first();
      await machineSelect.selectOption('MACBOOK');
      await page.locator('select').nth(1).selectOption('claude'); // PROVIDER
      await page.locator('select').nth(2).selectOption('/Users/dev/war-room'); // PROJECT

      // Machine advertises skills -> the dropdown is present, sorted,
      // "— none —" first.
      const skillSelect = page.getByTestId('call-skill-select');
      await expect(skillSelect).toBeVisible();
      const optionTexts = await skillSelect.locator('option').allTextContents();
      expect(optionTexts).toEqual(['— none —', 'code-review', 'plan-review']);

      const promptBox = page.getByPlaceholder('What should this session do?');
      await promptBox.fill('fix the bug');

      // Picking a skill visibly prefixes the prompt textarea.
      await skillSelect.selectOption('plan-review');
      await expect(promptBox).toHaveValue('/plan-review fix the bug');

      // Switching picks replaces the prefix, not stacks it.
      await skillSelect.selectOption('code-review');
      await expect(promptBox).toHaveValue('/code-review fix the bug');

      // Picking "— none —" removes the prefix, leaving user text intact.
      await skillSelect.selectOption('');
      await expect(promptBox).toHaveValue('fix the bug');

      // Re-insert for the PLAN mode send below.
      await skillSelect.selectOption('plan-review');

      // PERMISSION defaults to DEFAULT; switching to PLAN shows the hint.
      await expect(page.getByTestId('call-permission-default')).toBeVisible();
      await expect(page.getByTestId('call-permission-plan-hint')).toHaveCount(0);
      await page.getByTestId('call-permission-plan').click();
      await expect(page.getByTestId('call-permission-plan-hint')).toContainText(
        'Agent will propose a plan and block for approval — answer it from the drawer.',
      );

      await page.getByTestId('call-submit').click();
      const planMessage = host.receivedMessages.find(
        (m) => m.type === 'dispatchRequest' && m.action === 'dispatch',
      );
      expect(planMessage).toBeDefined();
      expect(planMessage?.permissionMode).toBe('plan');
      expect(planMessage?.prompt).toBe('/plan-review fix the bug');
    } finally {
      await context.close();
      await host.close();
    }
  });

  test('4B: a machine advertising no skills shows no SKILL dropdown, and DEFAULT permission omits the field entirely', async ({
    browser,
  }) => {
    const host = await serveV3Dist({
      dispatchMachinesOverride: [
        {
          machine: 'NEXUS',
          providers: ['claude'],
          roots: ['/data'],
          focus: false,
          sessions: false,
          skills: [],
        },
      ],
    });
    const context = await browser.newContext({ viewport: VIEWPORT });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });

      await page.getByTestId('dock-call').click();
      await expect(page.getByTestId('call-modal')).toBeVisible();

      await page.locator('select').first().selectOption('NEXUS');
      await page.locator('select').nth(1).selectOption('claude'); // PROVIDER
      await expect(page.getByTestId('call-skill-select')).toHaveCount(0);
      // PERMISSION toggle still renders (claude provider) — assert DEFAULT
      // send omits permissionMode from the wire payload entirely.
      await expect(page.getByTestId('call-permission-toggle')).toBeVisible();

      await page.locator('select').nth(2).selectOption('/data'); // PROJECT
      await page.getByPlaceholder('What should this session do?').fill('quick check');
      await page.getByTestId('call-submit').click();

      const defaultMessage = host.receivedMessages.find(
        (m) => m.type === 'dispatchRequest' && m.action === 'dispatch',
      );
      expect(defaultMessage).toBeDefined();
      expect(defaultMessage && 'permissionMode' in defaultMessage).toBe(false);
    } finally {
      await context.close();
      await host.close();
    }
  });

  test('OPS REVIEW rung 2: each gated proposal arms a confirm step, then fires the exact reused endpoint/message per verb', async ({
    browser,
  }) => {
    const host = await serveV3Dist({ killOutcome: 'killed' });
    const context = await browser.newContext({ viewport: VIEWPORT });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });

      await page.getByTestId('dock-ops').click();
      await expect(page.getByTestId('ops-review-panel')).toBeVisible();
      const findingToggles = page.getByTestId('ops-finding-toggle');
      await findingToggles.nth(0).click(); // blocked-age-2 — kill/focus/dispatch-nudge
      await findingToggles.nth(1).click(); // dispatch-waste-failed — requeue

      // KILL — first tap ARMS the confirm step, showing exactly what will
      // happen; nothing has been sent yet.
      const killTap = page.getByTestId('ops-proposal-tap-kill');
      await killTap.click();
      await expect(page.getByTestId('ops-proposal-confirm')).toContainText(
        'KILL agent 2 (pid 812) on MACBOOK',
      );
      expect(host.receivedMessages.filter((m) => m.type === 'dispatchRequest')).toHaveLength(0);
      await page.getByTestId('ops-proposal-confirm-kill').click();
      // Fires net/killAgent.ts's requestKill -> the mock's ok:true+id, then
      // polls GET /api/agents/kill/:id (1s cadence) until a real terminal
      // status — never an optimistic "killed" before the poll confirms it.
      await expect(killTap).toHaveText('✓ KILLED', { timeout: 5_000 });

      // FOCUS — same confirm discipline, then the real dispatchRequest
      // action:'focus' WS message (v1's exact shape, ported to v3).
      const focusTap = page.getByTestId('ops-proposal-tap-focus');
      await focusTap.click();
      await page.getByTestId('ops-proposal-confirm-focus').click();
      // No ack exists on the wire for focus anywhere in the system — "SENT"
      // is the honest terminal state, never upgraded to a fabricated "done".
      await expect(focusTap).toHaveText('→ FOCUS SENT');
      expect(
        host.receivedMessages.some(
          (m) =>
            m.type === 'dispatchRequest' &&
            m.action === 'focus' &&
            m.machine === 'MACBOOK' &&
            m.pid === 812,
        ),
      ).toBe(true);

      // DISPATCH-NUDGE — same confirm discipline, then the exact
      // CallModal.tsx dispatchRequest/action:'dispatch' shape, pre-filled
      // from the finding's verbatim waitingFor/machine/cwd/provider.
      const nudgeTap = page.getByTestId('ops-proposal-tap-dispatch-nudge');
      await nudgeTap.click();
      await page.getByTestId('ops-proposal-confirm-dispatch-nudge').click();
      const nudgeMessage = host.receivedMessages.find(
        (m) => m.type === 'dispatchRequest' && m.action === 'dispatch',
      );
      expect(nudgeMessage).toBeDefined();
      expect(nudgeMessage?.machine).toBe('MACBOOK');
      expect(nudgeMessage?.provider).toBe('claude');
      expect(nudgeMessage?.cwd).toBe('/Users/dev/war-room');
      expect(nudgeMessage?.prompt).toContain('Agent 2 on MACBOOK');
      expect(nudgeMessage?.prompt).toContain('Approve: apply migration 0042? (y/n)');
      expect(typeof nudgeMessage?.requestId).toBe('string');

      // REQUEUE — hits the pre-existing /api/rework/:id/redispatch route
      // verbatim (zero new server capability); the response is synchronous
      // so the outcome renders immediately, no polling needed.
      const requeueTap = page.getByTestId('ops-proposal-tap-requeue');
      await requeueTap.click();
      await expect(page.getByTestId('ops-proposal-confirm')).toContainText(
        'REQUEUE: fix the flaky test on MACBOOK',
      );
      await page.getByTestId('ops-proposal-confirm-requeue').click();
      await expect(requeueTap).toHaveText('✓ REQUEUED');
    } finally {
      await context.close();
      await host.close();
    }
  });

  test('OPS REVIEW rung 2: CANCEL backs out of the confirm step without firing anything; a denied KILL renders ✗ FAILED honestly', async ({
    browser,
  }) => {
    const host = await serveV3Dist({ killOutcome: 'denied' });
    const context = await browser.newContext({ viewport: VIEWPORT });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });

      await page.getByTestId('dock-ops').click();
      await page.getByTestId('ops-finding-toggle').first().click();

      const killTap = page.getByTestId('ops-proposal-tap-kill');
      await killTap.click();
      await expect(page.getByTestId('ops-proposal-confirm')).toBeVisible();
      await page.getByTestId('ops-proposal-cancel-kill').click();
      // Back to idle — the original proposal label, nothing sent.
      await expect(killTap).toHaveText('KILL agent 2 (pid 812) on MACBOOK');
      expect(host.receivedMessages.filter((m) => m.type === 'dispatchRequest')).toHaveLength(0);

      await killTap.click();
      await page.getByTestId('ops-proposal-confirm-kill').click();
      // The runner denies it — never rendered as success.
      await expect(killTap).toHaveText(/✗ FAILED — no runner replied/, { timeout: 5_000 });
    } finally {
      await context.close();
      await host.close();
    }
  });

  test('OPS REVIEW AUTO section: an enabled whitelist with real receipts renders the exact server-provided line and receipt content honestly', async ({
    browser,
  }) => {
    const host = await serveV3Dist({
      autoStatusOverride: {
        actions: {
          'requeue-failed-dispatch': {
            enabled: true,
            params: { maxPerId: 2, cooldownMs: 600_000 },
          },
        },
        whitelistLine: 'AUTO: requeue-failed-dispatch ON (cap 2, cooldown 10m)',
        receipts: [
          {
            ts: Date.parse('2026-07-10T12:00:00Z'),
            actionKind: 'requeue-failed-dispatch',
            cause: {
              findingId: 'dispatch-waste-failed',
              receipts: [{ label: 'dispatch abc12345', value: 'MACBOOK · claude · exit 1' }],
            },
            outcome: { ok: true, detail: 'requeued as dispatch d-42' },
            undo: 'none — the new dispatch can be killed like any manual dispatch once it starts',
          },
          {
            ts: Date.parse('2026-07-10T12:05:00Z'),
            actionKind: 'requeue-failed-dispatch',
            cause: { findingId: 'dispatch-waste-failed', receipts: [] },
            outcome: { ok: false, detail: 'ringing cap reached' },
            undo: 'none — the new dispatch can be killed like any manual dispatch once it starts',
          },
        ],
      },
    });
    const context = await browser.newContext({ viewport: VIEWPORT });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });

      await page.getByTestId('dock-ops').click();
      await expect(page.getByTestId('ops-auto-whitelist-line')).toHaveText(
        'AUTO: requeue-failed-dispatch ON (cap 2, cooldown 10m)',
      );
      const receipts = page.getByTestId('ops-auto-receipt');
      await expect(receipts).toHaveCount(2);
      const first = receipts.nth(0);
      await expect(first).toHaveAttribute('data-outcome', 'ok');
      await expect(first).toContainText('requeued as dispatch d-42');
      await expect(first).toContainText('dispatch-waste-failed');
      const second = receipts.nth(1);
      await expect(second).toHaveAttribute('data-outcome', 'failed');
      await expect(second).toContainText('ringing cap reached');
    } finally {
      await context.close();
      await host.close();
    }
  });

  test('T5 fleet controls: CAPPED and HELD dispatch tray chips render honestly, RELEASE fires the real route, and the CALL modal shows the rate-limit reset hint', async ({
    browser,
  }) => {
    const host = await serveV3Dist({
      dispatchMachinesOverride: [
        { machine: 'MACBOOK', providers: ['claude'], roots: ['/Users/dev/war-room'], focus: false },
      ],
      extraDispatchUpdates: [
        {
          type: 'dispatchUpdate',
          id: 'd-capped',
          action: 'dispatch',
          status: 'capped',
          machine: 'MACBOOK',
          provider: 'claude',
          promptPreview: 'runs too long',
          timeoutSec: 300,
        },
        {
          type: 'dispatchUpdate',
          id: 'd-held',
          action: 'dispatch',
          status: 'queued-budget',
          machine: 'MACBOOK',
          provider: 'claude',
          promptPreview: 'held for budget',
          reason: 'HELD — daily ceiling 1000 reached, spend 1200',
        },
        // A fresher budgetUpdate than the default script's — carries a real
        // fiveHourResetsAt so the CALL modal's hint line has data to render.
        {
          type: 'budgetUpdate',
          claude: {
            fiveHourUsedPct: 75,
            sevenDayUsedPct: 20,
            stale: false,
            receivedAt: Date.now(),
            fiveHourResetsAt: Date.now() + 45 * 60_000,
          },
          codex: { weeklyCap: null, weeklyUsed: 0, estimatedPct: null },
        },
      ],
    });
    const context = await browser.newContext({ viewport: VIEWPORT });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });

      const tray = page.getByTestId('dispatch-tray');
      await expect(tray).toBeVisible();
      const chips = page.getByTestId('dispatch-chip');
      await expect(chips).toHaveCount(2);
      await expect(tray).toContainText('✗ CAPPED (300s)');
      await expect(tray).toContainText('⏸ HELD — HELD — daily ceiling 1000 reached, spend 1200');

      // RELEASE fires the real override route — never an optimistic local
      // flip (the chip stays HELD here since the mock host doesn't also
      // broadcast the resulting 'ringing' dispatchUpdate back).
      const releaseButton = page.getByTestId('dispatch-chip-release');
      await expect(releaseButton).toBeVisible();
      await releaseButton.click();
      await expect
        .poll(() => host.receivedHttpPosts.some((p) => p.path === '/api/dispatch/d-held/release'))
        .toBe(true);

      // CALL modal: with machines mocked, the provider form actually
      // renders (unlike the suite's default NO-RUNNERS gate test above) —
      // the real rate-limit reset hint next to the budget chip.
      await page.getByTestId('dock-call').click();
      await expect(page.getByTestId('call-modal')).toBeVisible();
      await page.locator('select').first().selectOption('MACBOOK');
      const providerSelect = page.locator('select').nth(1);
      await providerSelect.selectOption('claude');
      await expect(page.getByTestId('call-modal-reset-hint')).toContainText('5h window 75%');
      await expect(page.getByTestId('call-modal-reset-hint')).toContainText('resets in ~45m');
      await expect(page.getByTestId('call-modal-reset-hint')).toContainText('queue for reset?');

      // PER-DISPATCH TIME CAP field — an invalid value disables Send with
      // an honest inline reason, never silently dropped/clamped.
      await page.getByTestId('call-timeout-input').fill('-5');
      await expect(page.getByTestId('call-submit')).toBeDisabled();
      await page.getByTestId('call-timeout-input').fill('300');
      await expect(page.getByTestId('call-submit')).toBeDisabled(); // still needs project + prompt
    } finally {
      await context.close();
      await host.close();
    }
  });

  test('T6: terminal dispatch chips persist until DISMISS/CLEAR DONE, in-flight chips are never dismissible', async ({
    browser,
  }) => {
    const host = await serveV3Dist({
      extraDispatchUpdates: [
        {
          type: 'dispatchUpdate',
          id: 'd-ringing',
          action: 'dispatch',
          status: 'ringing',
          machine: 'MACBOOK',
          provider: 'claude',
        },
        {
          type: 'dispatchUpdate',
          id: 'd-exited',
          action: 'dispatch',
          status: 'exited',
          machine: 'MACBOOK',
          provider: 'claude',
          exitCode: 0,
        },
        {
          type: 'dispatchUpdate',
          id: 'd-denied',
          action: 'dispatch',
          status: 'denied',
          machine: 'NEXUS',
          provider: 'claude',
          reason: 'path-not-allowlisted',
        },
      ],
    });
    const context = await browser.newContext({ viewport: VIEWPORT });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });

      const tray = page.getByTestId('dispatch-tray');
      await expect(tray).toBeVisible();
      await expect(page.getByTestId('dispatch-chip')).toHaveCount(3);

      // In-flight (RINGING) never gets a DISMISS button.
      const ringingChip = tray.locator('[data-testid="dispatch-chip"]', {
        hasText: 'RINGING',
      });
      await expect(ringingChip.getByTestId('dispatch-chip-dismiss')).toHaveCount(0);

      // Both terminal chips (EXITED, DENIED) get their own DISMISS.
      await expect(tray.getByTestId('dispatch-chip-dismiss')).toHaveCount(2);
      await expect(tray.getByTestId('dispatch-clear-done')).toBeVisible();

      // Individually dismissing one terminal chip leaves the other + CLEAR
      // DONE behind (never auto-clears on its own — this is a real click).
      const exitedChip = tray.locator('[data-testid="dispatch-chip"]', { hasText: 'EXITED' });
      await exitedChip.getByTestId('dispatch-chip-dismiss').click();
      await expect(page.getByTestId('dispatch-chip')).toHaveCount(2);
      await expect(tray).toContainText('DENIED');
      await expect(tray).not.toContainText('EXITED');

      // CLEAR DONE bulk-dismisses the remaining terminal chip, leaving the
      // in-flight RINGING chip untouched.
      await tray.getByTestId('dispatch-clear-done').click();
      await expect(page.getByTestId('dispatch-chip')).toHaveCount(1);
      await expect(tray).toContainText('RINGING');
      await expect(tray.getByTestId('dispatch-clear-done')).toHaveCount(0);
    } finally {
      await context.close();
      await host.close();
    }
  });

  test('GRAPH SEARCH: store not mounted renders the honest NO GRAPH line, never an empty-but-plausible result', async ({
    browser,
  }) => {
    const host = await serveV3Dist({
      graphSearchOverride: { available: false, query: 'foo', matches: [] },
    });
    const context = await browser.newContext({ viewport: VIEWPORT });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });

      await page.getByTestId('dock-graph-search').click();
      await expect(page.getByTestId('graph-search-panel')).toBeVisible();
      await expect(page.getByTestId('graph-search-hint')).toBeVisible();

      await page.getByTestId('graph-search-input').fill('foo');
      await expect(page.getByTestId('graph-search-unavailable')).toContainText(
        '⊘ NO GRAPH — store not mounted on this deployment',
      );
      await expect(page.getByTestId('graph-search-matches')).toHaveCount(0);
    } finally {
      await context.close();
      await host.close();
    }
  });

  test('GRAPH SEARCH: matches render kind glyph + title, tapping a row re-queries the exact id, and resolved edges group by hop', async ({
    browser,
  }) => {
    const host = await serveV3Dist({
      graphSearchOverride: {
        available: true,
        query: 'ops',
        matches: [{ id: 'note-ops-review', kind: 'note', title: 'Ops Review Design' }],
        resolved: {
          node: { id: 'note-ops-review', kind: 'note', title: 'Ops Review Design' },
          edges: [
            {
              src: 'note-ops-review',
              dst: 'project-war-room',
              type: 'belongs-to',
              provenance: 'frontmatter',
              hop: 1,
            },
            {
              src: 'project-war-room',
              dst: 'mirror-war-room',
              type: 'mirrors',
              hop: 2,
            },
          ],
        },
      },
    });
    const context = await browser.newContext({ viewport: VIEWPORT });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });

      await page.getByTestId('dock-graph-search').click();
      await page.getByTestId('graph-search-input').fill('ops');

      const match = page.getByTestId('graph-search-match').first();
      await expect(match).toContainText('▤');
      await expect(match).toContainText('Ops Review Design');
      await expect(match).toContainText('note-ops-review');

      // Resolved block renders with hop-grouped edges — hop 1 before hop 2.
      const resolved = page.getByTestId('graph-search-resolved');
      await expect(resolved).toBeVisible();
      const hopGroups = page.getByTestId('graph-search-hop-group');
      await expect(hopGroups).toHaveCount(2);
      await expect(hopGroups.nth(0)).toContainText('[hop 1]');
      await expect(hopGroups.nth(0)).toContainText(
        'note-ops-review -belongs-to-> project-war-room',
      );
      await expect(hopGroups.nth(1)).toContainText('[hop 2]');
      await expect(hopGroups.nth(1)).toContainText('project-war-room -mirrors-> mirror-war-room');

      // Tapping the match row re-queries with the exact id.
      await match.click();
      await expect(page.getByTestId('graph-search-input')).toHaveValue('note-ops-review');
    } finally {
      await context.close();
      await host.close();
    }
  });

  test('INBOX: routines mount absent renders the honest NO INBOX SOURCE line, never an empty-but-plausible list', async ({
    browser,
  }) => {
    const host = await serveV3Dist({ inboxOverride: { available: false, entries: [] } });
    const context = await browser.newContext({ viewport: VIEWPORT });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });

      await page.getByTestId('dock-inbox').click();
      await expect(page.getByTestId('inbox-panel')).toBeVisible();
      await expect(page.getByTestId('inbox-unavailable')).toContainText(
        '⊘ NO INBOX SOURCE — routines mount not present on this deployment',
      );
      await expect(page.getByTestId('inbox-list')).toHaveCount(0);
    } finally {
      await context.close();
      await host.close();
    }
  });
});
