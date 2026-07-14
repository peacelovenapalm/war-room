/**
 * war-room-distill.js — standalone SessionEnd enrichment CLI.
 *
 * V8 shipped client-side distillation ONLY inside the bundled Claude hook
 * script (dist/hooks/claude-hook.js), which is spawned by the extension /
 * standalone server's own hook installer. Greg's Macs don't run that
 * installer -- they run the GATED runbook
 * (.planning/runbooks/macbook-hooks-install.sh), whose forwarder
 * (~/.war-room/hook.sh) is a plain shell script that curls the raw hook
 * payload straight to the server. That forwarder never distilled, so real
 * sessions produced `transcript-unavailable` receipts and zero notes.
 *
 * This CLI closes that gap without duplicating the distill logic: it's a
 * thin stdin -> stdout wrapper around the SAME `distillForSessionEnd` used
 * by claude-hook.ts (server/src/memoryDistillerCore.ts). The runbook's
 * forwarder pipes the payload through this script (via `node`) only on the
 * SessionEnd path, before the existing curl POST.
 *
 * Contract (never violated, matched by server/__tests__/war-room-distill.test.ts):
 *   - Reads the raw hook event JSON on stdin.
 *   - Non-SessionEnd events: byte-identical passthrough of the raw input.
 *   - Malformed JSON on stdin: byte-identical passthrough of the raw input.
 *   - SessionEnd events: the SAME JSON, enriched with
 *     distilledNote/distillSkipped/distillFailed/distillFailReason.
 *   - ANY internal error: never corrupts or drops the payload -- falls back
 *     to the original payload (with an honest distillFailed marker when the
 *     event was SessionEnd and enrichment itself is what failed).
 *   - Writes nothing else to stdout. Always exits 0.
 */
import { distillForSessionEnd } from '../memoryDistillerCore.js';

function writeAndExit(output: string): void {
  process.stdout.write(output, () => process.exit(0));
}

async function main(): Promise<void> {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch {
    writeAndExit(input);
    return;
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    writeAndExit(input);
    return;
  }

  const record = data as Record<string, unknown>;
  const eventName = typeof record.hook_event_name === 'string' ? record.hook_event_name : '';
  if (eventName !== 'SessionEnd') {
    writeAndExit(input);
    return;
  }

  try {
    Object.assign(record, distillForSessionEnd(record));
    writeAndExit(JSON.stringify(record));
  } catch (e) {
    // distillForSessionEnd never throws internally, but this CLI's job is to
    // NEVER drop or corrupt the payload even if that guarantee ever breaks.
    record.distillFailed = true;
    record.distillFailReason = e instanceof Error ? e.message.slice(0, 200) : 'distill-cli-error';
    delete record.distilledNote;
    delete record.distillSkipped;
    try {
      writeAndExit(JSON.stringify(record));
    } catch {
      writeAndExit(input);
    }
  }
}

void main().catch(() => process.exit(0));
