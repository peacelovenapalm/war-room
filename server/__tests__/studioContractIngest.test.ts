/**
 * Studio contract ingest tests (v3 WS-C stage 2): real-todo mint from
 * WAR_ROOM_TODO_DIR, the below-natural-pace target formula, completion on
 * todo disappearance (and NEVER on missing data), bonus-only rewards with
 * cause refs through the injected economy award, observed-event progress,
 * and penalty-free quiet expiry.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DispatchBroadcast, DispatchStore } from '../src/dispatchStore.js';
import { STUDIO_CONTRACT_REWARD_CASH } from '../src/economyConstants.js';
import {
  MAX_WINDOW_DAYS,
  MIN_WINDOW_DAYS,
  readStartNowTodos,
  StudioContractIngest,
} from '../src/studioContractIngest.js';
import { StudioContractStore } from '../src/studioContractStore.js';

const DAY_MS = 86_400_000;

let tmpDir: string;
let todoDir: string;
let storePath: string;
let savedEnv: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-ingest-'));
  todoDir = path.join(tmpDir, 'todos');
  fs.mkdirSync(todoDir);
  storePath = path.join(tmpDir, 'studio-contracts.json');
  savedEnv = process.env['WAR_ROOM_TODO_DIR'];
  process.env['WAR_ROOM_TODO_DIR'] = todoDir;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env['WAR_ROOM_TODO_DIR'];
  else process.env['WAR_ROOM_TODO_DIR'] = savedEnv;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeTodoFile(date: string, startNowItems: string[]): string {
  const body = [
    '# Daily todo',
    '',
    '## Start now',
    '',
    ...startNowItems.map((t, i) => `${i + 1}. ${t}`),
    '',
    '## Later',
    '',
    '- [ ] something else',
    '',
  ].join('\n');
  const file = path.join(todoDir, `${date}.md`);
  fs.writeFileSync(file, body, 'utf8');
  return file;
}

function makeIngest(awardCash = vi.fn()) {
  const store = new StudioContractStore(storePath);
  const ingest = new StudioContractIngest(store, awardCash);
  return { store, ingest, awardCash };
}

function exitBroadcast(id: string, exitCode: number): DispatchBroadcast {
  return {
    type: 'dispatchUpdate',
    id,
    action: 'dispatch',
    status: 'exited',
    machine: 'TESTMACH',
    exitCode,
  };
}

/** Fake dispatch-record lookup (Pick<DispatchStore, 'getRecord'>) — the
 *  contractId is the ONLY honest dispatch→contract linkage (explicit,
 *  never string-matched). */
function lookupFor(
  records: Record<string, { contractId?: string }>,
): Pick<DispatchStore, 'getRecord'> {
  return {
    getRecord: (id: string) =>
      id in records
        ? ({ id, machine: 'TESTMACH', status: 'exited', ...records[id] } as ReturnType<
            DispatchStore['getRecord']
          >)
        : undefined,
  };
}

describe('readStartNowTodos', () => {
  it('reads the lexicographically-latest daily file with verbatim text and 1-based lines', () => {
    writeTodoFile('2026-07-09', ['old item']);
    const latest = writeTodoFile('2026-07-10', ['Fix the NEXUS backup cron', 'Ship WS-C']);
    const parsed = readStartNowTodos(todoDir);
    expect(parsed).not.toBeNull();
    expect(parsed!.file).toBe(latest);
    expect(parsed!.todos).toHaveLength(2);
    expect(parsed!.todos[0]).toEqual({
      file: latest,
      line: 5,
      text: 'Fix the NEXUS backup cron',
    });
    expect(parsed!.todos[1].text).toBe('Ship WS-C');
  });

  it('returns null (never []) on a missing dir or no daily files', () => {
    expect(readStartNowTodos(path.join(tmpDir, 'nope'))).toBeNull();
    expect(readStartNowTodos(tmpDir)).toBeNull(); // dir exists, no YYYY-MM-DD.md
  });
});

