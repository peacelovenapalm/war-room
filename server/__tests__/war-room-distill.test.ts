import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Mirrors claude-hook.test.ts: spawns the BUILT bundle (dist/hooks/war-room-distill.js),
// same as the runbook's forwarder does via `node ~/.war-room/war-room-distill.js`.
const DISTILL_SCRIPT = path.join(__dirname, '../../dist/hooks/war-room-distill.js');

let tmpBase: string;

/** Run the distill CLI with given stdin, returns exit code + stdout. */
function runDistillScript(stdin: string): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn('node', [DISTILL_SCRIPT], {
      env: { ...process.env, HOME: tmpBase },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });
    let stdout = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.on('close', (code) => resolve({ code, stdout }));
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

describe('war-room-distill.js standalone CLI', () => {
  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-distill-cli-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  function skipIfNotBuilt(): boolean {
    if (!fs.existsSync(DISTILL_SCRIPT)) {
      console.warn(`Skipping: ${DISTILL_SCRIPT} not found. Run 'npm run package' first.`);
      return true;
    }
    return false;
  }

  it('enriches SessionEnd with a distilledNote when the transcript is readable', async () => {
    if (skipIfNotBuilt()) return;

    const transcriptPath = path.join(tmpBase, 'session.jsonl');
    fs.writeFileSync(
      transcriptPath,
      [
        JSON.stringify({ type: 'user', message: { content: 'Fact: hooks are the trigger' } }),
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Decision[write mode]: STAGED' }] },
        }),
      ].join('\n'),
    );

    const event = JSON.stringify({
      session_id: 'abc',
      hook_event_name: 'SessionEnd',
      reason: 'exit',
      transcript_path: transcriptPath,
    });
    const { code, stdout } = await runDistillScript(event);

    expect(code).toBe(0);
    const body = JSON.parse(stdout) as {
      session_id: string;
      hook_event_name: string;
      distilledNote?: { decisions: Array<{ topic: string; verdict: string }>; facts: unknown[] };
      distillSkipped?: boolean;
      distillFailed?: boolean;
    };
    expect(body.session_id).toBe('abc');
    expect(body.hook_event_name).toBe('SessionEnd');
    expect(body.distillFailed).toBeUndefined();
    expect(body.distillSkipped).toBeUndefined();
    expect(body.distilledNote?.decisions).toEqual([
      expect.objectContaining({ topic: 'write mode', verdict: 'STAGED' }),
    ]);
    expect(body.distilledNote?.facts).toHaveLength(1);
  });

  it('emits distillSkipped when the transcript carries the skip tag', async () => {
    if (skipIfNotBuilt()) return;

    const transcriptPath = path.join(tmpBase, 'skip-session.jsonl');
    fs.writeFileSync(
      transcriptPath,
      JSON.stringify({ type: 'user', message: { content: 'please #wr-skip-distill' } }),
    );

    const { code, stdout } = await runDistillScript(
      JSON.stringify({
        session_id: 'abc',
        hook_event_name: 'SessionEnd',
        reason: 'exit',
        transcript_path: transcriptPath,
      }),
    );

    expect(code).toBe(0);
    const body = JSON.parse(stdout) as { distillSkipped?: boolean; distilledNote?: unknown };
    expect(body.distillSkipped).toBe(true);
    expect(body.distilledNote).toBeUndefined();
  });

  it('emits a distillFailed marker (payload otherwise intact) when transcript_path is unreadable', async () => {
    if (skipIfNotBuilt()) return;

    const event = {
      session_id: 'abc',
      hook_event_name: 'SessionEnd',
      reason: 'exit',
      transcript_path: path.join(tmpBase, 'does-not-exist.jsonl'),
    };
    const { code, stdout } = await runDistillScript(JSON.stringify(event));

    expect(code).toBe(0);
    const body = JSON.parse(stdout) as {
      session_id: string;
      reason: string;
      transcript_path: string;
      distillFailed?: boolean;
      distillFailReason?: string;
      distilledNote?: unknown;
    };
    // Payload otherwise intact -- every original field survives enrichment.
    expect(body.session_id).toBe(event.session_id);
    expect(body.reason).toBe(event.reason);
    expect(body.transcript_path).toBe(event.transcript_path);
    expect(body.distillFailed).toBe(true);
    expect(typeof body.distillFailReason).toBe('string');
    expect(body.distilledNote).toBeUndefined();
  });

  it('passes non-SessionEnd events through byte-identical', async () => {
    if (skipIfNotBuilt()) return;

    const event = JSON.stringify({ session_id: 'abc', hook_event_name: 'Stop', foo: [1, 2, 3] });
    const { code, stdout } = await runDistillScript(event);

    expect(code).toBe(0);
    expect(stdout).toBe(event);
  });

  it('passes malformed JSON on stdin through unchanged and exits 0', async () => {
    if (skipIfNotBuilt()) return;

    const garbage = 'not json at all!!!';
    const { code, stdout } = await runDistillScript(garbage);

    expect(code).toBe(0);
    expect(stdout).toBe(garbage);
  });
});
