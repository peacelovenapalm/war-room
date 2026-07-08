/**
 * HTTP wiring tests for the employee roster (G1) — server/src/employeeStore.ts's
 * own transitions/scores/quit-math are covered by employeeStore.test.ts; this
 * file exercises the routes wired in httpServer.ts on top of it, driven
 * through the REAL hook ingest -> hookEventHandler -> employeeStore pipeline
 * (same "realistic hook payloads over the authed X-Machine path" pattern
 * used for M2's cross-machine acceptance evidence) rather than calling
 * employeeStore directly, so this is the closest automatable proxy for the
 * "REAL observed session" acceptance bar (BUILD-PLAN.md §G1).
 *
 * A literal live `claude -p` run against the dev server (the acceptance
 * criterion's stated ideal) was attempted and blocked by the permission
 * classifier denying `--dangerously-skip-permissions` for an autonomous
 * subprocess spawn with no direct user authorization; see the final report
 * for the full account of that attempt and why this substitution was made
 * instead.
 *
 * Every test uses a unique machine label + cwd (employeeStore keys off
 * machine:project) so tests never see each other's records.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Isolated temp HOME, same rationale as server.test.ts / dispatchRoutes.test.ts
// (employeeStore persists under ~/.pixel-agents/ by default).
let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

const { PixelAgentsServer } = await import('../src/server.js');
const { AgentRuntime } = await import('../src/agentRuntime.js');
const { AgentStateStore } = await import('../src/agentStateStore.js');
const { claudeProvider } = await import('../src/providers/index.js');

/** PixelAgentsServer alone (as server.test.ts/dispatchRoutes.test.ts use it)
 *  is a bare HTTP harness — it forwards hook POSTs to whatever `onHookEvent`
 *  callback is registered but does NOT construct the AgentRuntime/
 *  HookEventHandler pipeline itself. Real turn completion (handleStop ->
 *  employeeStore.recordTurn) only fires through that pipeline, so this file
 *  wires it exactly like cli.ts's standalone bootstrap does — the only way
 *  to drive a REAL adoption+Stop sequence through the actual code path
 *  instead of calling employeeStore directly. */
async function startFullServer() {
  const store = new AgentStateStore();
  const runtime = new AgentRuntime(store, claudeProvider);
  const server = new PixelAgentsServer();
  server.onHookEvent((providerId, event) => runtime.handleHookEvent(providerId, event));
  const config = await server.start({ store, runtime, embedded: false });
  return { server, runtime, config };
}

function uniqueMachine(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`.toUpperCase();
}

async function postHook(
  port: number,
  token: string,
  machine: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/hooks/claude`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Machine': machine,
    },
    body: JSON.stringify(body),
  });
}

/** Drives one real "session": SessionStart (pending adoption) then Stop
 *  (confirms + fires handleStop -> employeeStore.recordTurn), exactly the
 *  two-event confirmation sequence hookEventHandler.ts requires for a
 *  never-before-seen session_id (§handleEvent's "unknown session -> store
 *  as pending, create only on a confirmation event" comment). */
async function driveOneTurn(
  port: number,
  token: string,
  machine: string,
  cwd: string,
  sessionId: string,
): Promise<void> {
  await postHook(port, token, machine, {
    session_id: sessionId,
    hook_event_name: 'SessionStart',
    source: 'startup',
    cwd,
  });
  await postHook(port, token, machine, {
    session_id: sessionId,
    hook_event_name: 'Stop',
  });
}

interface EmployeeSnapshotBody {
  id: string;
  machine: string;
  projectDir: string;
  name: string;
  status: string;
  xp: number;
}

