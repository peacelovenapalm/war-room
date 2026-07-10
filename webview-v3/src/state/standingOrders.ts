/**
 * Standing orders pure logic — port of webview-ui/src/standingOrders.ts
 * (frozen fallback, read-only for WS-A). Mirrors core/src/messages.ts's
 * StandingOrder/StandingOrderSchedule*.
 */

import { budgetPauseReasonWord, isAutomationPauseReason } from './budget';

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

/** Mirrors server/src/standingOrderStore.ts's standingOrderCap() exactly:
 *  base 1, Second Shift +1, Night Shift Foreman +2 (additive). Fail-closed:
 *  a null economy yields the base cap.
 *
 *  NOTE (v3 scope): see state/chain.ts's chainMaxSteps note — the
 *  generated core EconomyUpdate has no purchasedPerks field yet, so v3
 *  always passes `{ purchasedPerks: [] }` (or null) and always shows the
 *  honest base cap. */
export function standingOrderCapClient(economy: { purchasedPerks: string[] } | null): number {
  let cap = STANDING_ORDER_BASE_CAP;
  if (economy?.purchasedPerks.includes('secondShift')) cap += 1;
  if (economy?.purchasedPerks.includes('nightShiftForeman')) cap += 2;
  return cap;
}

/** One line of a schedule, e.g. "DAILY @ 09:00", "EVERY 1h". */
export function scheduleLabel(schedule: StandingOrderScheduleClient): string {
  if (schedule.kind === 'daily') {
    return `DAILY @ ${String(schedule.atLocalHour).padStart(2, '0')}:00`;
  }
  const hours = schedule.everyMs / 3_600_000;
  return Number.isInteger(hours)
    ? `EVERY ${String(hours)}h`
    : `EVERY ${String(Math.round(schedule.everyMs / 60_000))}m`;
}

/** Colorblind-rule status line for a single order row: GLYPH + WORD, never
 *  color alone. The unconditional first-fire gate is the LOUDEST state — it
 *  always wins over enabled/disabled/skip-reason display. */
export function standingOrderStatusLabel(
  order: Pick<
    StandingOrderClient,
    'needsFirstFireConfirm' | 'enabled' | 'stoppedByKillSwitch' | 'lastSkipReason'
  >,
): string {
  if (order.needsFirstFireConfirm) return '⚠ NEEDS FIRST-RUN CONFIRM';
  if (order.stoppedByKillSwitch) return '■ STOPPED';
  if (!order.enabled) return '○ DISABLED';
  if (order.lastSkipReason === 'budget-paused') return '⏸ PAUSED — budget'; // legacy value
  if (order.lastSkipReason && isAutomationPauseReason(order.lastSkipReason)) {
    return `⏸ PAUSED — ${budgetPauseReasonWord(order.lastSkipReason)}`;
  }
  if (order.lastSkipReason) return `⚠ SKIPPED — ${order.lastSkipReason}`;
  return '● ACTIVE';
}

/** Whether a new standing order can be created given how many are already
 *  enabled and the perk-derived cap — client-side hint only; the server
 *  re-validates for real. */
export function canCreateStandingOrder(enabledCount: number, cap: number): boolean {
  return enabledCount < cap;
}
