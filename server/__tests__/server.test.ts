import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Use isolated temp HOME to avoid touching real ~/.pixel-agents/
let tmpBase: string;
let serverJsonDir: string;
let serverJsonPath: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

// Must import AFTER mock setup
const { PixelAgentsServer } = await import('../src/server.js');

async function postHook(
  port: number,
  token: string,
  body: string,
  providerId = 'claude',
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/hooks/${providerId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body,
  });
}

describe('PixelAgentsServer', () => {
  let server: InstanceType<typeof PixelAgentsServer>;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-server-test-'));
    serverJsonDir = path.join(tmpBase, '.pixel-agents');
    serverJsonPath = path.join(serverJsonDir, 'server.json');
    fs.mkdirSync(serverJsonDir, { recursive: true });
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

  // 1. Server starts and returns config
  it('starts and returns config with port, token, pid', async () => {
    const config = await server.start();
    expect(config.port).toBeGreaterThan(0);
    expect(config.token).toBeTruthy();
    expect(config.pid).toBe(process.pid);
    expect(config.startedAt).toBeGreaterThan(0);
  });

  // 2. Health endpoint returns 200 + uptime
  it('health endpoint returns 200 with uptime', async () => {
    const config = await server.start();
    const res = await fetch(`http://127.0.0.1:${config.port}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; uptime: number; pid: number };
    expect(body.status).toBe('ok');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(body.pid).toBe(process.pid);
  });

  // 2b. Version endpoint returns the baked-in deploy identity
  it('version endpoint returns sha and builtAt from env, with unknown fallback', async () => {
    vi.stubEnv('GIT_SHA', 'abc1234def');
    vi.stubEnv('BUILT_AT', '2026-07-10T00:00:00Z');
    try {
      const config = await server.start();
      const res = await fetch(`http://127.0.0.1:${config.port}/api/version`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ sha: 'abc1234def', builtAt: '2026-07-10T00:00:00Z' });
    } finally {
      vi.unstubAllEnvs();
    }
    // Fallback path: without the env vars a fresh server reports 'unknown'.
    server.stop();
    server = new PixelAgentsServer();
    const config = await server.start();
    const res = await fetch(`http://127.0.0.1:${config.port}/api/version`);
    expect(await res.json()).toEqual({ sha: 'unknown', builtAt: 'unknown' });
  });

  // 2c. Stale server.json recording OUR OWN pid must not be "reused" — in a
  // container node is always PID 1, so a previous boot's server.json passes
  // the pid-liveness check forever and the server would never bind (found
  // live on NEXUS, 2026-07-10 state-volume deploy).
  it('ignores a stale server.json whose pid equals our own pid', async () => {
    fs.writeFileSync(
      serverJsonPath,
      JSON.stringify({ port: 59999, pid: process.pid, token: 'stale-token', startedAt: 1 }),
    );
    const config = await server.start();
    expect(config.port).not.toBe(59999);
    expect(config.token).not.toBe('stale-token');
    const res = await fetch(`http://127.0.0.1:${config.port}/api/health`);
    expect(res.status).toBe(200);
  });

  // 3. Hook endpoint requires auth
  it('hook endpoint returns 401 without auth', async () => {
    const config = await server.start();
    const res = await fetch(`http://127.0.0.1:${config.port}/api/hooks/claude`, {
      method: 'POST',
      body: '{}',
    });
    expect(res.status).toBe(401);
  });

  // 4. Hook endpoint accepts valid auth
  it('hook endpoint returns 200 with valid auth', async () => {
    const config = await server.start();
    const res = await postHook(
      config.port,
      config.token,
      JSON.stringify({ session_id: 'test', hook_event_name: 'Stop' }),
    );
    expect(res.status).toBe(200);
  });

  // 5. Hook callback fires on valid event
  it('hook callback fires on valid event', async () => {
    const config = await server.start();
    const received: Array<{ providerId: string; event: Record<string, unknown> }> = [];
    server.onHookEvent((providerId: string, event: Record<string, unknown>) => {
      received.push({ providerId, event });
    });

    await postHook(
      config.port,
      config.token,
      JSON.stringify({ session_id: 'abc', hook_event_name: 'Stop' }),
    );

    expect(received).toHaveLength(1);
    expect(received[0].providerId).toBe('claude');
    expect(received[0].event.session_id).toBe('abc');
    expect(received[0].event.hook_event_name).toBe('Stop');
  });

  // 5b. X-Pid header tags the event with __pid (mechanic #6b FOCUS telemetry)
  it('X-Pid header tags the hook event with __pid', async () => {
    const config = await server.start();
    const received: Array<Record<string, unknown>> = [];
    server.onHookEvent((_providerId: string, event: Record<string, unknown>) => {
      received.push(event);
    });

    await fetch(`http://127.0.0.1:${config.port}/api/hooks/claude`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
        'X-Pid': '4242',
      },
      body: JSON.stringify({ session_id: 'abc', hook_event_name: 'Stop' }),
    });

    expect(received).toHaveLength(1);
    expect(received[0].__pid).toBe(4242);
  });

  // 5c. Invalid/absent X-Pid never sets __pid (honest "no telemetry" case)
  it('missing or invalid X-Pid leaves __pid unset', async () => {
    const config = await server.start();
    const received: Array<Record<string, unknown>> = [];
    server.onHookEvent((_providerId: string, event: Record<string, unknown>) => {
      received.push(event);
    });

    await postHook(
      config.port,
      config.token,
      JSON.stringify({ session_id: 'no-pid', hook_event_name: 'Stop' }),
    );
    await fetch(`http://127.0.0.1:${config.port}/api/hooks/claude`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
        'X-Pid': 'not-a-number',
      },
      body: JSON.stringify({ session_id: 'bad-pid', hook_event_name: 'Stop' }),
    });

    expect(received).toHaveLength(2);
    expect(received[0].__pid).toBeUndefined();
    expect(received[1].__pid).toBeUndefined();
  });

  it('injects authenticated coworker-adapter source metadata and ignores body spoofing', async () => {
    const config = await server.start();
    const received: Array<Record<string, unknown>> = [];
    server.onHookEvent((_providerId: string, event: Record<string, unknown>) => {
      received.push(event);
    });

    await fetch(`http://127.0.0.1:${config.port}/api/hooks/codex`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
        'X-War-Room-Hook-Source': 'coworker-adapter',
      },
      body: JSON.stringify({ session_id: 'adapter', hook_event_name: 'Stop' }),
    });
    await postHook(
      config.port,
      config.token,
      JSON.stringify({
        session_id: 'spoofed',
        hook_event_name: 'Stop',
        __source: 'coworker-adapter',
      }),
      'codex',
    );

    expect(received[0].__source).toBe('coworker-adapter');
    expect(received[1].__source).toBeUndefined();
  });

  // 6. Hook endpoint rejects oversized body
  it('hook endpoint returns 413 for oversized body', async () => {
    const config = await server.start();
    const bigBody = 'x'.repeat(70_000); // > 64KB
    const res = await postHook(config.port, config.token, bigBody);
    expect(res.status).toBe(413);
  });

  // 7. Hook endpoint rejects invalid JSON
  it('hook endpoint returns 400 for invalid JSON', async () => {
    const config = await server.start();
    const res = await postHook(config.port, config.token, 'not json {{{');
    expect(res.status).toBe(400);
  });

  // 8. Hook endpoint rejects missing provider ID
  it('hook endpoint returns 400 for missing provider ID', async () => {
    const config = await server.start();
    const res = await fetch(`http://127.0.0.1:${config.port}/api/hooks/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}` },
      body: '{}',
    });
    expect(res.status).toBe(400);
  });

  // 9. server.json written
  it('writes server.json with port, pid, token', async () => {
    const config = await server.start();
    const json = JSON.parse(fs.readFileSync(serverJsonPath, 'utf-8'));
    expect(json.port).toBe(config.port);
    expect(json.pid).toBe(process.pid);
    expect(json.token).toBe(config.token);
  });

  // 10. Second instance reuses existing server
  it('second instance reuses existing server', async () => {
    const config1 = await server.start();
    const server2 = new PixelAgentsServer();
    const config2 = await server2.start();
    expect(config2.port).toBe(config1.port);
    expect(config2.pid).toBe(config1.pid);
    server2.stop(); // should not delete server.json (not owner)
  });

  // 11. server.json cleaned up on stop
  it('deletes server.json on stop', async () => {
    await server.start();
    expect(fs.existsSync(serverJsonPath)).toBe(true);
    server.stop();
    expect(fs.existsSync(serverJsonPath)).toBe(false);
  });

  // 12. server.json NOT deleted if PID mismatch
  it('does not delete server.json if PID mismatch', async () => {
    // Write fake server.json with different PID
    fs.writeFileSync(
      serverJsonPath,
      JSON.stringify({ port: 9999, pid: 999999, token: 'fake', startedAt: 0 }),
    );
    // Server never started (it would reuse), just stop
    const server2 = new PixelAgentsServer();
    server2.stop();
    expect(fs.existsSync(serverJsonPath)).toBe(true);
  });

  // 13. Unknown route returns 404
  it('unknown route returns 404', async () => {
    const config = await server.start();
    const res = await fetch(`http://127.0.0.1:${config.port}/random/path`);
    expect(res.status).toBe(404);
  });

  // 14. Hook callback does NOT fire for events missing required fields
  it('hook callback does not fire for events without session_id', async () => {
    const config = await server.start();
    const received: unknown[] = [];
    server.onHookEvent((_pid: string, event: Record<string, unknown>) => received.push(event));

    await postHook(
      config.port,
      config.token,
      JSON.stringify({ hook_event_name: 'Stop' }), // missing session_id
    );

    expect(received).toHaveLength(0);
  });
});