describe('StudioContractIngest.sweep — mint', () => {
  it('mints offered contracts from Start now items, idempotent across sweeps', () => {
    writeTodoFile('2026-07-10', ['Task A', 'Task B']);
    const { store, ingest } = makeIngest();
    const now = Date.now();

    const first = ingest.sweep(now);
    expect(first.minted).toBe(2);
    const all = store.getAll();
    expect(all).toHaveLength(2);
    expect(all.every((c) => c.status === 'offered')).toBe(true);
    expect(all.every((c) => c.reward === STUDIO_CONTRACT_REWARD_CASH)).toBe(true);

    const second = ingest.sweep(now + 1000);
    expect(second.minted).toBe(0);
    expect(store.getAll()).toHaveLength(2);
  });

  it('mints nothing when WAR_ROOM_TODO_DIR is unset', () => {
    writeTodoFile('2026-07-10', ['Task A']);
    delete process.env['WAR_ROOM_TODO_DIR'];
    const { store, ingest } = makeIngest();
    expect(ingest.sweep().minted).toBe(0);
    expect(store.getAll()).toHaveLength(0);
  });
});

describe('StudioContractIngest — target formula (no dark patterns)', () => {
  it('grants the MOST generous window when there is no completion history', () => {
    const { ingest } = makeIngest();
    expect(ingest.quietExpiryWindowMs(Date.now())).toBe(MAX_WINDOW_DAYS * DAY_MS);
  });

  it('sits below natural pace: 1 completion/7d → 14-day window (~2x natural time)', () => {
    const { store, ingest } = makeIngest();
    const now = Date.now();
    const minted = store.mintFromTodo(
      { file: '/f.md', line: 1, text: 'done thing' },
      10,
      now + DAY_MS,
      now - DAY_MS,
    );
    if (!minted.ok) throw new Error('mint failed');
    store.complete(minted.contract.id, now - 1000);
    // naturalDaysPerTodo = 7/1 = 7 → ceil(7 / (1-0.5)) = 14 days.
    expect(ingest.quietExpiryWindowMs(now)).toBe(14 * DAY_MS);
  });

  it('never grants less than the floor even at a hot pace', () => {
    const { store, ingest } = makeIngest();
    const now = Date.now();
    for (let i = 0; i < 20; i++) {
      const minted = store.mintFromTodo(
        { file: '/f.md', line: i + 1, text: `hot item ${i}` },
        10,
        now + DAY_MS,
        now - DAY_MS,
      );
      if (!minted.ok) throw new Error('mint failed');
      store.complete(minted.contract.id, now - 1000);
    }
    // 20 completions/7d → natural 0.35d/todo → ceil(0.7) = 1 → clamped to floor.
    expect(ingest.quietExpiryWindowMs(now)).toBe(MIN_WINDOW_DAYS * DAY_MS);
  });
});

describe('StudioContractIngest.sweep — completion on todo disappearance', () => {
  it('completes the vanished todo and pays the bonus once with a cause ref', () => {
    writeTodoFile('2026-07-10', ['Task A', 'Task B']);
    const { store, ingest, awardCash } = makeIngest();
    const now = Date.now();
    ingest.sweep(now);

    writeTodoFile('2026-07-11', ['Task B']); // Task A left the compiled list
    const result = ingest.sweep(now + 1000);
    expect(result.completed).toBe(1);

    const contracts = store.getAll();
    const done = contracts.find((c) => c.sourceTodo.text === 'Task A');
    const open = contracts.find((c) => c.sourceTodo.text === 'Task B');
    expect(done?.status).toBe('completed');
    expect(open?.status).toBe('offered');

    expect(awardCash).toHaveBeenCalledTimes(1);
    const [amount, awardCause] = awardCash.mock.calls[0];
    expect(amount).toBe(STUDIO_CONTRACT_REWARD_CASH);
    expect(awardCause.label).toBe(`studio-contract-completed:${done!.id}`);
    expect(awardCause.sourceEventRefs).toContain(`studio-contract:${done!.id}`);

    // Re-sweep never double-completes or double-pays.
    ingest.sweep(now + 2000);
    expect(awardCash).toHaveBeenCalledTimes(1);
  });

  it('HONESTY EDGE: an unreadable todo source never completes anything', () => {
    writeTodoFile('2026-07-10', ['Task A']);
    const { store, ingest, awardCash } = makeIngest();
    ingest.sweep();

    fs.rmSync(todoDir, { recursive: true, force: true }); // source gone ≠ todo done
    const result = ingest.sweep();
    expect(result.completed).toBe(0);
    expect(store.getAll()[0].status).toBe('offered');
    expect(awardCash).not.toHaveBeenCalled();
  });
});

