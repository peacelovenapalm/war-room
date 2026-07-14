import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

import { HOOK_API_PREFIX, SERVER_JSON_DIR, SERVER_JSON_NAME } from '../../../../constants.js';
import {
  carriesDistillSkipTag,
  DeterministicSessionDistiller,
  readTranscriptTextLines,
} from '../../../../memoryDistillerCore.js';
import type { ServerConfig } from '../../../../server.js';

const SERVER_JSON = path.join(os.homedir(), SERVER_JSON_DIR, SERVER_JSON_NAME);

/** V8: client-side distill fields, attached to the SessionEnd hook payload
 *  before it's POSTed. Mirrors AgentEvent's sessionEnd kind
 *  (core/src/provider.ts). Runs on the session's OWN machine so the server
 *  never needs (or gets) the raw transcript -- only the finished note. */
interface SessionEndDistillFields {
  distilledNote?: unknown;
  distillSkipped?: boolean;
  distillFailed?: boolean;
  distillFailReason?: string;
}

/** Never throws: any failure becomes an honest distillFailed marker so the
 *  server can record a distinct 'client-distill-failed' receipt instead of
 *  silently dropping the session. Never fabricates a note. */
function distillForSessionEnd(data: Record<string, unknown>): SessionEndDistillFields {
  try {
    const transcriptPath = typeof data.transcript_path === 'string' ? data.transcript_path : '';
    const sessionId = typeof data.session_id === 'string' ? data.session_id : '';
    if (transcriptPath === '') {
      return { distillFailed: true, distillFailReason: 'no-transcript-path' };
    }
    const lines = readTranscriptTextLines(transcriptPath);
    if (carriesDistillSkipTag(lines)) {
      return { distillSkipped: true };
    }
    const now = Date.now();
    const note = new DeterministicSessionDistiller().distill(lines, {
      sessionId,
      date: new Date(now).toISOString().slice(0, 10),
      model: 'deterministic-v1',
      distilledAt: new Date(now).toISOString(),
    });
    return { distilledNote: note };
  } catch (e) {
    return {
      distillFailed: true,
      distillFailReason: e instanceof Error ? e.message.slice(0, 200) : 'distill-error',
    };
  }
}

/**
 * CI / e2e diagnostic: when PIXEL_AGENTS_DEBUG_LOG is set, record the hook
 * script's outcome at every exit point. The hook delivery chain (spawn
 * claude-hook.js -> read server.json -> POST -> server) is otherwise 100%
 * silent: every failure path resolves quietly, so a dropped hook is invisible
 * in CI. Logging here lets a failing run show exactly where delivery dies
 * (bad-stdin, no-server-json, POST error/timeout, or HTTP status). Zero cost
 * when the env var is unset.
 */
// Env var is the primary source, but it doesn't reliably reach this spawned
// process across platforms (macOS VS Code terminal profiles with
// inheritEnv:false, etc.). After reading server.json we fall back to its
// `debugLog` field, which the server populated from the same env var.
let debugLogPath = process.env['PIXEL_AGENTS_DEBUG_LOG'];
function hookDebug(line: string): void {
  if (!debugLogPath) return;
  try {
    fs.appendFileSync(debugLogPath, `${new Date().toISOString()} HOOKSCRIPT ${line}\n`);
  } catch {
    /* never let diagnostics break the hook */
  }
}

async function main(): Promise<void> {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(input);
  } catch {
    hookDebug('exit reason=bad-stdin');
    process.exit(0);
  }

  const eventName = (data.hook_event_name as string | undefined) ?? '?';
  const sid = (data.session_id as string | undefined)?.slice(0, 8) ?? '?';

  let server: ServerConfig;
  try {
    server = JSON.parse(fs.readFileSync(SERVER_JSON, 'utf-8'));
  } catch (e) {
    hookDebug(
      `exit reason=no-server-json event=${eventName} sid=${sid} path=${SERVER_JSON} err=${e instanceof Error ? e.message : String(e)}`,
    );
    process.exit(0);
  }

  // Adopt the server-provided debug-log path if the env var didn't reach us.
  if (!debugLogPath && server.debugLog) debugLogPath = server.debugLog;

  // V8: distill locally on SessionEnd and ship only the finished note (never
  // the raw transcript). This never throws and never blocks/delays the POST
  // meaningfully -- it's a synchronous local file read + regex parse.
  if (eventName === 'SessionEnd') {
    try {
      Object.assign(data, distillForSessionEnd(data));
    } catch {
      /* never let a distill error break normal hook delivery */
    }
  }

  hookDebug(`POST event=${eventName} sid=${sid} port=${server.port}`);
  const body = JSON.stringify(data);
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: server.port,
        path: `${HOOK_API_PREFIX}/claude`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${server.token}`,
        },
        timeout: 2000,
      },
      (res) => {
        hookDebug(`POST-done event=${eventName} sid=${sid} status=${res.statusCode}`);
        res.resume();
        resolve();
      },
    );
    req.on('error', (err) => {
      hookDebug(`POST-error event=${eventName} sid=${sid} err=${err.message}`);
      resolve();
    });
    req.on('timeout', () => {
      hookDebug(`POST-timeout event=${eventName} sid=${sid} port=${server.port}`);
      req.destroy();
      resolve();
    });
    req.end(body);
  });
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