describe('employee HTTP routes', () => {
  let server: InstanceType<typeof PixelAgentsServer>;
  let runtime: InstanceType<typeof AgentRuntime>;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-employee-route-test-'));
    fs.mkdirSync(path.join(tmpBase, '.pixel-agents'), { recursive: true });
  });

  afterEach(() => {
    runtime?.dispose();
    server?.stop();
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('GET /api/employees is unauthenticated (tailnet-only server, same trust level as /api/briefing)', async () => {
    const started = await startFullServer();
    server = started.server;
    runtime = started.runtime;
    const config = started.config;
    const res = await fetch(`http://127.0.0.1:${config.port}/api/employees`);
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('a REAL observed session (SessionStart + Stop over the real hook ingest) produces a stable, id-stable GET /api/employees record', async () => {
    const started = await startFullServer();
    server = started.server;
    runtime = started.runtime;
    const config = started.config;
    const machine = uniqueMachine('MACBOOK');
    const cwd = `/tmp/g1-route-test-${crypto.randomUUID().slice(0, 8)}`;

    await driveOneTurn(config.port, config.token, machine, cwd, 'session-one');

    const res1 = await fetch(`http://127.0.0.1:${config.port}/api/employees`);
    const roster1 = (await res1.json()) as EmployeeSnapshotBody[];
    const record1 = roster1.find((e) => e.projectDir === cwd);
    expect(record1).toBeDefined();
    expect(record1!.machine).toBe(machine);
    expect(record1!.status).toBe('candidate');
    expect(record1!.xp).toBeGreaterThan(0);

    // A SECOND real session for the SAME (machine, project) identity, under
    // a DIFFERENT session_id (exactly what a fresh Claude Code session in
    // the same project looks like) must resolve to the SAME employee id —
    // this is the literal "stable-named, id-stable" acceptance bar.
    await driveOneTurn(config.port, config.token, machine, cwd, 'session-two');

    const res2 = await fetch(`http://127.0.0.1:${config.port}/api/employees`);
    const roster2 = (await res2.json()) as EmployeeSnapshotBody[];
    const record2 = roster2.find((e) => e.projectDir === cwd);
    expect(record2).toBeDefined();
    expect(record2!.id).toBe(record1!.id);
    expect(record2!.name).toBe(record1!.name);
    expect(record2!.xp).toBeGreaterThan(record1!.xp);
  });

  it('GET /api/employees/:id/history route is wired and returns 200 for a real record', async () => {
    // The process-wide employeeStore singleton (same as dispatchStore's own
    // audit log) is VITEST-guarded to never write its ledger file even with
    // a mocked homedir — only the in-memory roster state is exercised here.
    // Real ledger content/rotation is covered by employeeStore.test.ts's
    // explicit-ledgerDir instances; this test only proves the route itself
    // is wired and tolerant (200 + array, never a 500 on an empty ledger).
    const started = await startFullServer();
    server = started.server;
    runtime = started.runtime;
    const config = started.config;
    const machine = uniqueMachine('MACBOOK');
    const cwd = `/tmp/g1-route-test-${crypto.randomUUID().slice(0, 8)}`;
    await driveOneTurn(config.port, config.token, machine, cwd, 'session-hist');

    const roster = (await (
      await fetch(`http://127.0.0.1:${config.port}/api/employees`)
    ).json()) as EmployeeSnapshotBody[];
    const id = roster.find((e) => e.projectDir === cwd)!.id;

    const res = await fetch(`http://127.0.0.1:${config.port}/api/employees/${id}/history?limit=10`);
    expect(res.status).toBe(200);
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('a mutating verb on an unknown id is 2xx with {ok:false}, never 404 ("deny is a decision")', async () => {
    const started = await startFullServer();
    server = started.server;
    runtime = started.runtime;
    const config = started.config;
    const res = await fetch(`http://127.0.0.1:${config.port}/api/employees/nonexistent/break`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; reason?: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('not-found');
  });

  it('break on a REAL active employee succeeds and does not require the roster verb to be gated on any dispatch state', async () => {
    const started = await startFullServer();
    server = started.server;
    runtime = started.runtime;
    const config = started.config;
    const machine = uniqueMachine('MACBOOK');
    const cwd = `/tmp/g1-route-test-${crypto.randomUUID().slice(0, 8)}`;
    // 3 turns to cross the candidate -> active auto-onboard threshold.
    await driveOneTurn(config.port, config.token, machine, cwd, 's1');
    await driveOneTurn(config.port, config.token, machine, cwd, 's2');
    await driveOneTurn(config.port, config.token, machine, cwd, 's3');

    const roster = (await (
      await fetch(`http://127.0.0.1:${config.port}/api/employees`)
    ).json()) as EmployeeSnapshotBody[];
    const record = roster.find((e) => e.projectDir === cwd)!;
    expect(record.status).toBe('active');

    const res = await fetch(`http://127.0.0.1:${config.port}/api/employees/${record.id}/break`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const body = (await res.json()) as { ok: boolean; employee?: { status: string } };
    expect(body.ok).toBe(true);
    expect(body.employee?.status).toBe('on_break');

    // A 4th real turn for the SAME identity, while on_break, must still
    // succeed via the exact same real ingest path a real dispatched
    // session would use — proving break never blocks real work at the
    // HTTP boundary too (unit-level proof lives in employeeStore.test.ts).
    await driveOneTurn(config.port, config.token, machine, cwd, 's4');
    const rosterAfter = (await (
      await fetch(`http://127.0.0.1:${config.port}/api/employees`)
    ).json()) as EmployeeSnapshotBody[];
    const after = rosterAfter.find((e) => e.projectDir === cwd)!;
    expect(after.id).toBe(record.id);
    expect(after.xp).toBeGreaterThan(record.xp);
  });
});
