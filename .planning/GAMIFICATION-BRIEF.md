# GAMIFICATION BRIEF — War Room v1 direction (2026-07-07)

Source: Greg's design notes after first live browse of v0 (2026-07-07). Verdict on
v0: "aesthetics work, but it lacks fun or gamification." This brief is the seed
goal-contract for the next iteration. It does NOT reopen v0's parking lot by
default — it defines a new, deliberate scope.

## The one-line thesis

The office should gamify Greg's REAL ops — real agents, real tokens, real todo
and half-baked gates — never a fake game bolted on top. The fantasy: watching a
sprawling, organized workspace run efficiently, and making meaningful triage
decisions when it doesn't.

## Design principles (distilled from Greg's notes, in his priority language)

1. **Constant supply of interesting decisions.** If the right action is a
   no-brainer, it isn't a game. Decisions must trade competing concerns.
2. **Multiple crisis management.** More than one problem live at once, never
   enough resources for all (SimCity model). Success generates new problems.
3. **Progression = new levers, not new skins.** Unlocks should add mechanics
   (and attach new problems), not just novelty. Eyes always on the next thing.
4. **Emergent behavior.** No individual mechanic needs to be deep — mechanics
   must INTERACT (Dwarf Fortress). Cheap simple rules, surprising combinations.
5. **Creative expression.** "My office is different from yours" — layout,
   decor, arrangement persist and mean something.
6. **No single dominant strategy.** Real life supplies the randomness (each
   day's workload differs); vary constraints rather than scripting outcomes.
7. **Efficient feedback loops.** Fixing a thing must visibly, immediately calm
   the office. Deep sense of accomplishment from visible order.

## Mapping to War Room reality (what we already have to build on)

| Game concept          | Real substrate already streaming                                                |
| --------------------- | ------------------------------------------------------------------------------- |
| Resources (gold/wood) | `agentTokenUsage` events (real token spend), rate-limit windows                 |
| Crises                | `state:"blocked"` + waitingFor (M4 poller), NEEDS INPUT chips (M3), failed runs |
| Quests / objectives   | `/api/briefing`: today's top-3, aging/blocked counts, half-baked gate tallies   |
| Territory / build     | pixel-agents furniture + layout editor (upstream, already in the fork)          |
| Population            | live agents per machine (MACBOOK / MINI / NEXUS labels, M2)                     |

## Candidate mechanics — ranked v1 slice (build in this order)

1. **Crisis & triage layer.** Blocked session = visible FIRE at that agent's
   desk (shape+label, ⚠ NEEDS INPUT is already loudest — escalate with age:
   smoke → fire → alarm as minutes pass). Multiple concurrent crises render as
   a triage queue ordered by age×severity. Clearing one visibly calms the room
   (feedback loop). Failed/stopped agents leave "debris" until acknowledged.
2. **Daily shift report (scorecard).** At a set hour (or on demand), an
   end-of-day card computed from briefing deltas + session events: todos
   closed, gates advanced, tokens spent, crises cleared, mean time-to-unblock.
   **Efficiency scoring rewards LOW token spend per completion** — never
   gamify spending more (tokens are real money).
3. **Office progression tied to REAL milestones.** Half-baked tracker gates
   closing = office upgrades (new room, better furniture tier, plants). The
   tech tree is Greg's actual backlog. New levers attach new problems where
   honest (e.g. unlocking a second machine's wing means its crises now show).
4. **Emergence pass (cheap rules that interact).** Idle agents wander to the
   coffee machine; agents in the same repo cluster/pair; a long-blocked agent
   draws a crowd; night mode when no sessions. No rule deeper than ~20 lines;
   the fun is the combinations.
5. **Expression pass.** Layout/decor persistence (upstream editor already
   exists), decor unlocks fed by streaks (M5 soak = a literal daily-use streak
   mechanic) and by shift-report grades.

## Hard guardrails (carry over from v0 GOAL.md — non-negotiable)

- **Colorblind:** every new signal SHAPE + TEXT LABEL first; grayscale test
  stays in the acceptance loop. Fire/smoke/alarm need distinct silhouettes.
- **Never gate real function behind game progress.** Dashboard first, game
  second. All data views reachable regardless of unlocks.
- **No dark patterns on real money.** Token mechanics reward efficiency and
  completion, never volume.
- **Tailnet-only, WS event plane, MIT headers, gated runbooks, atomic
  commits** — all v0 rules stand unchanged.
- v0's parking lot (steering/approval broker, semantic zoom, OTEL rail,
  Codex ingestion) stays parked unless a mechanic above genuinely needs it.

## Open questions for Greg (max 3, answer before building #3)

1. Shift report delivery: in-dashboard only, or also pushed to the morning
   page / Bark?
2. Should progression state live server-side (shared across devices) or
   per-browser? (Server-side recommended — it's one user, many screens.)
3. Is there appetite for light sound (office ambience / alarm chirp), or
   keep it silent?
