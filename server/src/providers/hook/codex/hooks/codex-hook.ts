import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';

import {
  CODEX_ANCESTOR_SCAN_LIMIT,
  CODEX_ANCESTOR_SCAN_TIMEOUT_MS,
  CODEX_DISCOVERED_PID_ENV,
  CODEX_HOOK_API_PATH,
  CODEX_HOOK_POST_TIMEOUT_MS,
  CODEX_HOOK_STATUS_FILE_ENV,
  CODEX_HOOK_SYNC_ENV,
  CODEX_HOOK_WORKER_ENV,
} from '../constants.js';

interface ProcessInfo {
  parentPid: number;
  command: string;
}

async function readOneJsonObject(): Promise<Record<string, unknown> | undefined> {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try {
    const value: unknown = JSON.parse(input);
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function isCodexCommand(command: string): boolean {
  const basename = command.split(/[\\/]/).pop() ?? command;
  return /^codex(?:$|[-_])/i.test(basename) && !/codex-hook/i.test(basename);
}

/** Hooks run below a shell, so inspect the whole ancestor chain instead of
 * forwarding PPID. Failure is intentionally indistinguishable from no PID. */
function findCodexAncestorPid(): number | undefined {
  try {
    const output = execFileSync('ps', ['-axo', 'pid=,ppid=,comm='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: CODEX_ANCESTOR_SCAN_TIMEOUT_MS,
    });
    const processes = new Map<number, ProcessInfo>();
    for (const line of output.split('\n')) {
      const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
      if (!match) continue;
      processes.set(Number(match[1]), { parentPid: Number(match[2]), command: match[3] });
    }
    let pid = process.ppid;
    for (let depth = 0; depth < CODEX_ANCESTOR_SCAN_LIMIT && pid > 1; depth += 1) {
      const info = processes.get(pid);
      if (!info) return undefined;
      if (isCodexCommand(info.command)) return pid;
      pid = info.parentPid;
    }
  } catch {
    // ps is unavailable or the process exited while scanning.
  }
  return undefined;
}

function machineLabel(): string {
  return process.env.WAR_ROOM_MACHINE || os.hostname().split('.')[0] || 'LOCAL';
}

function writeSmokeStatus(status: string): void {
  const statusFile = process.env[CODEX_HOOK_STATUS_FILE_ENV];
  if (!statusFile) return;
  try {
    fs.writeFileSync(statusFile, status, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Smoke-test diagnostics must not affect the hook.
  }
}

function postEvent(data: Record<string, unknown>, pid: number | undefined): Promise<string> {
  const baseUrl = process.env.WAR_ROOM_URL;
  const token = process.env.WAR_ROOM_TOKEN;
  if (!baseUrl || !token) return Promise.resolve('missing-env');

  let url: URL;
  try {
    url = new URL(`${baseUrl.replace(/\/$/, '')}${CODEX_HOOK_API_PATH}`);
  } catch {
    return Promise.resolve('bad-url');
  }

  const body = JSON.stringify(data);
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const req = client.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${token}`,
          'X-Machine': machineLabel(),
          ...(pid === undefined ? {} : { 'X-Pid': String(pid) }),
        },
        timeout: CODEX_HOOK_POST_TIMEOUT_MS,
      },
      (res) => {
        res.resume();
        resolve(String(res.statusCode ?? 'no-status'));
      },
    );
    req.on('error', () => resolve('error'));
    req.on('timeout', () => {
      req.destroy();
      resolve('timeout');
    });
    req.end(body);
  });
}

async function worker(): Promise<void> {
  const data = await readOneJsonObject();
  if (!data) return;
  const rawPid = process.env[CODEX_DISCOVERED_PID_ENV];
  const parsedPid = rawPid ? Number(rawPid) : Number.NaN;
  const status = await postEvent(data, Number.isSafeInteger(parsedPid) ? parsedPid : undefined);
  writeSmokeStatus(status);
}

async function main(): Promise<void> {
  if (process.env[CODEX_HOOK_WORKER_ENV] === '1') {
    await worker();
    return;
  }

  const data = await readOneJsonObject();
  if (!data) return;
  const pid = findCodexAncestorPid();

  if (process.env[CODEX_HOOK_SYNC_ENV] === '1') {
    const status = await postEvent(data, pid);
    writeSmokeStatus(status);
    return;
  }

  try {
    const child = spawn(process.execPath, [__filename], {
      detached: true,
      env: {
        ...process.env,
        [CODEX_HOOK_WORKER_ENV]: '1',
        ...(pid === undefined ? {} : { [CODEX_DISCOVERED_PID_ENV]: String(pid) }),
      },
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    child.on('error', () => {});
    await new Promise<void>((resolve) => {
      if (!child.stdin) {
        resolve();
        return;
      }
      child.stdin.on('error', () => resolve());
      child.stdin.end(JSON.stringify(data), resolve);
    });
    child.unref();
  } catch {
    // A telemetry hook always fails open.
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
