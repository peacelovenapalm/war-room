/**
 * Unit tests for selfHeal.ts (V6-4 autonomy rung 1 — four pre-approved
 * self-heal action classes). Mirrors autoExecutor.test.ts's isolation
 * discipline: dispatchStore/selfHealStore are process-wide singletons and
 * selfHealStore/stopAllLatch persist to `~/.pixel-agents/`, so every test
 * gets a genuinely fresh module graph via `vi.resetModules()` + a fresh
 * temp HOME.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tmpBase: string;
let routinesDir: string;
const ORIGINAL_ENV = { ...process.env };

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

// Reassigned fresh per test in beforeEach — a truly dynamic module bag.
let mods: any;

beforeEach(async () => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'self-heal-test-'));
  fs.mkdirSync(path.join(tmpBase, '.pixel-agents'), { recursive: true });
  routinesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-heal-routines-'));
  process.env = { ...ORIGINAL_ENV };
  delete process.env.WAR_ROOM_SELF_HEAL_TARGET_MACHINE;
  delete process.env.WAR_ROOM_ROUTINES_DIR;
  vi.resetModules();
  const [agentStateStoreMod, dispatchStoreMod, stopAllLatchMod, inboxProviderMod, selfHealMod] =
    await Promise.all([
      import('../src/agentStateStore.js'),
      import('../src/dispatchStore.js'),
      import('../src/stopAllLatch.js'),
      import('../src/inboxProvider.js'),
      import('../src/selfHeal.js'),
    ]);
  mods = {
    ...agentStateStoreMod,
    ...dispatchStoreMod,
    ...stopAllLatchMod,
    ...inboxProviderMod,
    ...selfHealMod,
  };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  try {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(routinesDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function neverPaused(): { paused: boolean; reason?: string } {
  return { paused: false };
}

function alwaysPaused(reason = 'stale-snapshot'): { paused: boolean; reason?: string } {
  return { paused: true, reason };
}

/** selfHealStore's default-constructed singleton resolves an implicit
 *  (unmocked-in-value, but still real) default path — V3JsonPersistence's
 *  own VITEST + usingDefaultPath guard then skips every persist() call,
 *  same pitfall standingOrderStore.test.ts already works around by
 *  constructing its OWN instance with an EXPLICIT path per test. Used only
 *  where a test needs a flag flip to round-trip through a fresh load(). */
function newStore(): any {
  return new mods.SelfHealStore(
    path.join(tmpBase, '.pixel-agents', 'self-heal-flags-explicit.json'),
    path.join(tmpBase, '.pixel-agents', 'self-heal-state-explicit.json'),
  );
}

function advertiseMachine(machine: string, scriptIds: string[], now: number): void {
  mods.dispatchStore.recordAdvertisement(
    machine,
    { providers: ['claude'], roots: ['/tmp'], focus: false, scriptIds },
    now,
  );
}

describe('closed-class guard', () => {
  it('rejects an unknown class at runtime, never trusting the TS type alone', () => {
    const result = mods.selfHealStore.runAction(
      { class: 'delete-the-vault', target: 'x', detail: 'y' },
      { now: Date.now(), isAutomationPaused: neverPaused },
    );
    expect(result).toEqual({ ok: false, reason: 'unknown-class' });
    expect(mods.selfHealStore.getReceipts()).toEqual([]);
  });

  it('rejects an unknown class in setClassEnabled', () => {
    expect(mods.selfHealStore.setClassEnabled('not-a-real-class', false)).toEqual({
      ok: false,
      reason: 'unknown-class',
    });
  });

  it('rejects an unknown class in spawnStandingOrder', () => {
    expect(mods.selfHealStore.spawnStandingOrder('not-a-real-class')).toEqual({
      ok: false,
      reason: 'unknown-class',
    });
  });

  it('isSelfHealClass accepts exactly the four registered classes and nothing else', () => {
    for (const cls of mods.SELF_HEAL_CLASSES) {
      expect(mods.isSelfHealClass(cls)).toBe(true);
    }
    expect(mods.isSelfHealClass('restart-dead-runner-v2')).toBe(false);
    expect(mods.isSelfHealClass('')).toBe(false);
    expect(mods.SELF_HEAL_CLASSES).toHaveLength(4);
  });
});