describe('StudioContractIngest — quiet expiry', () => {
  it('expires past-deadline contracts with NO award and no other side effect', () => {
    writeTodoFile('2026-07-10', ['Task A']);
    const { store, ingest, awardCash } = makeIngest();
    const now = Date.now();
    ingest.sweep(now);

    // Keep the todo present (so disappearance-completion can't fire) and
    // jump past the most generous possible window.
    const later = now + (MAX_WINDOW_DAYS + 1) * DAY_MS;
    writeTodoFile('2026-07-10', ['Task A']);
    const result = ingest.sweep(later);
    expect(result.expired).toBe(1);
    expect(store.getAll()[0].status).toBe('expired');
    expect(awardCash).not.toHaveBeenCalled();
  });
});

describe('StudioContractIngest — observed-event progress (honest attribution)', () => {
  // Panel finding (studioContractIngest.ts:254): progress used to be
  // attributed to EVERY accepted contract on ANY exit-0 anywhere. The only
  // honest linkage is the dispatch record's explicit contractId; without
  // one, progress is recorded on NONE (honest-nothing beats
  // dishonest-everything — one-tap-real).
  it('attributes exit-0 progress ONLY to the contract the dispatch was explicitly called for', () => {
    writeTodoFile('2026-07-10', ['Task A', 'Task B', 'Task C']);
    const { store, ingest } = makeIngest();
    ingest.sweep();
    const [a, b, c] = store.getAll();
    store.accept(a.id);
    store.accept(b.id);

    ingest.onDispatchUpdate(
      exitBroadcast('disp-1', 0),
      lookupFor({ 'disp-1': { contractId: a.id } }),
    );
    const linked = store.getById(a.id)!;
    expect(linked.status).toBe('progressing');
    expect(linked.progress).toHaveLength(1);
    expect(linked.progress[0].sourceRef).toBe('dispatch:disp-1');
    // The OTHER accepted contract records nothing — its todo saw no work.
    expect(store.getById(b.id)!.progress).toHaveLength(0);
    expect(store.getById(b.id)!.status).toBe('accepted');
    expect(store.getById(c.id)!.progress).toHaveLength(0);

    // The same terminal broadcast never records twice.
    ingest.onDispatchUpdate(
      exitBroadcast('disp-1', 0),
      lookupFor({ 'disp-1': { contractId: a.id } }),
    );
    expect(store.getById(a.id)!.progress).toHaveLength(1);
  });

  it('HONESTY: an exit-0 with no contract linkage records progress on NOTHING', () => {
    writeTodoFile('2026-07-10', ['Task A']);
    const { store, ingest } = makeIngest();
    ingest.sweep();
    const [a] = store.getAll();
    store.accept(a.id);

    // Record exists but carries no contractId (a manual CALL, a chain step).
    ingest.onDispatchUpdate(exitBroadcast('disp-1', 0), lookupFor({ 'disp-1': {} }));
    // Record unknown entirely (restart raced the broadcast).
    ingest.onDispatchUpdate(exitBroadcast('disp-2', 0), lookupFor({}));
    // Linked to a contract id that is not an open studio contract.
    ingest.onDispatchUpdate(
      exitBroadcast('disp-3', 0),
      lookupFor({ 'disp-3': { contractId: 'v2-contract-uuid' } }),
    );
    expect(store.getById(a.id)!.progress).toHaveLength(0);
    expect(store.getById(a.id)!.status).toBe('accepted');
  });

  it('records nothing for nonzero exits, focus actions, or un-accepted contracts', () => {
    writeTodoFile('2026-07-10', ['Task A', 'Task B']);
    const { store, ingest } = makeIngest();
    ingest.sweep();
    const [a, b] = store.getAll();
    store.accept(a.id);
    // b stays offered.

    ingest.onDispatchUpdate(
      exitBroadcast('disp-fail', 3),
      lookupFor({ 'disp-fail': { contractId: a.id } }),
    );
    ingest.onDispatchUpdate(
      {
        type: 'dispatchUpdate',
        id: 'focus-1',
        action: 'focus',
        status: 'exited',
        machine: 'TESTMACH',
        exitCode: 0,
      },
      lookupFor({ 'focus-1': { contractId: a.id } }),
    );
    ingest.onDispatchUpdate(
      exitBroadcast('disp-offered', 0),
      lookupFor({ 'disp-offered': { contractId: b.id } }),
    );
    expect(store.getById(a.id)!.progress).toHaveLength(0);
    expect(store.getById(b.id)!.progress).toHaveLength(0); // never on un-accepted contracts
  });
});
