# REVENUE.md — the revenue-ready CASH seam

**Status: seam only. No real-money ingestion is built, on purpose.**

Greg's decision (KICKOFF-v3.1 §1, CASH row, 2026-07-10): CASH is
_"lightweight/cosmetic now, REVENUE-READY by design — eventually pull
real numbers from how much we are actually making, but at the moment
none of our projects make any money."_ This file documents exactly where
real ingestion plugs in later so that day is a small PR, not a refactor.

## The seam

```
real observed events ──▶ RevenueProvider.getRevenueEvents() ──▶ EconomyStore.ingestRevenue()
                          (RevenueEvent: ts, amount, cause)        the ONLY door CASH-as-revenue
                                                                   enters through
```

- **`revenueProvider.ts`** defines `RevenueEvent` (amount + mandatory
  `EconomyCause` receipt — label + `sourceEventRefs`) and
  `RevenueProvider` (`getRevenueEvents()`, drain semantics: each event is
  returned exactly once; the provider owns dedup).
- **`economyStore.ingestRevenue(provider)`** drains the provider and
  credits CASH with the receipt attached. Guardrails enforced at the
  door: negative amounts are refused (revenue only credits — a debit can
  never masquerade as revenue); every event carries a full cause (the
  type system requires it).
- **`SyntheticRevenueProvider`** is the single implementation today. It
  holds the pre-existing synthetic earning rules, relocated verbatim
  (turn / once-a-day streak touch / observed crisis resolution /
  shift-grade / capped dispatch exit-0). Behavior is byte-identical to
  the pre-seam store — the acceptance gate for the relocation is that
  the existing `economyStore.test.ts` suite passes **unchanged**.
  Dedup/cap state (streak touch date, dispatch daily-cap window) still
  lives in `economy.json` via the `SyntheticRevenueState` accessor, so
  restart semantics did not move.

## Where real ingestion plugs in later (and ONLY later)

When a project starts making real money (Stripe is the likely first
source — TWE/AMC both have Stripe surfaces):

1. Implement `StripeRevenueProvider implements RevenueProvider` in a new
   `server/src/stripeRevenueProvider.ts`. Source events are Stripe
   objects observed via webhook or polling; each `RevenueEvent.cause`
   MUST carry verbatim refs, e.g.
   `sourceEventRefs: ['stripe:payment_intent:pi_...', 'stripe:charge:ch_...']`
   — the one-tap-real rule applies to real dollars more than anywhere
   else.
2. Wire it once in `createHttpServer()` next to the other `start()`
   singletons (chainOrchestrator discipline: idempotent start, observed
   events only), calling
   `economyStore.ingestRevenue(stripeRevenueProvider)` on its tick.
3. Decide the display question **with Greg before shipping** (hard-rule
   gate: "real-money display" is on the KICKOFF §4 stop-and-ask list):
   real dollars and synthetic CASH must never be visually conflated
   without labeling. The likely shape: real revenue gets its own
   labeled currency/axis, or synthetic sources are retired.

## Synthetic CASH sources that do NOT ride the seam yet

These award CASH directly through `economyStore.addCash` (each with full
receipts). They are game-mechanics payouts, not simulated revenue, and
were deliberately left outside the provider. Revisit this inventory when
real money lands (either migrate them behind providers or retire them):

- `contractStore.ts` — v2 mission payouts (`contract:<id>` refs)
- `studioContractIngest.ts` — v3 wall-contract bonus (`studio-contract:<id>`)
- `worldEventStore.ts` — flavor bonus, capped +5/day (`world-event:<id>@<ts>`)
- `officeLayoutStore.ts` — sell refunds (negative spends, `player-action:sell:*`)

## What must never change here

- No dark patterns around real money (hard rule 3): no loss-aversion
  framing, no synthetic inflation of real numbers, targets below natural
  pace.
- Rewards derive from OBSERVED events only — never token volume, never
  bare timers (the `SyntheticRevenueProvider` doc header carries the
  full guardrail text).
- `ingestRevenue` refusing negative amounts is load-bearing: the seam
  must never become a hidden debit channel.
