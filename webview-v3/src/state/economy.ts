/**
 * Economy snapshot reducer — a verbatim mirror of the server's
 * economyUpdate broadcast (cash, reputation, ledger). Null until the first
 * update arrives: the HUD shows an honest '—', never a fake 0 (an absent
 * feed and a zero balance are different facts).
 */

import type { EconomyLedgerEntry, ServerMessage } from '../../../core/src/messages.js';

export interface EconomySnapshot {
  cash: number;
  reputation: number;
  ledger: EconomyLedgerEntry[];
}

export function reduceEconomy(
  prev: EconomySnapshot | null,
  message: ServerMessage,
): EconomySnapshot | null {
  if (message.type !== 'economyUpdate') return prev;
  return { cash: message.cash, reputation: message.reputation, ledger: message.ledger };
}

/** 1234567 → "1,234,567" (deterministic, locale-free). */
export function groupThousands(value: number): string {
  const negative = value < 0;
  const digits = String(Math.trunc(Math.abs(value)));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return negative ? `-${grouped}` : grouped;
}

export function formatCashChip(snapshot: EconomySnapshot | null): string {
  return snapshot === null ? '$ —' : `$ ${groupThousands(snapshot.cash)}`;
}

export function formatRepChip(snapshot: EconomySnapshot | null): string {
  return snapshot === null ? '★ —' : `★ ${groupThousands(snapshot.reputation)}`;
}