describe('STOP-ALL suppression', () => {
  it('an engaged latch suppresses execution and writes a suppressed receipt — never runs anything', () => {
    const now = Date.now();
    advertiseMachine('MACBOOK', ['refresh-stale-clone'], now);
    process.env.WAR_ROOM_SELF_HEAL_TARGET_MACHINE = 'MACBOOK';
    mods.stopAllLatch.engage(now);

    const result = mods.selfHealStore.runAction(
      { class: 'refresh-stale-clone', target: 'routines-clone', detail: 'stale' },
      { now, isAutomationPaused: neverPaused },
    );
    expect(result.ok).toBe(true);
    expect(result.receipt).toMatchObject({
      class: 'refresh-stale-clone',
      outcome: 'suppressed',
      suppressedReason: 'stop-all-latch',
    });
    // Nothing was dispatched.
    expect(mods.dispatchStore.getRecent(10)).toHaveLength(0);
  });

  it('release() re-arms execution once the cooldown window is a fresh target', () => {
    const now = Date.now();
    advertiseMachine('MACBOOK', ['refresh-stale-clone'], now);
    process.env.WAR_ROOM_SELF_HEAL_TARGET_MACHINE = 'MACBOOK';
    mods.stopAllLatch.engage(now);
    mods.selfHealStore.runAction(
      { class: 'refresh-stale-clone', target: 'routines-clone', detail: 'stale' },
      { now, isAutomationPaused: neverPaused },
    );
    mods.stopAllLatch.release(now);

    const later = now + 20 * 60_000; // past the per-target cooldown
    advertiseMachine('MACBOOK', ['refresh-stale-clone'], later);
    const result = mods.selfHealStore.runAction(
      { class: 'refresh-stale-clone', target: 'routines-clone', detail: 'stale' },
      { now: later, isAutomationPaused: neverPaused },
    );
    expect(result.ok).toBe(true);
    expect(result.receipt?.outcome).toBe('executed');
  });
});

describe('budget-pause suppression', () => {
  it('a paused budget gate suppresses execution before the per-class flag is even checked', () => {
    const now = Date.now();
    advertiseMachine('MACBOOK', ['refresh-stale-clone'], now);
    process.env.WAR_ROOM_SELF_HEAL_TARGET_MACHINE = 'MACBOOK';
    mods.selfHealStore.setClassEnabled('refresh-stale-clone', false); // would ALSO suppress

    const result = mods.selfHealStore.runAction(
      { class: 'refresh-stale-clone', target: 'routines-clone', detail: 'stale' },
      { now, isAutomationPaused: () => alwaysPaused('5h-threshold') },
    );
    expect(result.ok).toBe(true);
    expect(result.receipt).toMatchObject({
      outcome: 'suppressed',
      suppressedReason: 'budget-paused',
    });
    expect(result.receipt?.detail).toContain('5h-threshold');
  });
});

describe('per-class flags', () => {
  it('default ON for all four classes', () => {
    const flags = mods.selfHealStore.getFlags();
    for (const cls of mods.SELF_HEAL_CLASSES) {
      expect(flags[cls]).toBe(true);
    }
  });

  it('disabling a class suppresses execution and is readable back via getFlags/status', () => {
    const store = newStore();
    const now = Date.now();
    advertiseMachine('MACBOOK', ['refresh-stale-clone'], now);
    process.env.WAR_ROOM_SELF_HEAL_TARGET_MACHINE = 'MACBOOK';

    const setResult = store.setClassEnabled('refresh-stale-clone', false, now);
    expect(setResult).toEqual({ ok: true });
    expect(store.getFlags()['refresh-stale-clone']).toBe(false);

    const result = store.runAction(
      { class: 'refresh-stale-clone', target: 'routines-clone', detail: 'stale' },
      { now, isAutomationPaused: neverPaused },
    );
    expect(result.receipt).toMatchObject({
      outcome: 'suppressed',
      suppressedReason: 'class-disabled',
    });

    const status = mods.getSelfHealStatus(store);
    expect(status.flags['refresh-stale-clone']).toBe(false);
    expect(status.flags['restart-dead-runner']).toBe(true);
  });

  it('re-enabling restores execution', () => {
    const store = newStore();
    const now = Date.now();
    advertiseMachine('MACBOOK', ['refresh-stale-clone'], now);
    process.env.WAR_ROOM_SELF_HEAL_TARGET_MACHINE = 'MACBOOK';
    store.setClassEnabled('refresh-stale-clone', false, now);
    store.setClassEnabled('refresh-stale-clone', true, now);

    const result = store.runAction(
      { class: 'refresh-stale-clone', target: 'routines-clone', detail: 'stale' },
      { now, isAutomationPaused: neverPaused },
    );
    expect(result.receipt?.outcome).toBe('executed');
  });
});

