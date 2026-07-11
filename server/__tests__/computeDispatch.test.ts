/**
 * T8 Mini compute — server side (MINI-COMPUTE-NODE.md). The `shell` provider
 * rides the EXISTING dispatch queue/decision/lifecycle: enqueue validation
 * (scriptId/args, no cwd/prompt), the runner poll forwarding scriptId+args,
 * and the machine advertisement carrying script NAMES (never paths).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

const { DispatchStore } = await import('../src/dispatchStore.js');
const { PixelAgentsServer } = await import('../src/server.js');
const { AgentStateStore } = await import('../src/agentStateStore.js');

function uniqueMachine(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`.toUpperCase();
}

beforeEach(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-compute-test-'));
  fs.mkdirSync(path.join(tmpBase, '.pixel-agents'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

describe('DispatchStore: shell (compute) enqueue', () => {
  it('accepts a shell dispatch with a scriptId + plain args, NO cwd/prompt', () => {
    const store = new DispatchStore();
    const r = store.enqueue({
      action: 'dispatch',
      machine: 'MINI',
      provider: 'shell',
      scriptId: 'photo-resize',
      args: ['--width=800', '/in'],
    });
    expect(r.ok).toBe(true);
    const item = store.pendingFor('MINI')[0];
    expect(item.provider).toBe('shell');
    expect(item.scriptId).toBe('photo-resize');
    expect(item.args).toEqual(['--width=800', '/in']);
    expect(item.cwd).toBeUndefined();
    expect(item.prompt).toBeUndefined();
  });

  it('rejects a shell dispatch with a bad scriptId, non-array/too-many args, or session action', () => {
    const store = new DispatchStore();
    expect(store.enqueue({ action: 'dispatch', machine: 'M', provider: 'shell' })).toEqual({
      ok: false,
      reason: 'invalid-scriptId',
    });
    expect(
      store.enqueue({ action: 'dispatch', machine: 'M', provider: 'shell', scriptId: 'bad id' }),
    ).toEqual({ ok: false, reason: 'invalid-scriptId' });
    expect(
      store.enqueue({
        action: 'dispatch',
        machine: 'M',
        provider: 'shell',
        scriptId: 'ok',
        args: 'nope' as unknown as string[],
      }),
    ).toEqual({ ok: false, reason: 'invalid-args' });
    expect(
      store.enqueue({
        action: 'dispatch',
        machine: 'M',
        provider: 'shell',
        scriptId: 'ok',
        args: Array.from({ length: 17 }, (_, i) => String(i)),
      }),
    ).toEqual({ ok: false, reason: 'too-many-args' });
    expect(
      store.enqueue({ action: 'session', machine: 'M', provider: 'shell', scriptId: 'ok' }),
    ).toEqual({ ok: false, reason: 'shell-must-be-dispatch' });
  });

  it('an LLM provider still requires prompt/cwd; a bare shell never carries them', () => {
    const store = new DispatchStore();
    expect(
      store.enqueue({ action: 'dispatch', machine: 'M', provider: 'claude', cwd: '/tmp' }),
    ).toEqual({ ok: false, reason: 'missing-prompt' });
    // shell record carries no prompt/cwd even if the client sent them.
    const r = store.enqueue({
      action: 'dispatch',
      machine: 'M',
      provider: 'shell',
      scriptId: 'ok',
      cwd: '/etc',
      prompt: 'ignored',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.cwd).toBeUndefined();
      expect(r.record.prompt).toBeUndefined();
    }
  });
});

describe('compute advertisement + poll (wired server)', () => {
  let server: InstanceType<typeof PixelAgentsServer>;

  beforeEach(() => {
    server = new PixelAgentsServer();
  });
  afterEach(async () => {
    await server.stop();
  });

  it('poll scriptIds advertise on GET /api/dispatch/machines; a shell request reaches the runner with scriptId+args', async () => {
    const machine = uniqueMachine('MINI');
    const config = await server.start({ embedded: false, store: new AgentStateStore() });

    // Runner advertises registered compute script NAMES.
    await fetch(`http://127.0.0.1:${config.port}/api/dispatch/poll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
        'X-Machine': machine,
      },
      body: JSON.stringify({
        providers: ['claude'],
        roots: ['/tmp'],
        focus: false,
        scriptIds: ['photo-resize', 'immich-hash'],
      }),
    });
    const machines = (await (
      await fetch(`http://127.0.0.1:${config.port}/api/dispatch/machines`)
    ).json()) as Array<{ machine: string; scriptIds?: string[] }>;
    expect(machines.find((m) => m.machine === machine)?.scriptIds).toEqual([
      'photo-resize',
      'immich-hash',
    ]);

    // A shell dispatchRequest reaches the runner poll with scriptId + args.
    const ws = new WebSocket(`ws://127.0.0.1:${config.port}/ws`);
    await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
    ws.send(
      JSON.stringify({
        type: 'dispatchRequest',
        action: 'dispatch',
        machine,
        provider: 'shell',
        scriptId: 'photo-resize',
        args: ['--width=800'],
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    const pollRes = await fetch(`http://127.0.0.1:${config.port}/api/dispatch/poll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.token}`,
        'X-Machine': machine,
      },
      body: JSON.stringify({ providers: ['claude'], roots: ['/tmp'], focus: false }),
    });
    const pollBody = (await pollRes.json()) as {
      pending: Array<{ provider?: string; scriptId?: string; args?: string[]; cwd?: string }>;
    };
    expect(pollBody.pending).toHaveLength(1);
    expect(pollBody.pending[0].provider).toBe('shell');
    expect(pollBody.pending[0].scriptId).toBe('photo-resize');
    expect(pollBody.pending[0].args).toEqual(['--width=800']);
    expect(pollBody.pending[0].cwd).toBeUndefined();
    ws.close();
  });
});
