/**
 * HTTP + real-event integration tests for the building routes (G2,
 * GAME-DESIGN §5). buildingBuffs.ts's own buff math is covered by
 * buildingBuffs.test.ts; economyStore's own math is covered by
 * economyStore.test.ts. This file exercises:
 *   - POST /api/building/expand twice: exact bayCost(n) formula, correct
 *     4-col rectangle conversion (doorway punched through), rejection on
 *     insufficient Cash without mutating the layout.
 *   - The Dev Pit +15% XP acceptance criterion end-to-end: tag a Dev Pit
 *     over a desk, assign a real employee (driven through the actual hook
 *     ingest pipeline, same pattern as employeeRoutes.test.ts) to that
 *     desk, complete a second REAL turn, and confirm the XP delta reflects
 *     the bonus — a real observed event, not a unit test alone.
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

const { PixelAgentsServer } = await import('../src/server.js');
const { AgentRuntime } = await import('../src/agentRuntime.js');
const { AgentStateStore } = await import('../src/agentStateStore.js');
const { claudeProvider } = await import('../src/providers/index.js');
const { writeLayoutToFile } = await import('../src/layoutPersistence.js');
const { economyStore } = await import('../src/economyStore.js');
const { bayCost } = await import('../src/economyConstants.js');
const { XP_TURN } = await import('../src/employeeStore.js');

async function startFullServer() {
  const store = new AgentStateStore();
  const runtime = new AgentRuntime(store, claudeProvider);
  const server = new PixelAgentsServer();
  server.onHookEvent((providerId, event) => runtime.handleHookEvent(providerId, event));
  const config = await server.start({ store, runtime, embedded: false });
  return { server, runtime, config };
}

function uniqueMachine(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`.toUpperCase();
}

async function postHook(
  port: number,
  token: string,
  machine: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/hooks/claude`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Machine': machine,
    },
    body: JSON.stringify(body),
  });
}

async function driveOneTurn(
  port: number,
  token: string,
  machine: string,
  cwd: string,
  sessionId: string,
): Promise<void> {
  await postHook(port, token, machine, {
    session_id: sessionId,
    hook_event_name: 'SessionStart',
    source: 'startup',
    cwd,
  });
  await postHook(port, token, machine, {
    session_id: sessionId,
    hook_event_name: 'Stop',
  });
}

/** Minimal valid OfficeLayout, matching webview-ui's createDefaultLayout()
 *  shape: bordered WALL rectangle with FLOOR_1 interior. */
function seedLayout(cols = 20, rows = 11): void {
  const tiles: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push(r === 0 || r === rows - 1 || c === 0 || c === cols - 1 ? 0 : 1);
    }
  }
  writeLayoutToFile({ version: 1, cols, rows, tiles, furniture: [], rooms: [] });
}

interface BuildResultBody {
  ok: boolean;
  reason?: string;
  layout?: { cols: number; rows: number; tiles: number[]; rooms?: unknown[] };
}

describe('POST /api/building/expand', () => {
  let server: InstanceType<typeof PixelAgentsServer>;
  let runtime: InstanceType<typeof AgentRuntime>;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-building-route-test-'));
    fs.mkdirSync(path.join(tmpBase, '.pixel-agents'), { recursive: true });
    seedLayout();
  });

  afterEach(() => {
    runtime?.dispose();
    server?.stop();
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('rejects an expansion with insufficient Cash without mutating the layout', async () => {
    const started = await startFullServer();
    server = started.server;
    runtime = started.runtime;
    const res = await fetch(`http://127.0.0.1:${started.config.port}/api/building/expand`, {
      method: 'POST',
    });
    const body = (await res.json()) as BuildResultBody;
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('insufficient-cash');

    const layoutRes = await fetch(`http://127.0.0.1:${started.config.port}/api/economy`);
    const economy = (await layoutRes.json()) as { bayCount: number };
    expect(economy.bayCount).toBe(0);
  });

  it('deducts the exact bayCost(n) formula and grows cols by 4, twice in a row', async () => {
    const started = await startFullServer();
    server = started.server;
    runtime = started.runtime;
    economyStore.addCash(10_000, 'test-seed');

    const res1 = await fetch(`http://127.0.0.1:${started.config.port}/api/building/expand`, {
      method: 'POST',
    });
    const body1 = (await res1.json()) as BuildResultBody;
    expect(body1.ok).toBe(true);
    expect(body1.layout!.cols).toBe(24); // 20 + 4

    const economyRes1 = await fetch(`http://127.0.0.1:${started.config.port}/api/economy`);
    const economy1 = (await economyRes1.json()) as { cash: number; bayCount: number };
    expect(economy1.cash).toBe(10_000 - bayCost(0));
    expect(economy1.bayCount).toBe(1);

    const res2 = await fetch(`http://127.0.0.1:${started.config.port}/api/building/expand`, {
      method: 'POST',
    });
    const body2 = (await res2.json()) as BuildResultBody;
    expect(body2.ok).toBe(true);
    expect(body2.layout!.cols).toBe(28); // 24 + 4

    const economyRes2 = await fetch(`http://127.0.0.1:${started.config.port}/api/economy`);
    const economy2 = (await economyRes2.json()) as { cash: number; bayCount: number };
    expect(economy2.cash).toBe(10_000 - bayCost(0) - bayCost(1));
    expect(economy2.bayCount).toBe(2);

    // New tiles are placeable (not WALL/VOID) except the new right-edge
    // wall and top/bottom border rows — spot-check an interior new tile.
    const newCols = body1.layout!.cols;
    const midRow = 5;
    const spotIdx = midRow * newCols + (newCols - 2); // one col left of the new right wall
    expect(body1.layout!.tiles[spotIdx]).not.toBe(0); // 0 = WALL
    expect(body1.layout!.tiles[spotIdx]).not.toBe(255); // 255 = VOID

    // The doorway: the OLD right-edge column (col 19) at the midpoint row
    // is no longer a wall — the new bay is reachable at purchase time.
    const doorwayRow = Math.min(Math.max(1, Math.floor(11 / 2)), 11 - 2);
    const doorwayIdx = doorwayRow * newCols + 19;
    expect(body1.layout!.tiles[doorwayIdx]).not.toBe(0);
  });
});