describe('proposal-only classes never execute', () => {
  it('restart-dead-runner always suppresses with reason "proposal-only" — there is no plane that can reach a dead poller', () => {
    const now = Date.now();
    const result = mods.selfHealStore.runAction(
      { class: 'restart-dead-runner', target: 'DESKBOX', detail: 'silent 6m' },
      { now, isAutomationPaused: neverPaused },
    );
    expect(result.receipt).toMatchObject({
      class: 'restart-dead-runner',
      plane: 'proposal-only',
      outcome: 'suppressed',
      suppressedReason: 'proposal-only',
    });
    expect(mods.dispatchStore.getRecent(10)).toHaveLength(0);
  });

  it('mechanical-vault-fix always suppresses with reason "proposal-only" — no vault-health source exists yet', () => {
    const now = Date.now();
    const result = mods.selfHealStore.runAction(
      { class: 'mechanical-vault-fix', target: 'vault', detail: 'hypothetical' },
      { now, isAutomationPaused: neverPaused },
    );
    expect(result.receipt).toMatchObject({
      plane: 'proposal-only',
      outcome: 'suppressed',
      suppressedReason: 'proposal-only',
    });
  });
});

describe('shell-dispatch classes: honest availability gating', () => {
  it('no target machine configured -> suppressed "no-target-machine"', () => {
    const now = Date.now();
    const result = mods.selfHealStore.runAction(
      { class: 'refresh-stale-clone', target: 'routines-clone', detail: 'stale' },
      { now, isAutomationPaused: neverPaused },
    );
    expect(result.receipt).toMatchObject({
      outcome: 'suppressed',
      suppressedReason: 'no-target-machine',
    });
  });

  it('configured target machine has no live advertisement -> suppressed "machine-not-live"', () => {
    process.env.WAR_ROOM_SELF_HEAL_TARGET_MACHINE = 'GHOSTBOX';
    const now = Date.now();
    const result = mods.selfHealStore.runAction(
      { class: 'refresh-stale-clone', target: 'routines-clone', detail: 'stale' },
      { now, isAutomationPaused: neverPaused },
    );
    expect(result.receipt).toMatchObject({
      outcome: 'suppressed',
      suppressedReason: 'machine-not-live',
    });
  });

  it('live machine that does not advertise the matching scriptId -> suppressed "script-not-advertised"', () => {
    const now = Date.now();
    advertiseMachine('MACBOOK', ['some-other-script'], now);
    process.env.WAR_ROOM_SELF_HEAL_TARGET_MACHINE = 'MACBOOK';
    const result = mods.selfHealStore.runAction(
      { class: 'refresh-stale-clone', target: 'routines-clone', detail: 'stale' },
      { now, isAutomationPaused: neverPaused },
    );
    expect(result.receipt).toMatchObject({
      outcome: 'suppressed',
      suppressedReason: 'script-not-advertised',
    });
  });

  it('live machine advertising the matching scriptId -> executes through dispatchStore.enqueue (shell)', () => {
    const now = Date.now();
    advertiseMachine('MACBOOK', ['refresh-stale-clone'], now);
    process.env.WAR_ROOM_SELF_HEAL_TARGET_MACHINE = 'MACBOOK';

    const result = mods.selfHealStore.runAction(
      { class: 'refresh-stale-clone', target: 'routines-clone', detail: 'stale' },
      { now, isAutomationPaused: neverPaused },
    );
    expect(result.receipt?.outcome).toBe('executed');
    expect(result.receipt?.dispatchId).toBeDefined();

    const recent = mods.dispatchStore.getRecent(10);
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({
      id: result.receipt?.dispatchId,
      machine: 'MACBOOK',
      provider: 'shell',
      status: 'ringing',
    });
  });

  it('rerun-failed-routine follows the identical shell-dispatch gate', () => {
    const now = Date.now();
    advertiseMachine('MACBOOK', ['rerun-failed-routine'], now);
    process.env.WAR_ROOM_SELF_HEAL_TARGET_MACHINE = 'MACBOOK';
    const result = mods.selfHealStore.runAction(
      { class: 'rerun-failed-routine', target: 'some-routine', detail: 'hypothetical failure' },
      { now, isAutomationPaused: neverPaused },
    );
    expect(result.receipt?.outcome).toBe('executed');
    expect(result.receipt?.dispatchId).toBeDefined();
  });
});

