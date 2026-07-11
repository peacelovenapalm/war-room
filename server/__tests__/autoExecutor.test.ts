/**
 * Unit tests for autoExecutor.ts (T3 self-healing ladder, RUNG 3 — auto
 * with guardrails). The load-bearing test is the FIRST one: a shipped
 * whitelist (no config file at all) must fire ZERO auto-actions even
 * across a fixture world full of eligible findings — the kickoff's hard
 * contract. Same fresh-module-graph-per-test isolation as opsAdvisor.test.ts
 * (dispatchStore/reworkBinStore/autoExecutorStore are process-wide
 * singletons; DISPATCH-WASTE and the whitelist file both need a genuinely
 * clean world per test, not just unique ids).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

// Reassigned fresh per test in beforeEach — a truly dynamic module bag.

let mods: any;

beforeEach(async () => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-executor-test-'));
  fs.mkdirSync(path.join(tmpBase, '.pixel-agents'), { recursive: true });
  vi.resetModules();
  const [agentStateStore, dispatchStoreMod, reworkBinStoreMod, autoExecutorMod, opsAdvisorMod] =
    await Promise.all([
      import('../src/agentStateStore.js'),
      import('../src/dispatchStore.js'),
      import('../src/reworkBinStore.js'),
      import('../src/autoExecutor.js'),
      import('../src/opsAdvisor.js'),
    ]);
  mods = {
    ...agentStateStore,
    ...dispatchStoreMod,
    ...reworkBinStoreMod,
    ...autoExecutorMod,
    ...opsAdvisorMod,
  };
});

afterEach(() => {
  try {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function whitelistPath(): string {
  return path.join(tmpBase, '.pixel-agents', 'auto-executor-whitelist.json');
}

function writeWhitelist(json: unknown): void {
  fs.writeFileSync(whitelistPath(), JSON.stringify(json), 'utf8');
}

/** Fails a dispatch and piles a matching rework crate — the exact real
 *  sequence opsAdvisor's dispatch-waste-failed finding requires for a
 *  REQUEUE proposal to exist. Returns the failed dispatch's id. */
function failAndPile(machine: string, prompt: string, pid: number): string {
  const result = mods.dispatchStore.enqueue({
    action: 'dispatch',
    machine,
    provider: 'claude',
    cwd: '/tmp',
    prompt,
  });
  expect(result.ok).toBe(true);
  mods.dispatchStore.decide(result.record.id, 'accept', { pid });
  mods.dispatchStore.reportStatus(result.record.id, { event: 'exited', exitCode: 1 });
  const pileResult = mods.reworkBinStore.pile('dispatch', {
    id: result.record.id,
    excerpt: 'boom',
  });
  expect(pileResult.ok).toBe(true);
  // opsAdvisor caches getOpsReview() for OPS_ADVISOR_CACHE_TTL_MS — force a
  // fresh derivation so this NEW crate is visible to the very next tick,
  // same as opsAdvisor.test.ts's own convention.
  mods.clearOpsReviewCache();
  return result.record.id;
}

/** Fails whichever dispatch the last auto-requeue just created (still
 *  'ringing' — a fresh enqueue, not yet accepted) and piles a matching
 *  crate, so it becomes a new dispatch-waste-failed candidate. Excludes
 *  any ids already accounted for, for scenarios chasing a specific lineage
 *  across more than one round. Returns the newly-failed dispatch's id. */
function failNewlyCreatedDispatch(excludeIds: string[] = []): string {
  const ringing = mods.dispatchStore
    .getRecent(20)
    .find(
      (r: { status: string; id: string }) => r.status === 'ringing' && !excludeIds.includes(r.id),
    );
  expect(ringing).toBeDefined();
  mods.dispatchStore.decide(ringing.id, 'accept', { pid: 999 });
  mods.dispatchStore.reportStatus(ringing.id, { event: 'exited', exitCode: 1 });
  const pileResult = mods.reworkBinStore.pile('dispatch', {
    id: ringing.id,
    excerpt: 'auto-created attempt failed too',
  });
  expect(pileResult.ok).toBe(true);
  mods.clearOpsReviewCache();
  return ringing.id;
}

