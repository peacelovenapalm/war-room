import { spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HOOK_SCRIPT = path.join(__dirname, '../../dist/hooks/codex-hook.js');
const TEST_TIMEOUT_MS = 5_000;

let tmpBase: string;

function runHookScript(
  stdin: string,
  env: Record<string, string>,
): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn('node', [HOOK_SCRIPT], {
      env: { ...process.env, HOME: tmpBase, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: TEST_TIMEOUT_MS,
    });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.on('close', (code) => resolve({ code, stdout }));
    child.stdin.end(stdin);
  });
}

function skipIfNotBuilt(): boolean {
  if (fs.existsSync(HOOK_SCRIPT)) return false;
  console.warn(`Skipping: ${HOOK_SCRIPT} not found. Run 'node esbuild.js' first.`);
  return true;
}

describe('codex-hook.js integration', () => {
  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hook-int-'));
  });

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  it('preserves raw fields and sends auth, machine, and best-effort pid headers', async () => {
    if (skipIfNotBuilt()) return;
    const received: Array<{
      url?: string;
      headers: http.IncomingHttpHeaders;
      body: Record<string, unknown>;
    }> = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        received.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
        res.writeHead(200);
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const event = {
      session_id: 'codex-session',
      hook_event_name: 'PreToolUse',
      tool_use_id: 'call-1',
      tool_input: { command: 'preserved raw command' },
    };

    const result = await runHookScript(JSON.stringify(event), {
      WAR_ROOM_URL: `http://127.0.0.1:${port}`,
      WAR_ROOM_TOKEN: 'test-token',
      WAR_ROOM_MACHINE: 'TEST-MACHINE',
      WAR_ROOM_HOOK_SYNC: '1',
    });
    server.close();

    expect(result).toEqual({ code: 0, stdout: '' });
    expect(received).toHaveLength(1);
    expect(received[0].url).toBe('/api/hooks/codex');
    expect(received[0].headers.authorization).toBe('Bearer test-token');
    expect(received[0].headers['x-machine']).toBe('TEST-MACHINE');
    if (received[0].headers['x-pid'] !== undefined) {
      expect(Number(received[0].headers['x-pid'])).toBeGreaterThan(1);
    }
    expect(received[0].body).toEqual(event);
  });

  it('returns before a background POST response and still delivers the event', async () => {
    if (skipIfNotBuilt()) return;
    let resolveReceipt: (() => void) | undefined;
    const receipt = new Promise<void>((resolve) => {
      resolveReceipt = resolve;
    });
    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        resolveReceipt?.();
        setTimeout(() => {
          res.writeHead(200);
          res.end('ok');
        }, 500);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const start = Date.now();
    const result = await runHookScript(
      JSON.stringify({ session_id: 'async', hook_event_name: 'Stop' }),
      {
        WAR_ROOM_URL: `http://127.0.0.1:${port}`,
        WAR_ROOM_TOKEN: 'test-token',
        WAR_ROOM_MACHINE: 'TEST-MACHINE',
      },
    );
    const elapsed = Date.now() - start;
    await receipt;
    server.close();

    expect(result).toEqual({ code: 0, stdout: '' });
    expect(elapsed).toBeLessThan(500);
  });

  it('always exits zero with no stdout for malformed input or missing env', async () => {
    if (skipIfNotBuilt()) return;
    expect(await runHookScript('not-json', {})).toEqual({ code: 0, stdout: '' });
    expect(
      await runHookScript(JSON.stringify({ session_id: 'x', hook_event_name: 'Stop' }), {}),
    ).toEqual({ code: 0, stdout: '' });
  });
});