describe('per-target cooldown', () => {
  it('a second decision for the same class+target within the cooldown window is a silent no-op (no new receipt)', () => {
    const now = Date.now();
    const first = mods.selfHealStore.runAction(
      { class: 'restart-dead-runner', target: 'DESKBOX', detail: 'silent' },
      { now, isAutomationPaused: neverPaused },
    );
    expect(first.receipt).not.toBeNull();

    const second = mods.selfHealStore.runAction(
      { class: 'restart-dead-runner', target: 'DESKBOX', detail: 'still silent' },
      { now: now + 1000, isAutomationPaused: neverPaused },
    );
    expect(second).toEqual({ ok: true, receipt: null });
    expect(mods.selfHealStore.getReceipts()).toHaveLength(1);
  });

  it("a different target for the same class is NOT covered by the other target's cooldown", () => {
    const now = Date.now();
    mods.selfHealStore.runAction(
      { class: 'restart-dead-runner', target: 'DESKBOX', detail: 'silent' },
      { now, isAutomationPaused: neverPaused },
    );
    const other = mods.selfHealStore.runAction(
      { class: 'restart-dead-runner', target: 'MINI', detail: 'also silent' },
      { now: now + 1000, isAutomationPaused: neverPaused },
    );
    expect(other.receipt).not.toBeNull();
    expect(mods.selfHealStore.getReceipts()).toHaveLength(2);
  });
});

describe('receipt shape', () => {
  it('carries every documented field verbatim', () => {
    const now = Date.now();
    const result = mods.selfHealStore.runAction(
      { class: 'restart-dead-runner', target: 'DESKBOX', detail: 'silent 6m' },
      { now, isAutomationPaused: neverPaused },
    );
    const receipt = result.receipt;
    expect(receipt).toMatchObject({
      ts: now,
      class: 'restart-dead-runner',
      target: 'DESKBOX',
      plane: 'proposal-only',
      outcome: 'suppressed',
      suppressedReason: 'proposal-only',
      detail: 'silent 6m',
    });
    expect(typeof receipt.undoNote).toBe('string');
    expect(receipt.undoNote.length).toBeGreaterThan(0);
  });

  it('getReceipts() returns newest-first', () => {
    const now = Date.now();
    mods.selfHealStore.runAction(
      { class: 'restart-dead-runner', target: 'A', detail: 'x' },
      { now, isAutomationPaused: neverPaused },
    );
    mods.selfHealStore.runAction(
      { class: 'restart-dead-runner', target: 'B', detail: 'y' },
      { now: now + 1, isAutomationPaused: neverPaused },
    );
    const receipts = mods.selfHealStore.getReceipts();
    expect(receipts[0].target).toBe('B');
    expect(receipts[1].target).toBe('A');
  });
});

describe('standing-order spawn (honest containment decline)', () => {
  it('every spawn attempt is receipted, even though it is honestly declined', () => {
    const now = Date.now();
    const result = mods.selfHealStore.spawnStandingOrder('refresh-stale-clone', now);
    expect(result.ok).toBe(true);
    expect(result.receipt).toMatchObject({
      class: 'refresh-stale-clone',
      target: 'standing-order',
      outcome: 'suppressed',
      suppressedReason: 'standing-orders-lack-shell-dispatch-support',
    });
    expect(mods.selfHealStore.getReceipts()).toHaveLength(1);
  });
});

