/**
 * Live E2E tests for dispatch chains (v2 mechanic G3, GAME-DESIGN.md §7.1)
 * driven through the real HTTP + poll/decide/status round trip — same
 * pattern as dispatchRoutes.test.ts's "a full poll -> decide -> status
 * round trip" test, extended to a real 2-step chain. No mocked-Application
 * shortcuts: a real Fastify server, a real chainStore/dispatchStore/
 * chainOrchestrator singleton wiring, and a simulated runner that polls,
 * decides (accept/deny against its own allowlist), and reports status over
 * the same authed channel bin/dispatch-runner.mjs would use.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Isolated temp HOME, same rationale as dispatchRoutes.test.ts.
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

interface PendingItem {
  id: string;
  prompt?: string;
  cwd?: string;
}

async function poll(port: number, token: string, machine: string): Promise<PendingItem[]> {
  const res = await fetch(`http://127.0.0.1:${port}/api/dispatch/poll`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Machine': machine,
    },
    body: JSON.stringify({ providers: ['claude'], roots: ['/tmp'], focus: false }),
  });
  const body = (await res.json()) as { pending: PendingItem[] };
  return body.pending;
}

async function decide(
  port: number,
  token: string,
  id: string,
  decision: 'accept' | 'deny',
  reason?: string,
): Promise<void> {
  await fetch(`http://127.0.0.1:${port}/api/dispatch/${id}/decision`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, reason }),
  });
}

/** Seeds a fresh, healthy budget snapshot (POST /api/budget/report, Bearer-
 *  authed like /api/agents/poll) — chain-step AUTO-CONTINUATION is
 *  budget-gated by design (GAME-DESIGN §7.4: "paused by budget: ...
 *  chain-step auto-continuation"), so without a live snapshot the
 *  fail-safe stale-snapshot pause would otherwise hold step 2 in
 *  'pending' forever, same as it correctly does for a real deployment
 *  with no hook wired yet. This mirrors seeding a real
 *  ~/.pixel-agents/rate-limit-snapshot.json in production. */
async function seedHealthyBudget(port: number, token: string): Promise<void> {
  await fetch(`http://127.0.0.1:${port}/api/budget/report`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rate_limits: {
        five_hour: { used_percentage: 5, resets_at: Math.floor(Date.now() / 1000) + 3600 },
        seven_day: { used_percentage: 5, resets_at: Math.floor(Date.now() / 1000) + 86_400 },
      },
    }),
  });
}

async function reportExit(
  port: number,
  token: string,
  id: string,
  exitCode: number,
  resultTail?: string,
): Promise<void> {
  await fetch(`http://127.0.0.1:${port}/api/dispatch/${id}/status`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'exited', exitCode, resultTail }),
  });
}

/** Simulates a real runner's allowlist decision: only ALLOWED_ROOT passes. */
const ALLOWED_ROOT = '/Users/dev/allowlisted-project';
const DENIED_ROOT = '/Users/dev/not-allowlisted';

/** Real runner allowlist check: only ALLOWED_ROOT (or a subdirectory of it)
 *  is permitted — mirrors bin/lib/dispatch-rules.mjs's containment check,
 *  applied against the dispatch's actual cwd, never the prompt text. */
async function runnerTick(
  port: number,
  token: string,
  machine: string,
): Promise<{ id: string; prompt?: string; allowed: boolean } | null> {
  const pending = await poll(port, token, machine);
  if (pending.length === 0) return null;
  const item = pending[0];
  const allowed =
    (item.cwd ?? '') === ALLOWED_ROOT || (item.cwd ?? '').startsWith(`${ALLOWED_ROOT}/`);
  return { id: item.id, prompt: item.prompt, allowed };
}

