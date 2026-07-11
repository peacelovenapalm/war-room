import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { WebSocketServer, type WebSocket } from 'ws';

/**
 * T1 remote live-tail plane, S4 — end-to-end coverage that the v3 face
 * renders REAL remote-agent telemetry (drawer LIVE TAIL + TOKENS row)
 * once a transcript-tailer daemon streams it, and stays honestly NO DATA
 * for a remote machine with no tailer installed.
 *
 * webview-v3's client side is machine-agnostic by construction: the ring
 * id tailSubscribe/outputChunk key off is the numeric agent id (App.tsx's
 * drawer-open effect calls `manager.acquire('agent', String(agentId))`
 * unconditionally — see webview-v3/src/App.tsx around the "Drawer tail
 * subscription follows the open drawer" effect), and agentStore.ts's
 * agentTokenUsage reducer case has no machine branch either. So this spec
 * doesn't need a REAL tailer — mocking the SAME wire messages a real one
 * would produce (via POST /api/agents/output -> the server's existing
 * outputChunk/agentTokenUsage broadcasts) is sufficient to prove the v3
 * face renders them correctly for a remote (non-local-looking) machine
 * label, exactly like dpr.spec.ts's MOCK_SERVER_SCRIPT already does for
 * its own agent id 2 (this spec makes that coverage explicit and adds the
 * "live chunk after replay" + "second remote agent stays NO DATA" cases
 * dpr.spec.ts doesn't cover).
 *
 * Desktop viewport + mock-not-real-Claude WS host, same pattern as
 * panels.spec.ts (separate file, same rationale: never risk the PERMANENT
 * dpr.spec.ts mock host with unrelated additions).
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

interface RemoteTailHost {
  url: string;
  close: () => Promise<void>;
  /** Push one MORE outputChunk over the currently-connected socket, as if
   *  a real transcript-tailer's forwarded line just landed server-side
   *  after the initial ring replay. */
  pushLiveChunk: (agentId: string, seq: number, text: string) => void;
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

/**
 * Serves the built webview-v3 bundle with a scripted mock `/ws`.
 *
 * `script` is sent verbatim in response to `webviewReady`. `replay` maps
 * an agent id (as the wire carries it, i.e. a string) to the chunks
 * replayed the moment that agent's tail is subscribed — the same replay
 * semantics as server/src/clientMessageHandler.ts's tailSubscribe case.
 * An agent id absent from `replay` gets no reply at all (the honest
 * no-tailer-installed case: the server would have nothing retained
 * either, since no tailer ever POSTed to /api/agents/output for it).
 */
