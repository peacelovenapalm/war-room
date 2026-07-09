/**
 * Standing orders (v2 mechanic G3 — GAME-DESIGN.md §7.2) pure logic, split
 * out of the components so it's unit-testable with no rendering harness
 * (same convention chain.ts/dispatch.ts use). Mirrors core/src/messages.ts's
 * StandingOrder/StandingOrderSchedule* without importing the server-facing
 * generated types into the webview bundle directly.
 */

import { budgetPauseReasonWord, isAutomationPauseReason } from './budget.js';

export type StandingOrderScheduleClient =
  | { kind: 'daily'; atLocalHour: number }
  | { kind: 'interval'; everyMs: number };

export interface StandingOrderClient {
  id: string;
  name: string;
  schedule: StandingOrderScheduleClient;
  machine?: string;
  provider?: string;
  cwd?: string;
  prompt: string;
  model?: string;
  effort?: string;
  employeeId?: string;
  enabled: boolean;
  needsFirstFireConfirm: boolean;
  lastFiredAt?: number;
  lastFiredDate?: string;
  lastSkipReason?: string;
  stoppedByKillSwitch?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Mirrors server/src/standingOrderStore.ts's STANDING_ORDER_BASE_CAP. */
export const STANDING_ORDER_BASE_CAP = 1;

/** One line of a schedule, e.g. "DAILY @ 09:00", "EVERY 1h". */
export function scheduleLabel(schedule: StandingOrderScheduleClient): string {
  if (schedule.kind === 'daily') {
    return `DAILY @ ${String(schedule.atLocalHour).padStart(2, '0')}:00`;
  }
  const hours = schedule.everyMs / 3_600_000;
  return Number.isInteger(hours)
    ? `EVERY ${hours}h`
    : `EVERY ${Math.round(schedule.everyMs / 60_000)}m`;
}

/** Colorblind-rule status line for a single order row: GLYPH + WORD, never
 *  color alone. The unconditional first-fire gate (§7.2) is the LOUDEST
 *  state — it always wins over enabled/disabled/skip-reason display.
 *  KICKOFF v1.1 item 5: lastSkipReason is now the SPECIFIC budget-pause
 *  reason (one of budget.ts's AutomationPauseReason values) rather than a
 *  generic 'budget-paused' literal, so it renders distinctly per reason
 *  (e.g. "⏸ PAUSED — 5h budget" vs "⏸ PAUSED — codex cap"). The literal
 *  'budget-paused' string is still handled for any order already persisted
 *  with the old pre-item-5 value. */
export function standingOrderStatusLabel(
  order: Pick<
    StandingOrderClient,
    'needsFirstFireConfirm' | 'enabled' | 'stoppedByKillSwitch' | 'lastSkipReason'
  >,
): string {
  if (order.needsFirstFireConfirm) return '⚠ NEEDS FIRST-RUN CONFIRM';
  if (order.stoppedByKillSwitch) return '■ STOPPED';
  if (!order.enabled) return '○ DISABLED';
  if (order.lastSkipReason === 'budget-paused') return '⏸ PAUSED — budget'; // legacy pre-item-5 value
  if (order.lastSkipReason && isAutomationPauseReason(order.lastSkipReason)) {
    return `⏸ PAUSED — ${budgetPauseReasonWord(order.lastSkipReason)}`;
  }
  if (order.lastSkipReason) return `⚠ SKIPPED — ${order.lastSkipReason}`;
  return '● ACTIVE';
}

/** Whether a new standing order can be created given how many are already
 *  enabled and the perk-derived cap — client-side hint only (a purely
 *  advisory disable on the CREATE button); the server re-validates for
 *  real (standingOrderStore.ts's own cap check). */
export function canCreateStandingOrder(enabledCount: number, cap: number): boolean {
  return enabledCount < cap;
}