describe('detection: honest signals only', () => {
  it('detects a dead runner from dispatchStore machine advertisements past the dead threshold', () => {
    const now = Date.now();
    advertiseMachine('DESKBOX', [], now - 10 * 60_000); // 10m old, past the 5m threshold
    const candidates = mods.detectSelfHealCandidates(now);
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ class: 'restart-dead-runner', target: 'DESKBOX' }),
      ]),
    );
  });

  it('a machine within the dead-runner threshold produces no candidate', () => {
    const now = Date.now();
    advertiseMachine('DESKBOX', [], now - 30_000); // fresh
    const candidates = mods.detectSelfHealCandidates(now);
    expect(candidates.find((c: any) => c.class === 'restart-dead-runner')).toBeUndefined();
  });

  it("detects a stale clone from the routine inbox's newest entry age", () => {
    process.env.WAR_ROOM_ROUTINES_DIR = routinesDir;
    const routineDir = path.join(routinesDir, 'vault-health');
    fs.mkdirSync(routineDir, { recursive: true });
    const file = path.join(routineDir, 'note.md');
    fs.writeFileSync(file, '# stale', 'utf8');
    const now = Date.now();
    const oldMtime = new Date(now - 30 * 60 * 60_000); // 30h old, past the 26h threshold
    fs.utimesSync(file, oldMtime, oldMtime);
    mods.clearInboxCache();

    const candidates = mods.detectSelfHealCandidates(now);
    expect(candidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ class: 'refresh-stale-clone' })]),
    );
  });

  it('a fresh routine inbox produces no stale-clone candidate', () => {
    process.env.WAR_ROOM_ROUTINES_DIR = routinesDir;
    const routineDir = path.join(routinesDir, 'vault-health');
    fs.mkdirSync(routineDir, { recursive: true });
    fs.writeFileSync(path.join(routineDir, 'note.md'), '# fresh', 'utf8');
    mods.clearInboxCache();

    const candidates = mods.detectSelfHealCandidates(Date.now());
    expect(candidates.find((c: any) => c.class === 'refresh-stale-clone')).toBeUndefined();
  });

  it('no WAR_ROOM_ROUTINES_DIR configured -> honest ⊘, never a fabricated stale-clone finding', () => {
    const candidates = mods.detectSelfHealCandidates(Date.now());
    expect(candidates.find((c: any) => c.class === 'refresh-stale-clone')).toBeUndefined();
  });

  it('mechanical-vault-fix and rerun-failed-routine never auto-detect (no real signal exists in this codebase)', () => {
    process.env.WAR_ROOM_ROUTINES_DIR = routinesDir;
    const routineDir = path.join(routinesDir, 'vault-health');
    fs.mkdirSync(routineDir, { recursive: true });
    fs.writeFileSync(path.join(routineDir, 'note.md'), '# whatever', 'utf8');
    mods.clearInboxCache();

    const candidates = mods.detectSelfHealCandidates(Date.now());
    expect(candidates.find((c: any) => c.class === 'mechanical-vault-fix')).toBeUndefined();
    expect(candidates.find((c: any) => c.class === 'rerun-failed-routine')).toBeUndefined();
  });
});

describe('runSelfHealTick integration', () => {
  it('runs detection + the guard chain end to end and returns only fired (non-cooldown) receipts', () => {
    const now = Date.now();
    advertiseMachine('DESKBOX', [], now - 10 * 60_000); // dead -> proposal-only suppressed receipt
    advertiseMachine('MACBOOK', ['refresh-stale-clone'], now); // live, will host the clone refresh
    process.env.WAR_ROOM_SELF_HEAL_TARGET_MACHINE = 'MACBOOK';
    process.env.WAR_ROOM_ROUTINES_DIR = routinesDir;
    const routineDir = path.join(routinesDir, 'vault-health');
    fs.mkdirSync(routineDir, { recursive: true });
    const file = path.join(routineDir, 'note.md');
    fs.writeFileSync(file, '# stale', 'utf8');
    const oldMtime = new Date(now - 30 * 60 * 60_000);
    fs.utimesSync(file, oldMtime, oldMtime);
    mods.clearInboxCache();

    const fired = mods.runSelfHealTick({ now, isAutomationPaused: neverPaused });
    expect(fired.length).toBeGreaterThanOrEqual(2);
    const kinds = fired.map((r: any) => `${r.class}:${r.outcome}`);
    expect(kinds).toEqual(
      expect.arrayContaining(['restart-dead-runner:suppressed', 'refresh-stale-clone:executed']),
    );
  });
});
