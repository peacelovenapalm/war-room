/**
 * Unit tests for the contract store (G4, GAME-DESIGN.md §6.2).
 *
 * Covers: every constant asserted literally, priority mint/todo-disappeared
 * completion, backlog mint/completion + the 7-day re-minting dedupe
 * (mint→complete→re-mint-attempt-within-7-days→rejected), gate mint/
 * gate-flipped completion, the manual-claim 4th-of-the-day rejection,
 * dispatch-result completion via an explicit contractId (never string
 * matching), QUIET expiry on both priority and backlog (no Rep penalty —
 * KICKOFF-v3.1 hard rule 3, bonus-only now that this plane is player-
 * facing), self-certifying daily/weekly mint, and the VITEST-guard test
 * cloned from economyStore.test.ts's pattern.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Briefing } from '../src/briefingProvider.js';
import {
  CONTRACT_BACKLOG_CASH_CAP,
  CONTRACT_BACKLOG_CASH_PER_ITEM,
  CONTRACT_BACKLOG_REP_CAP,
  CONTRACT_BACKLOG_REP_DIVISOR,
  CONTRACT_DAILY_CASH,
  CONTRACT_GATE_CASH,
  CONTRACT_GATE_REP,
  CONTRACT_PRIORITY_CASH,
  CONTRACT_PRIORITY_REP,
  CONTRACT_WEEKLY_CASH,
  CONTRACT_WEEKLY_REP,
  ContractStore,
  contractStore,
  MAX_MANUAL_CLAIMS_PER_DAY,
} from '../src/contractStore.js';

let vitestGuardHome: string;
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => vitestGuardHome };
});

let tmpDir: string;
let statePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-store-'));
  statePath = path.join(tmpDir, 'contracts.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const DAY1 = new Date(2026, 6, 7, 12, 0, 0).getTime(); // Tue 2026-07-07 noon
const ONE_DAY_MS = 86_400_000;

function briefingWithTodo(
  startNow: string[],
  sections: Array<{ title: string; count: number }> = [],
  date = '2026-07-07',
): Briefing {
  return {
    todo: { date, startNow, sections },
    tracker: null,
    generatedAt: new Date(DAY1).toISOString(),
  };
}

function briefingWithGates(
  gates: Array<{ id: string; label: string; status: 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' }>,
): Briefing {
  return {
    todo: null,
    tracker: { milestone: 'test', gates: gates.map((g) => ({ ...g, done: 0, total: 1 })) },
    generatedAt: new Date(DAY1).toISOString(),
  };
}

describe('contract payout constants', () => {
  it('match the canonical GAME-DESIGN §6.2 table literally', () => {
    expect(CONTRACT_PRIORITY_CASH).toBe(40);
    expect(CONTRACT_PRIORITY_REP).toBe(2);
    expect(CONTRACT_BACKLOG_CASH_PER_ITEM).toBe(15);
    expect(CONTRACT_BACKLOG_CASH_CAP).toBe(150);
    expect(CONTRACT_BACKLOG_REP_DIVISOR).toBe(5);
    expect(CONTRACT_BACKLOG_REP_CAP).toBe(5);
    expect(CONTRACT_GATE_CASH).toBe(200);
    expect(CONTRACT_GATE_REP).toBe(10);
    expect(CONTRACT_DAILY_CASH).toBe(20);
    expect(CONTRACT_WEEKLY_CASH).toBe(100);
    expect(CONTRACT_WEEKLY_REP).toBe(5);
    expect(MAX_MANUAL_CLAIMS_PER_DAY).toBe(3);
  });
});

describe('ContractStore priority contracts', () => {
  it('mints a priority contract from a startNow line, then completes it via todo-disappeared', () => {
    const store = new ContractStore(statePath);
    store.reconcile(briefingWithTodo(['Ship the thing']), DAY1);
    const minted = store.getAll().find((c) => c.source === 'priority');
    expect(minted).toBeDefined();
    expect(minted!.payoutCash).toBe(CONTRACT_PRIORITY_CASH);
    expect(minted!.payoutRep).toBe(CONTRACT_PRIORITY_REP);
    expect(minted!.status).toBe('open');

    // Line vanished from the next reconcile — ground truth completion.
    store.reconcile(briefingWithTodo([]), DAY1 + 60_000);
    const after = store.getById(minted!.id)!;
    expect(after.status).toBe('completed');
    expect(after.completionMethod).toBe('todo-disappeared');
  });

  it('never double-mints the same open priority line on repeated reconciles', () => {
    const store = new ContractStore(statePath);
    store.reconcile(briefingWithTodo(['Ship the thing']), DAY1);
    store.reconcile(briefingWithTodo(['Ship the thing']), DAY1 + 60_000);
    expect(store.getAll().filter((c) => c.source === 'priority')).toHaveLength(1);
  });

  it('expires QUIETLY past its deadline — no Rep penalty, no Cash movement (hard rule 3)', () => {
    // Panel finding (contractStore.ts:464): this plane is what the v3
    // ContractsPanel surfaces, so docking REP for not attending to a todo
    // is exactly the loss-aversion-around-attention pattern hard rule 3
    // forbids. Expiry is now a status flip only — bonus-only economy.
    let repDelta = 0;
    let cashDelta = 0;
    const store = new ContractStore(statePath, {
      awardReputation: (amt) => (repDelta += amt),
      awardCash: (amt) => (cashDelta += amt),
    });
    store.reconcile(briefingWithTodo(['Ship the thing']), DAY1);
    // Past the 2-day deadline, line still present (never completed).
    store.reconcile(briefingWithTodo(['Ship the thing']), DAY1 + 3 * ONE_DAY_MS);
    const contract = store.getAll().find((c) => c.source === 'priority')!;
    expect(contract.status).toBe('expired');
    expect(repDelta).toBe(0);
    expect(cashDelta).toBe(0);
  });
});

describe('ContractStore backlog contracts + 7-day re-minting dedupe', () => {
  it('mints, completes, and rejects a re-mint within 7 days', () => {
    const store = new ContractStore(statePath);
    store.reconcile(briefingWithTodo([], [{ title: 'Bugs', count: 10 }]), DAY1);
    const minted = store.getAll().find((c) => c.source === 'backlog')!;
    expect(minted.payoutCash).toBe(Math.min(CONTRACT_BACKLOG_CASH_CAP, 15 * 10));
    expect(minted.payoutRep).toBe(
      Math.min(CONTRACT_BACKLOG_REP_CAP, Math.floor(10 / CONTRACT_BACKLOG_REP_DIVISOR)),
    );

    // Section cleared — ground-truth completion.
    store.reconcile(briefingWithTodo([], [{ title: 'Bugs', count: 0 }]), DAY1 + 60_000);
    expect(store.getById(minted.id)!.status).toBe('completed');

    // Section repopulates within 7 days — must NOT mint a second payable contract.
    store.reconcile(briefingWithTodo([], [{ title: 'Bugs', count: 5 }]), DAY1 + 2 * ONE_DAY_MS);
    expect(store.getAll().filter((c) => c.source === 'backlog')).toHaveLength(1);

    // Past the 7-day lookback, a fresh contract is allowed again.
    store.reconcile(briefingWithTodo([], [{ title: 'Bugs', count: 5 }]), DAY1 + 8 * ONE_DAY_MS);
    expect(store.getAll().filter((c) => c.source === 'backlog')).toHaveLength(2);
  });

  it('caps backlog payout at 150 Cash / 5 Rep for a large count', () => {
    const store = new ContractStore(statePath);
    store.reconcile(briefingWithTodo([], [{ title: 'Everything', count: 50 }]), DAY1);
    const minted = store.getAll().find((c) => c.source === 'backlog')!;
    expect(minted.payoutCash).toBe(CONTRACT_BACKLOG_CASH_CAP);
    expect(minted.payoutRep).toBe(CONTRACT_BACKLOG_REP_CAP);
  });

  it('expires silently (no Reputation penalty) past its 7-day deadline', () => {
    let repDelta = 0;
    const store = new ContractStore(statePath, { awardReputation: (amt) => (repDelta += amt) });
    store.reconcile(briefingWithTodo([], [{ title: 'Bugs', count: 10 }]), DAY1);
    store.reconcile(briefingWithTodo([], [{ title: 'Bugs', count: 10 }]), DAY1 + 8 * ONE_DAY_MS);
    const contract = store.getAll().find((c) => c.source === 'backlog')!;
    expect(contract.status).toBe('expired');
    expect(repDelta).toBe(0);
  });
});

describe('ContractStore gate contracts', () => {
  it('mints an open gate contract, then completes via gate-flipped when DONE', () => {
    const store = new ContractStore(statePath);
    store.reconcile(
      briefingWithGates([{ id: 'G1', label: 'Gate One', status: 'IN_PROGRESS' }]),
      DAY1,
    );
    const minted = store.getAll().find((c) => c.source === 'gate')!;
    expect(minted.status).toBe('open');
    expect(minted.payoutCash).toBe(CONTRACT_GATE_CASH);
    expect(minted.payoutRep).toBe(CONTRACT_GATE_REP);

    store.reconcile(
      briefingWithGates([{ id: 'G1', label: 'Gate One', status: 'DONE' }]),
      DAY1 + 60_000,
    );
    expect(store.getById(minted.id)!.status).toBe('completed');
    expect(store.getById(minted.id)!.completionMethod).toBe('gate-flipped');
  });

  it('never re-mints or re-pays a gate contract once completed', () => {
    const store = new ContractStore(statePath);
    store.reconcile(briefingWithGates([{ id: 'G1', label: 'Gate One', status: 'DONE' }]), DAY1);
    store.reconcile(
      briefingWithGates([{ id: 'G1', label: 'Gate One', status: 'IN_PROGRESS' }]),
      DAY1 + 60_000,
    );
    store.reconcile(
      briefingWithGates([{ id: 'G1', label: 'Gate One', status: 'DONE' }]),
      DAY1 + 120_000,
    );
    expect(store.getAll().filter((c) => c.source === 'gate')).toHaveLength(1);
  });
});

describe('ContractStore manual claim (rate-limited escape hatch)', () => {
  function mintThreeOpen(store: ContractStore, now: number) {
    store.reconcile(briefingWithTodo(['a', 'b', 'c', 'd']), now);
  }

  it('allows up to 3 claims per local day and rejects the 4th with a clear reason', () => {
    const store = new ContractStore(statePath);
    mintThreeOpen(store, DAY1);
    const [c1, c2, c3, c4] = store.getAll();
    expect(store.claim(c1.id, DAY1).ok).toBe(true);
    expect(store.claim(c2.id, DAY1).ok).toBe(true);
    expect(store.claim(c3.id, DAY1).ok).toBe(true);
    const fourth = store.claim(c4.id, DAY1);
    expect(fourth.ok).toBe(false);
    expect(fourth).toMatchObject({ ok: false, reason: 'manual-claim-daily-cap' });
    // The 4th contract must remain untouched (never silently no-op'd as a
    // fake success — it stays open).
    expect(store.getById(c4.id)!.status).toBe('open');
  });

  it('resets the daily counter on a new local day', () => {
    const store = new ContractStore(statePath);
    mintThreeOpen(store, DAY1);
    const [c1, c2, c3, c4] = store.getAll();
    store.claim(c1.id, DAY1);
    store.claim(c2.id, DAY1);
    store.claim(c3.id, DAY1);
    const nextDay = DAY1 + ONE_DAY_MS;
    expect(store.claim(c4.id, nextDay).ok).toBe(true);
  });

  it('rejects claiming an already-completed or unknown contract', () => {
    const store = new ContractStore(statePath);
    mintThreeOpen(store, DAY1);
    const [c1] = store.getAll();
    store.claim(c1.id, DAY1);
    expect(store.claim(c1.id, DAY1)).toMatchObject({ ok: false, reason: 'not-open' });
    expect(store.claim('unknown-id', DAY1)).toMatchObject({ ok: false, reason: 'not-found' });
  });
});

describe('ContractStore dispatch-result completion (explicit contractId)', () => {
  it('completes an open contract by id, and no-ops on an unknown/non-open id', () => {
    const store = new ContractStore(statePath);
    store.reconcile(briefingWithTodo(['Ship the thing']), DAY1);
    const contract = store.getAll()[0];
    store.completeByDispatch(contract.id, DAY1 + 1000);
    expect(store.getById(contract.id)!.status).toBe('completed');
    expect(store.getById(contract.id)!.completionMethod).toBe('dispatch-result');

    // No-op, never throws, on an unknown id or an already-terminal one.
    expect(() => store.completeByDispatch('unknown', DAY1)).not.toThrow();
    expect(() => store.completeByDispatch(contract.id, DAY1)).not.toThrow();
  });
});

describe('ContractStore dailies/weeklies (self-certifying)', () => {
  it('mintDaily is idempotent per local date and pays CONTRACT_DAILY_CASH', () => {
    let cashDelta = 0;
    const store = new ContractStore(statePath, { awardCash: (amt) => (cashDelta += amt) });
    const first = store.mintDaily(DAY1);
    expect(first).toBeDefined();
    expect(first!.status).toBe('completed');
    expect(first!.completionMethod).toBe('daily-auto');
    expect(cashDelta).toBe(CONTRACT_DAILY_CASH);

    const second = store.mintDaily(DAY1 + 1000);
    expect(second).toBeUndefined();
    expect(cashDelta).toBe(CONTRACT_DAILY_CASH); // unchanged — no double-pay
  });

  it('mintWeekly is idempotent per local date and pays CONTRACT_WEEKLY_CASH/REP', () => {
    let cashDelta = 0;
    let repDelta = 0;
    const store = new ContractStore(statePath, {
      awardCash: (amt) => (cashDelta += amt),
      awardReputation: (amt) => (repDelta += amt),
    });
    const first = store.mintWeekly(DAY1);
    expect(first!.status).toBe('completed');
    expect(cashDelta).toBe(CONTRACT_WEEKLY_CASH);
    expect(repDelta).toBe(CONTRACT_WEEKLY_REP);
    expect(store.mintWeekly(DAY1 + 1000)).toBeUndefined();
  });
});

describe('ContractStore onCompleted listener', () => {
  it('fires exactly once per completion', () => {
    const store = new ContractStore(statePath);
    const seen: string[] = [];
    store.onCompleted((c) => seen.push(c.id));
    store.mintDaily(DAY1);
    expect(seen).toHaveLength(1);
  });
});

describe('VITEST guard (cloned from economyStore.test.ts pattern)', () => {
  beforeEach(() => {
    vitestGuardHome = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-store-vitest-guard-'));
  });

  it('never writes the real default sidecar path under VITEST, even via the process-wide singleton', () => {
    contractStore.mintDaily(DAY1);
    const expectedPath = path.join(vitestGuardHome, '.pixel-agents', 'contracts.json');
    expect(fs.existsSync(expectedPath)).toBe(false);
  });
});
