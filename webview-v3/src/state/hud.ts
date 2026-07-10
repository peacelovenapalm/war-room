/**
 * HUD strip derivations (GAME-DESIGN-V3 §3.1) — pure functions from the
 * live stores to chip text. Every chip is SHAPE + TEXT (colorblind hard
 * rule) and every number decomposes on tap into verbatim telemetry via
 * buildRealSheet (one-tap-real, hard rule 5).
 */

import type { AgentMap, AgentRecord } from '../net/agentStore';
import { sortedAgents } from '../net/agentStore';
import { formatAge } from './crisis';
import type { CrisisState } from './crisisStore';
import type { EconomySnapshot } from './economy';
import { groupThousands } from './economy';
import { AgentVisualState, deriveVisualState, isDownState } from './visualState';

// ── Agent tally ─────────────────────────────────────────────────

export interface AgentTally {
  total: number;
  working: number;
  needsInput: number;
  down: number;
}

export function tallyAgents(agents: AgentMap, now: number): AgentTally {
  const tally: AgentTally = { total: agents.size, working: 0, needsInput: 0, down: 0 };
  for (const record of agents.values()) {
    const state = deriveVisualState(record, now);
    if (state === AgentVisualState.WORKING) tally.working += 1;
    else if (state === AgentVisualState.NEEDS_INPUT) tally.needsInput += 1;
    else if (isDownState(state)) tally.down += 1;
  }
  return tally;
}

/** "◉ 3 · ▶ 1 · ⚠ 2 · ✗ 0" — the HUD agent-tally chip text. */
export function formatTally(tally: AgentTally): string {
  return `◉ ${String(tally.total)} · ▶ ${String(tally.working)} · ⚠ ${String(tally.needsInput)} · ✗ ${String(tally.down)}`;
}

// ── Per-wing warn counts ────────────────────────────────────────

export interface WingCount {
  machine: string;
  agentCount: number;
  /** Live fires on this wing (needs-input crises). */
  warnCount: number;
}

export function wingCounts(agents: AgentMap, crisis: CrisisState): WingCount[] {
  const wings = new Map<string, WingCount>();
  for (const record of agents.values()) {
    const machine = record.machine ?? 'LOCAL';
    const wing = wings.get(machine) ?? { machine, agentCount: 0, warnCount: 0 };
    wing.agentCount += 1;
    if (crisis.fires.has(record.id)) wing.warnCount += 1;
    wings.set(machine, wing);
  }
  return [...wings.values()].sort((a, b) => a.machine.localeCompare(b.machine));
}

/** "▣ NEXUS ⚠ 1" / "▣ MACBOOK ✓" — one wing chip. */
export function formatWing(wing: WingCount): string {
  return wing.warnCount > 0
    ? `▣ ${wing.machine} ⚠ ${String(wing.warnCount)}`
    : `▣ ${wing.machine} ✓`;
}

// ── Office mood ─────────────────────────────────────────────────

/** "✓ OFFICE: CALM" / "⚠ OFFICE: STRAINED (n)" from open crisis rows. */
export function officeMood(openCrises: number): string {
  return openCrises === 0 ? '✓ OFFICE: CALM' : `⚠ OFFICE: STRAINED (${String(openCrises)})`;
}

// ── Token spend (drawer TOKENS row) ─────────────────────────────

/** 12345 → "12.3k" (port of webview-ui/src/shiftReport.ts compactTokens). */
export function compactTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

// ── One-tap-real decomposition (hard rule 5) ────────────────────

export type RealSheetKind = 'tally' | 'wings' | 'mood' | 'cash' | 'rep';

export interface RealSheetContent {
  title: string;
  /** Verbatim telemetry lines, monospace. */
  lines: string[];
}

function agentRealLine(record: AgentRecord, now: number): string {
  const poll = record.poll
    ? `poll=${record.poll.state}${record.poll.stale ? ' (STALE)' : ''} since=${formatAge(now - record.poll.since)} waitingFor=${record.poll.waitingFor ?? '—'}`
    : 'poll=—';
  return (
    `#${String(record.id)} ${record.name} [${record.machine ?? 'LOCAL'}] ` +
    `status=${record.status} awaitingInput=${String(record.awaitingInput)} ` +
    `toolPermission=${String(record.toolPermission)} ${poll}`
  );
}

function ledgerRealLine(entry: {
  ts: number;
  delta: number;
  currency: string;
  reason: string;
  cause?: { sourceEventRefs: string[] };
}): string {
  const sign = entry.delta >= 0 ? '+' : '';
  const refs = entry.cause?.sourceEventRefs ?? [];
  const refsSuffix = refs.length > 0 ? ` [${refs.join(', ')}]` : '';
  return `${new Date(entry.ts).toISOString()} ${sign}${String(entry.delta)} ${entry.currency} — ${entry.reason}${refsSuffix}`;
}

/**
 * The verbatim panel behind every HUD chip tap. Sources are named so the
 * reader knows which wire message each line mirrors.
 */
export function buildRealSheet(
  kind: RealSheetKind,
  sources: { agents: AgentMap; crisis: CrisisState; economy: EconomySnapshot | null },
  now: number,
): RealSheetContent {
  const { agents, crisis, economy } = sources;
  switch (kind) {
    case 'tally':
    case 'wings':
    case 'mood': {
      const lines = sortedAgents(agents).map((record) => agentRealLine(record, now));
      for (const record of crisis.debris.values()) {
        lines.push(
          `DEBRIS ${record.label} kind=${record.kind} since=${formatAge(now - record.since)}`,
        );
      }
      return {
        title: 'SOURCE: agentStatus / agentPollState / agentToolPermission over /ws',
        lines: lines.length > 0 ? lines : ['(no agents connected)'],
      };
    }
    case 'cash':
    case 'rep': {
      if (economy === null) {
        return {
          title: 'SOURCE: economyUpdate over /ws',
          lines: ['(no economyUpdate received this session)'],
        };
      }
      const lines = [
        `cash=${groupThousands(economy.cash)} reputation=${groupThousands(economy.reputation)}`,
        ...economy.ledger.map(ledgerRealLine),
      ];
      return { title: 'SOURCE: economyUpdate over /ws', lines };
    }
  }
}