describe('shipped-default: zero executions (load-bearing)', () => {
  it('a fresh deploy (no whitelist file at all) fires NOTHING, even with multiple eligible dispatch-waste-failed findings and piled crates', () => {
    const store = new mods.AgentStateStore();
    failAndPile('MACBOOK', 'fix the flaky test', 100);
    failAndPile('DESKBOX', 'ship the panel port', 200);
    failAndPile('MACBOOK', 'run migrations', 300);

    const fired = mods.autoExecutorStore.runTick(store, Date.now());
    expect(fired).toEqual([]);

    // Nothing was mutated: every crate is still piled, no new dispatches.
    expect(mods.reworkBinStore.getPiled()).toHaveLength(3);
    const status = mods.autoExecutorStore.getStatus();
    expect(status.receipts).toEqual([]);
    expect(status.whitelistLine).toBe('AUTO: OFF — whitelist empty');
    expect(status.actions['requeue-failed-dispatch'].enabled).toBe(false);
  });
});

describe('deny-by-default on a malformed/partial whitelist', () => {
  it('a corrupt (non-JSON) whitelist file is treated as OFF, not a crash', () => {
    fs.mkdirSync(path.dirname(whitelistPath()), { recursive: true });
    fs.writeFileSync(whitelistPath(), '{ not valid json', 'utf8');
    const store = new mods.AgentStateStore();
    failAndPile('MACBOOK', 'fix it', 100);
    expect(mods.autoExecutorStore.runTick(store, Date.now())).toEqual([]);
  });

  it('a whitelist with an empty actions object is OFF', () => {
    writeWhitelist({ actions: {} });
    const store = new mods.AgentStateStore();
    failAndPile('MACBOOK', 'fix it', 100);
    expect(mods.autoExecutorStore.runTick(store, Date.now())).toEqual([]);
  });

  it('an explicit enabled:false is OFF', () => {
    writeWhitelist({ actions: { 'requeue-failed-dispatch': { enabled: false } } });
    const store = new mods.AgentStateStore();
    failAndPile('MACBOOK', 'fix it', 100);
    expect(mods.autoExecutorStore.runTick(store, Date.now())).toEqual([]);
  });
});

describe('enabled: fires through the shared redispatchCrate() implementation', () => {
  it('a single eligible failure auto-requeues once, receipts the outcome, and marks the crate reworked', () => {
    writeWhitelist({ actions: { 'requeue-failed-dispatch': { enabled: true } } });
    const store = new mods.AgentStateStore();
    const failedId = failAndPile('MACBOOK', 'fix the flaky test', 100);

    const fired = mods.autoExecutorStore.runTick(store, Date.now());
    expect(fired).toHaveLength(1);
    expect(fired[0].actionKind).toBe('requeue-failed-dispatch');
    expect(fired[0].outcome.ok).toBe(true);
    expect(fired[0].cause.findingId).toBe('dispatch-waste-failed');
    // The cause carries the finding's VERBATIM receipts — never a re-derived summary.
    expect(fired[0].cause.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: expect.stringContaining(failedId.slice(0, 8)) }),
      ]),
    );
    expect(fired[0].undo).toContain('none');

    // The original crate is no longer piled (reworked); a NEW dispatch exists.
    expect(mods.reworkBinStore.getPiled()).toHaveLength(0);
    expect(mods.dispatchStore.getRecent(10).length).toBeGreaterThan(1);

    const status = mods.autoExecutorStore.getStatus();
    expect(status.receipts).toHaveLength(1);
    expect(status.whitelistLine).toBe('AUTO: requeue-failed-dispatch ON (cap 2, cooldown 10m)');
  });

  it('executes through the SAME redispatchCrate() the human tap uses — no forked implementation (a not-piled crate is rejected identically)', async () => {
    const { redispatchCrate } = (await import('../src/reworkRedispatch.js')) as {
      redispatchCrate: (id: string) => { ok: boolean; reason?: string };
    };
    writeWhitelist({ actions: { 'requeue-failed-dispatch': { enabled: true } } });
    const store = new mods.AgentStateStore();
    failAndPile('MACBOOK', 'fix it', 100);
    mods.autoExecutorStore.runTick(store, Date.now());
    // The crate is now reworked — calling the SHARED function again on the
    // same id must fail the identical way the route would.
    const piled = mods.reworkBinStore
      .getAll()
      .find((i: { status: string }) => i.status === 'reworked');
    const again = redispatchCrate(piled.id);
    expect(again).toEqual({ ok: false, reason: 'not-piled' });
  });
});

