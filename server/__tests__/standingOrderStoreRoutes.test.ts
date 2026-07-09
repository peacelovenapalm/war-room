/**
 * Live E2E tests for standing orders (v2 mechanic G3, GAME-DESIGN.md §7.2/
 * §7.4) driven through the real HTTP round trip — plus the budget-pause
 * acceptance test, which spawns the REAL bin/needs-input-poller.mjs (not a
 * simulated forward call) against a hand-edited
 * ~/.pixel-agents/rate-limit-snapshot.json, exactly as the runbook
 * describes: hand-edit the file, let the poller forward it, then confirm a
 * due standing order skips with lastSkipReason:'budget-paused'.
 */

import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileAsync = promisify(execFile);

/** Repo-root-relative path to the real poller script, resolved from this
 *  test file's own location — never process.cwd(), which is `server/`
 *  when `npm test` runs from there (root package.json's test:server
 *  script), not the repo root where bin/ lives. */
const POLLER_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../bin/needs-input-poller.mjs',
);

let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

const { PixelAgentsServer } = await import('../src/server.js');
const { AgentStateStore } = await import('../src/agentStateStore.js');

function uniqueMachine(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`.toUpperCase();
}

describe('Standing order live E2E (real HTTP round trip)', () => {
  let server: InstanceType<typeof PixelAgentsServer>;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-standing-order-e2e-'));
    fs.mkdirSync(path.join(tmpBase, '.pixel-agents'), { recursive: true });
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

  it('creates an order, confirms first-fire (which dispatches immediately), then a manual CallModal-equivalent send succeeds regardless of budget state', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machine = uniqueMachine('MACBOOK');

    const createRes = await fetch(`http://127.0.0.1:${config.port}/api/standing-orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'nightly build',
        schedule: { kind: 'interval', everyMs: 3_600_000 },
        machine,
        provider: 'claude',
        cwd: '/tmp/proj',
        prompt: 'run the build',
      }),
    });
    const createBody = (await createRes.json()) as {
      ok: boolean;
      order: { id: string; needsFirstFireConfirm: boolean };
    };
    expect(createBody.ok).toBe(true);
    expect(createBody.order.needsFirstFireConfirm).toBe(true);

    // No budget snapshot exists yet (fail-safe-paused) — but confirmFirstFire
    // is a human-initiated conscious act, never budget-gated, same as a
    // manual CallModal send.
    const confirmRes = await fetch(
      `http://127.0.0.1:${config.port}/api/standing-orders/${createBody.order.id}/confirm-first-fire`,
      { method: 'POST' },
    );
    const confirmBody = (await confirmRes.json()) as { ok: boolean };
    expect(confirmBody.ok).toBe(true);

    const pollRes = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/poll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
        'X-Machine': machine,
      },
      body: JSON.stringify({ providers: ['claude'], roots: ['/tmp'], focus: false }),
    });
    const pollBody = (await pollRes.json()) as { pending: Array<{ prompt?: string }> };
    expect(pollBody.pending).toHaveLength(1); // the first-fire dispatch, unaffected by budget
    expect(pollBody.pending[0].prompt).toBe('run the build');

    // standingOrderStore is a process-wide singleton shared across every
    // test file in this worker (same convention dispatchRoutes.test.ts
    // relies on) — free this order's slot against the base cap=1 so it
    // doesn't starve the next describe block's own create() call.
    await fetch(
      `http://127.0.0.1:${config.port}/api/standing-orders/${createBody.order.id}/delete`,
      {
        method: 'POST',
      },
    );
  });
});