describe('Chain live E2E (real Fastify server, real poll/decide/status runner simulation)', () => {
  let server: InstanceType<typeof PixelAgentsServer>;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-chain-e2e-'));
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

  it('a 2-step chain on an allowlisted root completes with correct template substitution', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machine = uniqueMachine('MACBOOK');
    await seedHealthyBudget(config.port, config.token);

    const defRes = await fetch(`http://127.0.0.1:${config.port}/api/chains/defs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'build then report',
        steps: [
          { id: 's1', machine, provider: 'claude', cwd: ALLOWED_ROOT, prompt: 'build the project' },
          {
            id: 's2',
            machine,
            provider: 'claude',
            cwd: ALLOWED_ROOT,
            prompt: 'report on {{step1.result}} (exit {{step1.exitCode}})',
          },
        ],
      }),
    });
    const defBody = (await defRes.json()) as { ok: boolean; def: { id: string } };
    expect(defBody.ok).toBe(true);

    const runRes = await fetch(
      `http://127.0.0.1:${config.port}/api/chains/defs/${defBody.def.id}/run`,
      { method: 'POST' },
    );
    const runBody = (await runRes.json()) as { ok: boolean; run: { id: string } };
    expect(runBody.ok).toBe(true);
    const runId = runBody.run.id;

    // Step 1: allowlisted root -> runner accepts and exits 0.
    const step1 = await runnerTick(config.port, config.token, machine);
    expect(step1).not.toBeNull();
    expect(step1!.allowed).toBe(true);
    await decide(config.port, config.token, step1!.id, 'accept');
    await reportExit(config.port, config.token, step1!.id, 0, 'BUILD_OK');

    await vi.waitFor(async () => {
      const runRes2 = await fetch(`http://127.0.0.1:${config.port}/api/chains/runs`);
      const runs = (await runRes2.json()) as Array<{ id: string; currentStep: number }>;
      const run = runs.find((r) => r.id === runId);
      expect(run?.currentStep).toBe(1);
    });

    // Step 2: auto-enqueued with the substituted prompt.
    const step2 = await runnerTick(config.port, config.token, machine);
    expect(step2).not.toBeNull();
    expect(step2!.prompt).toBe('report on BUILD_OK (exit 0)');
    await decide(config.port, config.token, step2!.id, 'accept');
    await reportExit(config.port, config.token, step2!.id, 0, 'REPORT_OK');

    await vi.waitFor(async () => {
      const runRes3 = await fetch(`http://127.0.0.1:${config.port}/api/chains/runs`);
      const runs = (await runRes3.json()) as Array<{ id: string; status: string }>;
      const run = runs.find((r) => r.id === runId);
      expect(run?.status).toBe('completed');
    });
  });

  it('a non-allowlisted root is denied by the runner; the chain fails cleanly, step 2 never enqueues', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const machine = uniqueMachine('MACBOOK');

    const defRes = await fetch(`http://127.0.0.1:${config.port}/api/chains/defs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'denied pipeline',
        steps: [
          { id: 's1', machine, provider: 'claude', cwd: DENIED_ROOT, prompt: 'do it' },
          { id: 's2', machine, provider: 'claude', cwd: DENIED_ROOT, prompt: 'never reached' },
        ],
      }),
    });
    const defBody = (await defRes.json()) as { ok: boolean; def: { id: string } };
    expect(defBody.ok).toBe(true);

    const runRes = await fetch(
      `http://127.0.0.1:${config.port}/api/chains/defs/${defBody.def.id}/run`,
      { method: 'POST' },
    );
    const runBody = (await runRes.json()) as { ok: boolean; run: { id: string } };
    const runId = runBody.run.id;

    const step1 = await runnerTick(config.port, config.token, machine);
    expect(step1).not.toBeNull();
    expect(step1!.allowed).toBe(false);
    await decide(config.port, config.token, step1!.id, 'deny', 'path-not-allowlisted');

    await vi.waitFor(async () => {
      const runRes2 = await fetch(`http://127.0.0.1:${config.port}/api/chains/runs`);
      const runs = (await runRes2.json()) as Array<{
        id: string;
        status: string;
        failReason?: string;
      }>;
      const run = runs.find((r) => r.id === runId);
      expect(run?.status).toBe('failed');
      expect(run?.failReason).toContain('path-not-allowlisted');
    });

    // Step 2 never appears in the dispatch queue.
    const pendingAfter = await poll(config.port, config.token, machine);
    expect(pendingAfter).toHaveLength(0);
  });
});
