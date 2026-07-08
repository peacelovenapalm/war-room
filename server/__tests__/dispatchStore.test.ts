/**
 * Unit tests for the dispatch queue store (v1 mechanic #6b).
 *
 * Covers: enqueue validation, the ringing-per-machine cap, runner
 * advertisement/pending polling, decide/reportStatus transitions (incl.
 * deny + unknown-id always being `{ ok: true }`), TTL expiry sweep,
 * restart-reload persistence, and audit-log lines.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DISPATCH_RINGING_CAP, DispatchStore } from '../src/dispatchStore.js';

let tmpDir: string;
let statePath: string;
let auditPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-store-'));
  statePath = path.join(tmpDir, 'dispatch-queue.json');
  auditPath = path.join(tmpDir, 'dispatch-audit.jsonl');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function readAuditLines(): Array<Record<string, unknown>> {
  if (!fs.existsSync(auditPath)) return [];
  return fs
    .readFileSync(auditPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe('DispatchStore.enqueue', () => {
  it('enqueues a valid dispatch request as ringing', () => {
    const s = new DispatchStore(statePath, auditPath);
    const result = s.enqueue({
      action: 'dispatch',
      machine: 'MACBOOK',
      provider: 'claude',
      cwd: '/Users/dev/proj',
      prompt: 'list files',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.record.status).toBe('ringing');
    expect(typeof result.record.id).toBe('string');
  });

  it('enqueues a valid focus request identified by sessionId', () => {
    const s = new DispatchStore(statePath, auditPath);
    const result = s.enqueue({ action: 'focus', machine: 'MACBOOK', sessionId: 'sess-1' });
    expect(result.ok).toBe(true);
  });

  it('rejects a dispatch request missing provider/cwd/prompt', () => {
    const s = new DispatchStore(statePath, auditPath);
    expect(s.enqueue({ action: 'dispatch', machine: 'MACBOOK' }).ok).toBe(false);
    expect(s.enqueue({ action: 'dispatch', machine: 'MACBOOK', provider: 'claude' }).ok).toBe(
      false,
    );
    expect(
      s.enqueue({
        action: 'dispatch',
        machine: 'MACBOOK',
        provider: 'bogus',
        cwd: '/x',
        prompt: 'p',
      }).ok,
    ).toBe(false);
  });

  it('rejects a focus request with neither sessionId nor pid', () => {
    const s = new DispatchStore(statePath, auditPath);
    const result = s.enqueue({ action: 'focus', machine: 'MACBOOK' });
    expect(result.ok).toBe(false);
  });

  it('rejects a prompt over the 4000-char cap', () => {
    const s = new DispatchStore(statePath, auditPath);
    const result = s.enqueue({
      action: 'dispatch',
      machine: 'MACBOOK',
      provider: 'claude',
      cwd: '/x',
      prompt: 'x'.repeat(4001),
    });
    expect(result.ok).toBe(false);
  });

  it('caps at DISPATCH_RINGING_CAP ringing requests per machine', () => {
    const s = new DispatchStore(statePath, auditPath);
    for (let i = 0; i < DISPATCH_RINGING_CAP; i++) {
      expect(
        s.enqueue({
          action: 'dispatch',
          machine: 'MACBOOK',
          provider: 'claude',
          cwd: '/x',
          prompt: `p${i}`,
        }).ok,
      ).toBe(true);
    }
    const overCap = s.enqueue({
      action: 'dispatch',
      machine: 'MACBOOK',
      provider: 'claude',
      cwd: '/x',
      prompt: 'one too many',
    });
    expect(overCap.ok).toBe(false);
    // A different machine is unaffected by MACBOOK's cap.
    expect(
      s.enqueue({ action: 'dispatch', machine: 'MINI', provider: 'claude', cwd: '/x', prompt: 'p' })
        .ok,
    ).toBe(true);
  });
});

describe('DispatchStore runner-facing surface', () => {
  it('advertises and lists only live machines within the TTL', () => {
    const s = new DispatchStore(statePath, auditPath);
    s.recordAdvertisement('MACBOOK', { providers: ['claude'], roots: ['/x'], focus: true }, 1000);
    expect(s.getMachines(1000)).toHaveLength(1);
    expect(s.getMachines(1000 + 30_001)).toHaveLength(0); // aged out past 30s TTL
    expect(s.getMachines(1000 + 10_000)).toHaveLength(1); // still fresh
  });

  it('pendingFor returns only ringing entries for that machine, WITH the full prompt', () => {
    const s = new DispatchStore(statePath, auditPath);
    s.enqueue({
      action: 'dispatch',
      machine: 'MACBOOK',
      provider: 'claude',
      cwd: '/x',
      prompt: 'the full prompt',
    });
    s.enqueue({
      action: 'dispatch',
      machine: 'MINI',
      provider: 'claude',
      cwd: '/x',
      prompt: 'other machine',
    });
    const pending = s.pendingFor('MACBOOK');
    expect(pending).toHaveLength(1);
    expect(pending[0].prompt).toBe('the full prompt');
  });
});

describe('DispatchStore.decide', () => {
  it('accept transitions ringing -> answered and records pid', () => {
    const s = new DispatchStore(statePath, auditPath);
    const enq = s.enqueue({
      action: 'dispatch',
      machine: 'MACBOOK',
      provider: 'claude',
      cwd: '/x',
      prompt: 'p',
    });
    if (!enq.ok) throw new Error('unreachable');
    s.decide(enq.record.id, 'accept', { pid: 4242 });
    const active = s.getActive();
    expect(active[0].status).toBe('answered');
    expect(active[0].pid).toBe(4242);
  });

  it('deny is a 2xx decision, never an error, and carries the reason', () => {
    const s = new DispatchStore(statePath, auditPath);
    const enq = s.enqueue({
      action: 'dispatch',
      machine: 'MACBOOK',
      provider: 'claude',
      cwd: '/x',
      prompt: 'p',
    });
    if (!enq.ok) throw new Error('unreachable');
    const result = s.decide(enq.record.id, 'deny', { reason: 'path-not-allowlisted' });
    expect(result.ok).toBe(true);
    expect(s.pendingFor('MACBOOK')).toHaveLength(0);
  });

  it('decision on an unknown id is still { ok: true } (2xx, never 404)', () => {
    const s = new DispatchStore(statePath, auditPath);
    const result = s.decide('does-not-exist', 'deny', { reason: 'unknown' });
    expect(result.ok).toBe(true);
  });

  it('a second decision on an already-decided id is an idempotent no-op', () => {
    const s = new DispatchStore(statePath, auditPath);
    const enq = s.enqueue({
      action: 'dispatch',
      machine: 'MACBOOK',
      provider: 'claude',
      cwd: '/x',
      prompt: 'p',
    });
    if (!enq.ok) throw new Error('unreachable');
    s.decide(enq.record.id, 'accept', {});
    s.decide(enq.record.id, 'deny', { reason: 'too-late' });
    const active = s.getActive();
    expect(active[0].status).toBe('answered'); // first decision wins
  });

  it('promptPreview truncates and never carries the full prompt on the broadcast plane', () => {
    const s = new DispatchStore(statePath, auditPath);
    const longPrompt = 'x'.repeat(500);
    const enq = s.enqueue({
      action: 'dispatch',
      machine: 'MACBOOK',
      provider: 'claude',
      cwd: '/x',
      prompt: longPrompt,
    });
    if (!enq.ok) throw new Error('unreachable');
    const active = s.getActive();
    expect(active[0].promptPreview?.length).toBe(120);
    expect((active[0] as unknown as Record<string, unknown>).prompt).toBeUndefined();
  });
});

describe('DispatchStore.reportStatus', () => {
  it('started attaches pid; exited sets terminal status + exitCode', () => {
    const s = new DispatchStore(statePath, auditPath);
    const enq = s.enqueue({
      action: 'dispatch',
      machine: 'MACBOOK',
      provider: 'claude',
      cwd: '/x',
      prompt: 'p',
    });
    if (!enq.ok) throw new Error('unreachable');
    s.decide(enq.record.id, 'accept', {});
    s.reportStatus(enq.record.id, { event: 'started', pid: 555 });
    expect(s.getActive()[0].pid).toBe(555);
    s.reportStatus(enq.record.id, { event: 'exited', exitCode: 0 });
    expect(s.getActive()).toHaveLength(0); // exited is terminal — no longer "active"
  });

  it('status report on an unknown id is still { ok: true }', () => {
    const s = new DispatchStore(statePath, auditPath);
    expect(s.reportStatus('nope', { event: 'exited', exitCode: 1 }).ok).toBe(true);
  });
});

describe('DispatchStore.sweepExpired', () => {
  it('expires ringing entries past the TTL and leaves fresh ones alone', () => {
    const s = new DispatchStore(statePath, auditPath);
    const DAY1 = 1_000_000;
    const enq = s.enqueue(
      { action: 'dispatch', machine: 'MACBOOK', provider: 'claude', cwd: '/x', prompt: 'p' },
      DAY1,
    );
    if (!enq.ok) throw new Error('unreachable');
    const count = s.sweepExpired(DAY1 + 601_000, 600_000);
    expect(count).toBe(1);
    expect(s.pendingFor('MACBOOK')).toHaveLength(0);
  });

  it('never expires an already-answered request', () => {
    const s = new DispatchStore(statePath, auditPath);
    const DAY1 = 1_000_000;
    const enq = s.enqueue(
      { action: 'dispatch', machine: 'MACBOOK', provider: 'claude', cwd: '/x', prompt: 'p' },
      DAY1,
    );
    if (!enq.ok) throw new Error('unreachable');
    s.decide(enq.record.id, 'accept', {}, DAY1 + 10);
    s.sweepExpired(DAY1 + 601_000, 600_000);
    expect(s.getActive()[0].status).toBe('answered');
  });
});

describe('DispatchStore onUpdate', () => {
  it('notifies subscribers on every transition and supports unsubscribe', () => {
    const s = new DispatchStore(statePath, auditPath);
    const seen: string[] = [];
    const unsubscribe = s.onUpdate((b) => seen.push(b.status));
    const enq = s.enqueue({
      action: 'dispatch',
      machine: 'MACBOOK',
      provider: 'claude',
      cwd: '/x',
      prompt: 'p',
    });
    if (!enq.ok) throw new Error('unreachable');
    s.decide(enq.record.id, 'accept', {});
    expect(seen).toEqual(['ringing', 'answered']);
    unsubscribe();
    s.reportStatus(enq.record.id, { event: 'exited', exitCode: 0 });
    expect(seen).toHaveLength(2);
  });
});

describe('DispatchStore persistence', () => {
  it('survives a restart (reload from the persisted file)', () => {
    const s1 = new DispatchStore(statePath, auditPath);
    const enq = s1.enqueue({
      action: 'dispatch',
      machine: 'MACBOOK',
      provider: 'claude',
      cwd: '/x',
      prompt: 'p',
    });
    if (!enq.ok) throw new Error('unreachable');

    const s2 = new DispatchStore(statePath, auditPath);
    expect(s2.pendingFor('MACBOOK')).toHaveLength(1);
    expect(s2.pendingFor('MACBOOK')[0].id).toBe(enq.record.id);
  });

  it('tolerates a missing/corrupt persisted file (fresh empty queue)', () => {
    fs.writeFileSync(statePath, 'not json {{{', 'utf8');
    const s = new DispatchStore(statePath, auditPath);
    expect(s.pendingFor('MACBOOK')).toHaveLength(0);
  });
});

describe('DispatchStore audit log', () => {
  it('appends an append-only JSONL line for enqueue, decision, status, and expiry', () => {
    const s = new DispatchStore(statePath, auditPath);
    const enq = s.enqueue({
      action: 'dispatch',
      machine: 'MACBOOK',
      provider: 'claude',
      cwd: '/x',
      prompt: 'p',
    });
    if (!enq.ok) throw new Error('unreachable');
    s.decide(enq.record.id, 'accept', {});
    s.reportStatus(enq.record.id, { event: 'exited', exitCode: 0 });

    const lines = readAuditLines();
    expect(lines.map((l) => l.event)).toEqual(['enqueue', 'decision', 'status']);
    expect(lines.every((l) => typeof l.ts === 'string')).toBe(true);
  });

  it('audits an unknown-id decision attempt without throwing', () => {
    const s = new DispatchStore(statePath, auditPath);
    s.decide('ghost-id', 'deny', { reason: 'unknown' });
    const lines = readAuditLines();
    expect(lines[0].event).toBe('decision-unknown-id');
  });
});