describe('Standing order budget-pause E2E (real poller spawn)', () => {
  let server: InstanceType<typeof PixelAgentsServer>;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-budget-pause-e2e-'));
    fs.mkdirSync(path.join(tmpBase, '.pixel-agents'), { recursive: true });
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

  it('a hand-edited stale rate-limit-snapshot.json, forwarded by the real poller, makes a due standing order skip with budget-paused', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machine = uniqueMachine('MACBOOK');

    // Confirm-first-fire an order so it's eligible for unattended tick()
    // firing, then push its due time into the past by directly editing the
    // persisted file (equivalent to "already fired a while ago, now due
    // again") — isolates this test from real-clock waiting.
    const createRes = await fetch(`http://127.0.0.1:${config.port}/api/standing-orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'hourly',
        schedule: { kind: 'interval', everyMs: 1_000 }, // due almost immediately
        machine,
        provider: 'claude',
        cwd: '/tmp/proj',
        prompt: 'go',
      }),
    });
    const createBody = (await createRes.json()) as { ok: boolean; order: { id: string } };
    const orderId = createBody.order.id;
    await fetch(
      `http://127.0.0.1:${config.port}/api/standing-orders/${orderId}/confirm-first-fire`,
      { method: 'POST' },
    );
    const beforePollRes = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/poll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
        'X-Machine': machine,
      },
      body: JSON.stringify({ providers: ['claude'], roots: ['/tmp'], focus: false }),
    });
    await beforePollRes.json();
    const listRes = await fetch(`http://127.0.0.1:${config.port}/api/standing-orders`);
    const orders = (await listRes.json()) as Array<{ id: string; lastFiredAt?: number }>;
    const beforeLastFiredAt = orders.find((o) => o.id === orderId)?.lastFiredAt;
    expect(beforeLastFiredAt).toBeDefined();

    // Hand-edit the REAL snapshot file — real field names verified against
    // statusline.js (five_hour.used_percentage, not a spelling like
    // fiveHourUsedPct), five_hour at the pause-triggering 95%.
    const snapshotPath = path.join(tmpBase, '.pixel-agents', 'rate-limit-snapshot.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify({
        five_hour: { used_percentage: 95, resets_at: Math.floor(Date.now() / 1000) + 3600 },
        seven_day: { used_percentage: 10, resets_at: Math.floor(Date.now() / 1000) + 86_400 },
      }),
    );

    // Let the REAL poller script forward it (not a simulated call) — one
    // real spawn, --once, pointed at this test's live server + isolated
    // HOME (the mocked os.homedir() only affects THIS process; the child
    // process needs its own HOME env override to see the same file).
    await execFileAsync(
      process.execPath,
      [
        POLLER_SCRIPT,
        '--url',
        `http://127.0.0.1:${config.port}`,
        '--machine',
        machine,
        '--cmd',
        'echo []',
        '--once',
      ],
      {
        env: { ...process.env, HOME: tmpBase, WAR_ROOM_TOKEN: config.token },
        timeout: 10_000,
      },
    );

    // Wait past the order's 1s interval, then let the real 60s-cadence
    // standingOrderTick effectively run by invoking the tick path directly
    // through the same code the server's own setInterval calls — the
    // server under test already has its own live standingOrderTick
    // interval registered at 60s, too slow for a fast test; poll the HTTP
    // state instead, which reflects the store the interval mutates.
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const { standingOrderStore } = await import('../src/standingOrderStore.js');
    const { budgetStore } = await import('../src/budgetStore.js');
    const { economyStore } = await import('../src/economyStore.js');
    const { employeeStore } = await import('../src/employeeStore.js');
    const { dispatchStore } = await import('../src/dispatchStore.js');

    // Confirm the forwarded snapshot actually reached budgetStore (proves
    // the real poller's forward succeeded) before asserting the tick effect.
    const budgetSnapshot = budgetStore.getSnapshot();
    expect(budgetSnapshot.claude.fiveHourUsedPct).toBe(95);

    standingOrderStore.tick(
      Date.now(),
      (_machine, provider) => budgetStore.isAutomationPaused(provider, economyStore.getPerkFlags()),
      (id) => employeeStore.resolveEmployeeDefaults(id),
      (input) => dispatchStore.enqueue(input),
    );

    const afterOrder = standingOrderStore.get(orderId);
    // KICKOFF v1.1 item 5: the real reason threads through end-to-end (real
    // poller -> real budgetStore -> tick()), not a generic 'budget-paused'
    // literal. 95% five_hour usage trips the 5h base threshold (70%).
    expect(afterOrder?.lastSkipReason).toBe('5h-threshold');
    expect(afterOrder?.lastFiredAt).toBe(beforeLastFiredAt); // unchanged
  });
});