async function serveV3Dist(
  script: object[],
  replay: Record<string, string[]>,
): Promise<RemoteTailHost> {
  if (!fs.existsSync(path.join(V3_DIST, 'index.html'))) {
    throw new Error(`webview-v3 not built at ${V3_DIST}. Run 'npm run build:webview-v3' first.`);
  }
  const port = await getFreePort();
  const server = http.createServer((req, res) => {
    const requestPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    // /api/dispatch/machines and anything else fall through to 404 —
    // this spec never opens the CALL modal, so it's deliberately unmocked
    // (same posture as panels.spec.ts).
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

  let liveSocket: WebSocket | undefined;
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket) => {
    liveSocket = socket;
    socket.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as {
          type?: string;
          source?: string;
          id?: string;
        };
        if (message.type === 'webviewReady') {
          for (const serverMessage of script) socket.send(JSON.stringify(serverMessage));
        }
        if (message.type === 'tailSubscribe' && message.source === 'agent') {
          const chunks = message.id !== undefined ? replay[message.id] : undefined;
          chunks?.forEach((chunk, seq) => {
            socket.send(
              JSON.stringify({
                type: 'outputChunk',
                source: 'agent',
                id: message.id,
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
    pushLiveChunk: (agentId, seq, text) => {
      liveSocket?.send(
        JSON.stringify({
          type: 'outputChunk',
          source: 'agent',
          id: agentId,
          seq,
          stream: 'transcript',
          chunk: text,
          truncated: false,
        }),
      );
    },
  };
}

/** The TOKENS drawer row, scoped so the assertion can't accidentally match
 *  some other fact row. */
function tokensRow(page: import('@playwright/test').Page) {
  return page.getByTestId('drawer-row').filter({ hasText: 'TOKENS' });
}

test.describe('T1 remote live-tail plane — v3 drawer wiring (e2e)', () => {
  test('a remote agent streamed by a tailer: LIVE TAIL replays and appends live, TOKENS shows real numbers', async ({
    browser,
  }) => {
    const host = await serveV3Dist(
      [
        {
          type: 'agentCreated',
          id: 5,
          folderName: 'remote-tailed-project',
          machine: 'MACBOOK', // remote relative to this e2e page (opaque test client)
          provider: 'claude',
          sessionId: 'sess-remote-5',
        },
        { type: 'agentStatus', id: 5, status: 'active' },
        // A real tailer's forwarded assistant lines land as agentTokenUsage
        // (from the remote route's usage extraction) exactly like this.
        { type: 'agentTokenUsage', id: 5, inputTokens: 890, outputTokens: 210 },
      ],
      { '5': ['● Bash(npm test)\n'] },
    );
    const context = await browser.newContext({ viewport: VIEWPORT });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/?agentId=5`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });

      const drawer = page.getByTestId('agent-drawer');
      await expect(drawer).toBeVisible({ timeout: 20_000 });
      await expect(drawer).toContainText('MACBOOK');

      // Replay lands the moment the drawer's tailSubscribe reaches the mock.
      const log = page.getByTestId('tail-log');
      await expect(log).toContainText('Bash(npm test)', { timeout: 20_000 });

      // A live chunk (server-order seq 1, after the seq-0 replay) appends
      // without a page reload — this is the "appends live" half of the
      // design's wire contract (S2/S3's fan-out delivers exactly this
      // shape for a remote agent, no differently than a local one).
      host.pushLiveChunk('5', 1, 'Running 46 tests…\n');
      await expect(log).toContainText('Running 46 tests…', { timeout: 20_000 });
      // Both lines are retained, in order — nothing was replaced.
      await expect(log).toContainText('Bash(npm test)');

      // Real numbers, not the honest-absence render.
      await expect(tokensRow(page)).toContainText('890 in · 210 out');
      await expect(tokensRow(page)).not.toContainText('NO DATA');
    } finally {
      await context.close();
      await host.close();
    }
  });

  test('a remote agent with NO tailer installed: honest NO DATA, empty tail — never a fake zero measurement', async ({
    browser,
  }) => {
    // No agentTokenUsage message at all, and '6' is absent from the replay
    // map — exactly what the server ring/state look like for a session on
    // a machine that never had a tailer POST anything for it (opt-in
    // posture: no tailer installed = honestly absent, not a silent zero).
    const host = await serveV3Dist(
      [
        {
          type: 'agentCreated',
          id: 6,
          folderName: 'remote-untailed-project',
          machine: 'MINI',
          provider: 'claude',
          sessionId: 'sess-remote-6',
        },
        { type: 'agentStatus', id: 6, status: 'active' },
      ],
      {},
    );
    const context = await browser.newContext({ viewport: VIEWPORT });
    try {
      const page = await context.newPage();
      await page.goto(`${host.url}/?agentId=6`);
      await expect(page.getByTestId('hud-connection')).toHaveText('● LIVE', { timeout: 20_000 });

      const drawer = page.getByTestId('agent-drawer');
      await expect(drawer).toBeVisible({ timeout: 20_000 });
      await expect(drawer).toContainText('MINI');

      // Honest absence, not a permanent-looking "0 in · 0 out".
      await expect(tokensRow(page)).toContainText('— NO DATA (no transcript access)');

      // Subscribed (the drawer always acquires the tail), but nothing was
      // ever retained for this session — the empty-state message, not a
      // blank log that could be mistaken for "still loading".
      await expect(page.getByTestId('tail-log')).toContainText('NO OUTPUT YET');
    } finally {
      await context.close();
      await host.close();
    }
  });
});