describe('POST /api/building/room — Dev Pit XP bonus (G2 acceptance criterion)', () => {
  let server: InstanceType<typeof PixelAgentsServer>;
  let runtime: InstanceType<typeof AgentRuntime>;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-building-devpit-test-'));
    fs.mkdirSync(path.join(tmpBase, '.pixel-agents'), { recursive: true });
  });

  afterEach(() => {
    runtime?.dispose();
    server?.stop();
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('tagging a Dev Pit over an assigned desk boosts a real employee turn XP by the bonus', async () => {
    // Desk at (2,2) inside a bordered floor — reachable Dev Pit footprint (4x3) at (0,0)-(4,3).
    const cols = 20;
    const rows = 11;
    const tiles: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        tiles.push(r === 0 || r === rows - 1 || c === 0 || c === cols - 1 ? 0 : 1);
      }
    }
    const deskUid = 'desk-1';
    writeLayoutToFile({
      version: 1,
      cols,
      rows,
      tiles,
      furniture: [{ uid: deskUid, type: 'DESK_FRONT', col: 2, row: 2 }],
      rooms: [],
    });

    const started = await startFullServer();
    server = started.server;
    runtime = started.runtime;
    const { port, token } = started.config;
    const machine = uniqueMachine('MACBOOK');
    const cwd = `/tmp/g2-devpit-test-${crypto.randomUUID().slice(0, 8)}`;

    // Three real turns to cross the candidate->active threshold (assign()
    // requires status==='active') — baseline 3*XP_TURN.
    await driveOneTurn(port, token, machine, cwd, 'session-baseline-1');
    await driveOneTurn(port, token, machine, cwd, 'session-baseline-2');
    await driveOneTurn(port, token, machine, cwd, 'session-baseline-3');
    const roster1 = (await (
      await fetch(`http://127.0.0.1:${port}/api/employees`)
    ).json()) as Array<{ id: string; projectDir: string; xp: number; status: string }>;
    const record1 = roster1.find((e) => e.projectDir === cwd)!;
    expect(record1.xp).toBe(XP_TURN * 3);
    expect(record1.status).toBe('active');

    // Assign the employee to the desk.
    const assignRes = await fetch(
      `http://127.0.0.1:${port}/api/employees/${encodeURIComponent(record1.id)}/assign`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: deskUid }),
      },
    );
    const assignBody = (await assignRes.json()) as { ok: boolean };
    expect(assignBody.ok).toBe(true);

    // Tag a Dev Pit over the desk (needs Cash).
    economyStore.addCash(1000, 'test-seed');
    const roomRes = await fetch(`http://127.0.0.1:${port}/api/building/room`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Interior rectangle only — (2,2) the desk sits inside, avoiding the
      // border WALL ring at row/col 0 and the last row/col.
      body: JSON.stringify({ type: 'dev_pit', colStart: 1, rowStart: 1, colEnd: 5, rowEnd: 4 }),
    });
    const roomBody = (await roomRes.json()) as BuildResultBody;
    expect(roomBody.ok).toBe(true);
    expect(roomBody.layout!.rooms).toHaveLength(1);

    // Fourth real turn — now assigned + Dev Pit tagged — must show the +15% bonus.
    await driveOneTurn(port, token, machine, cwd, 'session-buffed');
    const roster2 = (await (
      await fetch(`http://127.0.0.1:${port}/api/employees`)
    ).json()) as Array<{ id: string; projectDir: string; xp: number }>;
    const record2 = roster2.find((e) => e.projectDir === cwd)!;

    const secondTurnXp = record2.xp - record1.xp;
    expect(secondTurnXp).toBe(Math.round(XP_TURN * 1.15));
    expect(secondTurnXp).toBeGreaterThan(XP_TURN);
  });
});
