/**
 * WS wiring tests for the v3 Living Studio planes (WS-C stage 1 —
 * KICKOFF-v3.1 §3). The stores' own semantics are covered per-store;
 * this file exercises what httpServer.ts wires on top: connect replay of
 * active records, live per-mutation broadcast, the source-data feature
 * flag default (silent with no source, lights up mid-session the moment
 * the first real record lands), and the WAR_ROOM_V3_* off override.
 *
 * Uses the process-wide store singletons (the ones httpServer imports) —
 * every test seeds unique ids and filters received messages to its own,
 * the same discipline tailSubscription.test.ts uses for the shared
 * outputRingStore.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Isolated temp HOME, same rationale as tailSubscription.test.ts (stores
// resolve their sidecars under ~/.pixel-agents/ by default).
let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

const { PixelAgentsServer } = await import('../src/server.js');
const { AgentStateStore } = await import('../src/agentStateStore.js');
const { dossierStore } = await import('../src/dossierStore.js');
const { matchDayStore } = await import('../src/matchDayStore.js');
const { reworkBinStore } = await import('../src/reworkBinStore.js');
const { rivalryStore } = await import('../src/rivalryStore.js');
const { studioContractStore } = await import('../src/studioContractStore.js');

function uniqueId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

interface V3Client {
  ws: WebSocket;
  /** Every received v3-plane message, in arrival order. */
  messages: Array<Record<string, unknown>>;
  ofType: (type: string) => Array<Record<string, unknown>>;
  close: () => void;
}

const V3_TYPES = new Set([
  'contractsUpdated',
  'dossierUpdated',
  'matchDayEvent',
  'reworkBinUpdated',
  'rivalryUpdated',
]);

async function connectClient(port: number): Promise<V3Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages: V3Client['messages'] = [];
  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (typeof msg.type === 'string' && V3_TYPES.has(msg.type)) messages.push(msg);
    } catch {
      /* ignore non-JSON */
    }
  });
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
  return {
    ws,
    messages,
    ofType: (type) => messages.filter((m) => m.type === type),
    close: () => ws.close(),
  };
}

const settle = (ms = 75) => new Promise((resolve) => setTimeout(resolve, ms));

describe('v3 Living Studio WS wiring', () => {
  let server: InstanceType<typeof PixelAgentsServer>;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-v3-wiring-'));
    fs.mkdirSync(path.join(tmpBase, '.pixel-agents'), { recursive: true });
    server = new PixelAgentsServer();
  });

  afterEach(() => {
    server?.stop();
    delete process.env['WAR_ROOM_V3_RIVALRIES'];
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('replays active studio contracts on connect and forwards live mutations', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const text = uniqueId('todo-line');
    const minted = studioContractStore.mintFromTodo(
      { file: '/vault/todo/2026-07-10.md', line: 1, text },
      40,
      Date.now() + 86_400_000,
    );
    if (!minted.ok) throw new Error('mint failed');

    const client = await connectClient(config.port);
    await settle();
    const replayed = client
      .ofType('contractsUpdated')
      .filter((m) => (m.contract as { id: string }).id === minted.contract.id);
    expect(replayed).toHaveLength(1);
    expect((replayed[0].contract as { status: string }).status).toBe('offered');
    expect((replayed[0].contract as { sourceTodo: { text: string } }).sourceTodo.text).toBe(text);

    studioContractStore.accept(minted.contract.id);
    await settle();
    const live = client
      .ofType('contractsUpdated')
      .filter((m) => (m.contract as { id: string }).id === minted.contract.id);
    expect(live).toHaveLength(2);
    expect((live[1].contract as { status: string }).status).toBe('accepted');
    client.close();
  });

  it('replays dossiers, active fixtures, and rivalry pairs on connect once records exist', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    const staffId = uniqueId('MACBOOK:proj');
    dossierStore.ensure(staffId, 'Test Staffer');
    const opened = matchDayStore.openFixture(uniqueId('run'));
    if (!opened.ok) throw new Error('open failed');
    const pairA = uniqueId('staff-a');
    const pairB = uniqueId('staff-b');
    rivalryStore.upsert([pairA, pairB], 'rivalry', ['overlap fact'], true);

    const client = await connectClient(config.port);
    await settle();

    expect(
      client
        .ofType('dossierUpdated')
        .some((m) => (m.dossier as { staffId: string }).staffId === staffId),
    ).toBe(true);
    const fixtures = client
      .ofType('matchDayEvent')
      .filter((m) => m.fixtureId === opened.fixture.fixtureId);
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0].phase).toBe('pre');
    // Wire shape only — internal bookkeeping never leaks.
    expect('createdAt' in fixtures[0]).toBe(false);
    expect(
      client
        .ofType('rivalryUpdated')
        .some((m) =>
          (m.pair as { activeWarning: boolean; staffIds: string[] }).staffIds.includes(pairA),
        ),
    ).toBe(true);
    client.close();
  });

  it('a plane with no source data is silent on connect but lights up when the first real record lands', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    // reworkBinStore has no records in this worker yet — flag defaults OFF.
    expect(reworkBinStore.hasRecords()).toBe(false);

    const client = await connectClient(config.port);
    await settle();
    expect(client.ofType('reworkBinUpdated')).toHaveLength(0);

    // First REAL failure observed → the flag flips ON per send, and the
    // already-connected socket receives the broadcast without reconnecting.
    const piled = reworkBinStore.pile('dispatch', {
      id: uniqueId('dispatch'),
      excerpt: 'Error: exit 1',
    });
    if (!piled.ok) throw new Error('pile failed');
    await settle();
    const received = client
      .ofType('reworkBinUpdated')
      .filter((m) => (m.item as { id: string }).id === piled.item.id);
    expect(received).toHaveLength(1);
    expect((received[0].item as { status: string }).status).toBe('piled');
    client.close();
  });

  it('WAR_ROOM_V3_<NAME>=off silences that plane even with source data present', async () => {
    const config = await server.start({ embedded: false, store: new AgentStateStore() });
    rivalryStore.upsert([uniqueId('a'), uniqueId('b')], 'bond', ['fact'], false);
    process.env['WAR_ROOM_V3_RIVALRIES'] = 'off';

    const client = await connectClient(config.port);
    await settle();
    expect(client.ofType('rivalryUpdated')).toHaveLength(0);

    // Live mutations are silenced too (the flag is evaluated per send).
    rivalryStore.upsert([uniqueId('c'), uniqueId('d')], 'rivalry', ['fact'], true);
    await settle();
    expect(client.ofType('rivalryUpdated')).toHaveLength(0);
    client.close();
  });
});