describe('guardrail: max auto-requeues per ORIGINAL dispatch id', () => {
  it('with maxPerId:1, a second consecutive auto-created failure is blocked purely by the cap (streak never reaches its own threshold)', () => {
    writeWhitelist({
      actions: {
        'requeue-failed-dispatch': { enabled: true, params: { maxPerId: 1, cooldownMs: 0 } },
      },
    });
    const store = new mods.AgentStateStore();
    failAndPile('MACBOOK', 'fix it', 100);

    const now = Date.now();
    const first = mods.autoExecutorStore.runTick(store, now);
    expect(first).toHaveLength(1); // A -> B, count now 1 for the A lineage

    // B (the auto-created dispatch) itself fails.
    failNewlyCreatedDispatch();

    const second = mods.autoExecutorStore.runTick(store, now + 1);
    expect(second).toEqual([]); // blocked by cap (count 1 >= maxPerId 1)
    expect(mods.reworkBinStore.getPiled()).toHaveLength(1); // B's crate stays piled — never fired, never dismissed
  });
});

describe('guardrail: cooldown between auto-requeues of the same lineage', () => {
  it('a second candidate within the cooldown window is held back; the SAME crate fires once the cooldown elapses', () => {
    writeWhitelist({
      actions: {
        'requeue-failed-dispatch': { enabled: true, params: { maxPerId: 10, cooldownMs: 1000 } },
      },
    });
    const store = new mods.AgentStateStore();
    failAndPile('MACBOOK', 'fix it', 100);

    const t0 = 1_000_000;
    expect(mods.autoExecutorStore.runTick(store, t0)).toHaveLength(1);

    failNewlyCreatedDispatch();

    // Within the cooldown — held back, crate untouched, no receipt.
    expect(mods.autoExecutorStore.runTick(store, t0 + 500)).toEqual([]);
    expect(mods.reworkBinStore.getPiled()).toHaveLength(1);
    expect(mods.autoExecutorStore.getStatus().receipts).toHaveLength(1);

    // Cooldown elapsed — the SAME still-piled crate fires now.
    const third = mods.autoExecutorStore.runTick(store, t0 + 1500);
    expect(third).toHaveLength(1);
    expect(mods.reworkBinStore.getPiled()).toHaveLength(0);
    expect(mods.autoExecutorStore.getStatus().receipts).toHaveLength(2);
  });
});

describe("guardrail: two consecutive auto-failures stops the lineage (human's turn)", () => {
  it('a high cap never blocks it, but the SECOND consecutive auto-created failure in a row permanently stops further auto-requeues for that lineage', () => {
    writeWhitelist({
      actions: {
        'requeue-failed-dispatch': { enabled: true, params: { maxPerId: 10, cooldownMs: 0 } },
      },
    });
    const store = new mods.AgentStateStore();
    failAndPile('MACBOOK', 'fix it', 100); // A — natural failure, not auto-created

    const now = Date.now();
    expect(mods.autoExecutorStore.runTick(store, now)).toHaveLength(1); // A -> B

    const b = failNewlyCreatedDispatch();

    // B was auto-created and has now failed — streak = 1, still under the
    // stop threshold (2), so this fires: B -> C.
    expect(mods.autoExecutorStore.runTick(store, now + 1)).toHaveLength(1);

    failNewlyCreatedDispatch([b]);

    // C was ALSO auto-created and has ALSO failed — two consecutive
    // auto-failures (B, then C) — the lineage stops for good, cap (10) is
    // nowhere near reached.
    const blocked = mods.autoExecutorStore.runTick(store, now + 2);
    expect(blocked).toEqual([]);
    expect(mods.reworkBinStore.getPiled()).toHaveLength(1); // C's crate stays piled — human's turn
    expect(mods.autoExecutorStore.getStatus().receipts).toHaveLength(2); // only A->B and B->C fired
  });
});

describe("SHIFT fold: autoActionCount reflects today's real receipts", () => {
  it('counts only receipts from today (local calendar day)', () => {
    writeWhitelist({ actions: { 'requeue-failed-dispatch': { enabled: true } } });
    const store = new mods.AgentStateStore();
    failAndPile('MACBOOK', 'fix it', 100);
    const now = Date.now();
    mods.autoExecutorStore.runTick(store, now);
    expect(mods.autoExecutorStore.getTodayReceiptCount(now)).toBe(1);

    // A receipt logged "now" must not count against a query anchored 25h earlier.
    const yesterday = now - 25 * 60 * 60_000;
    expect(mods.autoExecutorStore.getTodayReceiptCount(yesterday)).toBe(0);
  });
});
