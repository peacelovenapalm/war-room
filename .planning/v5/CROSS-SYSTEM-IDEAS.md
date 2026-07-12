# Cross-System Ideas — v5 candidates (2026-07-12)

Ideation pass over the estate: War Room board (deployed on NEXUS, v3 face at
root), Brain2 vault + 9-routine cloud fleet, NEXUS services (nexus-notifier →
Bark + morning page, watchdog, Gitea, Immich), dispatch runner fleet (MACBOOK
84 skills + sessions:true + tailer; MINI 91 skills + sessions:true + shell
compute), knowledge graph (`vault/_meta/graph/{nodes,edges}.jsonl`, live via
`/api/graph/search`).

Every idea below is grounded in a capability verified this session (file or
ledger-entry citation). Ranked by leverage-per-effort; bias = connect/finish
existing wires over net-new systems. Epistemics: wire citations are
**verified** (file read/listed today) or **reported** (STATE-v4 ledger entry,
orchestrator-verified there).

Legend: size S = one sitting, M = one phase lane, L = multi-lane phase.

---

## 1. ONE morning push — fold board state into the morning page

- **Systems:** nexus-notifier + War Room server API + routine fleet outputs.
- **What Greg gets:** a single Bark push opens a single page containing
  everything the morning currently spreads across page + board + PR list.
- **Existing wires:** `scripts/nexus-notifier/gen_morning_page.py` +
  `morning_page/morning.json` (verified); board endpoints on the same host:
  `/api/ops/review` (`server/src/opsAdvisor.ts`, verified), `/api/inbox`
  (`server/src/inboxProvider.ts`, verified), `/api/agents/answers` +
  needs-input state (reported, STATE-v4 2.3/2.5). Notifier already auto-pulls
  config from its vault clone each cron tick.
- **Genuinely new:** ~40 lines in `gen_morning_page.py` — curl 2–3 board
  endpoints (localhost on NEXUS, no auth change needed at the tailnet-read
  tier) and render three extra sections: ⚠ NEEDS INPUT (count + names),
  ◷ HELD BUDGET jobs, ✉ OPEN ROUTINE PRs.
- **Size:** S.
- **First step (<5 min):** open `gen_morning_page.py`, add one
  `requests.get("http://127.0.0.1:<port>/api/ops/review")` behind a
  try/except and print the finding count into `morning.json`.

## 2. Finish DISTRICTS — wire the two real data sources

- **Systems:** War Room board + project repo ledgers (war-room, TWE) + NEXUS.
- **What Greg gets:** the already-shipped ⌂ DISTRICTS view stops saying
  ⊘ NO DATA and shows real phase progress for his two active lanes.
- **Existing wires:** `server/src/districtsProvider.ts` (verified) with a
  3-strategy STATE.md parser already tested against both repos' real ledgers;
  the runbook wiring block exists but is deliberately commented out because
  the nexus checkouts were stale — honest-absent beat stale-plausible
  (reported, STATE-v4 d7fa85f / Phase-5 log).
- **Genuinely new:** nothing in code. Fresh `git clone`/`git pull` of TWE +
  war-room on nexus, a cron or deploy-runbook step to keep them pulled, and
  uncommenting the env block. This is the purest "finish half-built" item on
  the list.
- **Size:** S.
- **First step (<5 min):** ssh nexus, `git -C <twe-checkout> pull` (or fresh
  clone), confirm its `.planning/**/STATE*.md` parses with the provider's
  test fixture expectations.

## 3. Nightly knowledge-graph rebuild on the MINI (shell compute)

- **Systems:** MINI shell-compute plane + knowledge graph + board graph search.
- **What Greg gets:** `/api/graph/search` stays fresh without his laptop being
  open — the graph currently only updates when a desktop session rebuilds it.
- **Existing wires:** T8 shell provider is live end-to-end on the MINI —
  `fleet_health.py` at `~/scripts/compute/`, allowlisted in dispatch.json,
  advertised scriptIds, full dispatch→exit=0→resultTail verified on the wire
  (reported, STATE-v4 Phase-5 log). Graph store `vault/_meta/graph/` +
  build/query tooling exist (verified store; build script reported, routine
  fleet v2 memory). Runner lesson already recorded: absolute binary paths.
- **Genuinely new:** one `graph_rebuild` wrapper script (pull vault clone,
  run graph_build, commit/push the two JSONL files to a `claude/graph`
  branch or rsync to the NEXUS :ro mount) + one allowlist entry. Trigger:
  launchd on the MINI, or one-tap SCRIPT dispatch from the CALL modal.
- **Size:** S.
- **First step (<5 min):** copy the fleet_health.py registration pattern —
  create `~/scripts/compute/graph_rebuild.sh` on the MINI that just
  `git -C ~/Brain2 pull` and echoes the graph file mtimes; register it;
  dispatch it from the board to prove the loop before adding the build.

## 4. Watchdog probes the remote-first stack (Tbilisi posture)

- **Systems:** NEXUS watchdog + War Room API + runner fleet + morning page.
- **What Greg gets:** if any plane he'll depend on from Tbilisi (board,
  tailer ingest, runner advertisements, morning page, Gitea) dies, his phone
  says so — instead of him discovering it at 8,000 miles when he needs it.
- **Existing wires:** watchdog already runs on nexus and Barks on RAID/disk/
  docker/backup failures (reported, nexus-health memory 2026-07-02);
  `/api/health` exists (`server/src/httpServer.ts`, verified); runners
  advertise skills/sessions/scriptIds on their poll (reported, STATE-v4);
  morning page is a funnel URL.
- **Genuinely new:** ~5 probe lines in the watchdog: curl `/api/health` +
  `/api/version`, check each machine's last-advertisement age via the board
  API, HTTP 200 on the morning page and Gitea. Bark with a named ✗ per
  failed probe. Optionally a monthly "remote drill" checklist note.
- **Size:** S.
- **First step (<5 min):** add one `curl -fsS http://127.0.0.1:<port>/api/health`
  probe to the watchdog script and force-fail it once to see the Bark arrive.

## 5. Todo top-3 → one-tap dispatch from SHIFT MORNING

- **Systems:** routine fleet (todo-compiler) + board SHIFT section + dispatch
  plane (CALL modal, preamble, skills).
- **What Greg gets:** the morning decision collapses from "read item, open
  laptop, compose a prompt" to "tap ▸ START on the phone" — the single
  biggest morning-friction cut available with zero new planes.
- **Existing wires:** SHIFT MORNING already renders digest + todo top-3 with
  ◷ STALE marker from the `:ro` routines mount (reported, STATE-v4 Phase-5
  Lane B, `bf69c8f`); CALL modal already supports job dispatch with
  context preamble + vault pointer + skill picker (reported, Phase-4/5); the
  confirm-step button pattern exists from T3 rung 2 (reported, `af2b2b0`).
- **Genuinely new:** a ▸ DISPATCH affordance per todo item that opens the
  existing CALL modal prefilled with the todo text as the prompt. No new
  routes, no new wire types — pure client prefill.
- **Size:** M (UI lane + e2e; server untouched).
- **First step (<5 min):** find where the todo top-3 renders in webview-v3's
  SHIFT panel and add a stub button that `console.log`s the item text.

## 6. Routine PRs in the INBOX tray, with a gated phone merge

- **Systems:** routine fleet (claude/* branches) + board INBOX + runner shell
  compute + Gitea/GitHub.
- **What Greg gets:** vault-fixer and friends stop rotting unmerged — he
  reviews the diff summary and merges from the phone during the morning
  scroll. (The /morning desktop skill already lists open PRs; this makes it
  phone-first.)
- **Existing wires:** ✉ INBOX tray + `/api/inbox` (verified,
  `inboxProvider.ts`); vault-fixer's human-merge-only policy (verified,
  `vault/.claude/routines/README.md` merge table); T8 shell provider's
  strict-arg allowlisted script pattern (reported, STATE-v4 T8); `gh` exists
  on the runners.
- **Genuinely new:** a `merge-routine-pr` compute script (arg = PR number,
  validated; `gh pr view --json files` gate that refuses anything touching
  outside `vault/`; then `gh pr merge`) + an INBOX row per open `claude/*`
  PR with the existing confirm-step button pattern. Auto-merge policy
  unchanged — this only covers the human-merge ones.
- **Size:** M.
- **First step (<5 min):** write the script's read-only half —
  `gh pr list --label routine` formatted as JSON — and register it on the
  MINI allowlist as a dispatchable read.

## 7. Vault flags feed OPS REVIEW (one ops surface for both fleets)

- **Systems:** routine fleet (vault-health, project-pulse, docs-tracker) +
  board Ops Advisor.
- **What Greg gets:** one panel answers "is anything wrong anywhere" —
  vault rot and agent-fleet problems today live on two different surfaces
  with two different habits.
- **Existing wires:** flag-only routine outputs already land in
  `_inbox/routines/{vault-health,project-pulse,docs-tracker}/` (verified,
  dir listing) and are already readable by the server via the same `:ro`
  mount the inbox uses (verified, `inboxProvider.ts` header comment);
  `opsAdvisor.ts` already has the finding-kinds + receipts + all-clear
  briefing-cache structure (verified).
- **Genuinely new:** a vault-findings source in opsAdvisor that parses the
  newest flag ledger per routine into findings (kind `vault`, receipt = the
  flag file path + line). Flag-count deltas (Δ +/-) are already in the
  routine commit subjects, so "new since yesterday" is derivable.
- **Size:** M.
- **First step (<5 min):** open the newest
  `_inbox/routines/vault-health/*.md` and write down its section shape —
  that's the parser spec.

## 8. Dispatch/answer receipts → vault ledger (agent history becomes memory)

- **Systems:** War Room receipts + vault `_inbox` + daily-digest routine.
- **What Greg gets:** "what did my agents actually do this week" becomes a
  grep/graph-able vault note instead of evaporating board state — and the
  daily digest can fold it in for free.
- **Existing wires:** receipts exist server-side with verbatim causes
  (`/api/agents/answers`, auto-executor receipts — reported, STATE-v4
  2.3/3.3); the routines boundary explicitly allows `claude/*`-branch
  writes into `_inbox/routines/<name>/` (verified, vault CLAUDE.md); the
  nexus-notifier already demonstrates the read-vault-clone-on-cron pattern
  (verified, its dir).
- **Genuinely new:** a small nexus cron (`war-room-ledger`) that curls the
  receipt endpoints, renders one markdown note per day into
  `_inbox/routines/war-room-ledger/`, and pushes a `claude/*` branch under
  the existing auto-merge policy for inert `_inbox` reports.
- **Size:** M.
- **First step (<5 min):** ssh nexus,
  `curl -s localhost:<port>/api/agents/answers | head` — confirm the shape
  is stable enough to render.

## 9. Scheduled estate fleet-health sweep → OPS REVIEW

- **Systems:** MINI + MACBOOK compute plane + Ops Advisor + Bark.
- **What Greg gets:** disk/load/ram for every machine as findings on the one
  ops panel (and in the morning push via idea 1) — today `fleet-health`
  only runs when he taps it.
- **Existing wires:** `fleet_health.py` live-verified on the MINI end-to-end
  (reported, STATE-v4 Phase-5); dispatch requests can be made
  programmatically against the server WS/API (reported, T8 verification used
  exactly that); opsAdvisor finding structure (verified).
- **Genuinely new:** a server-side daily tick (or nexus cron) that dispatches
  `fleet-health` to each advertising machine and folds threshold breaches
  into opsAdvisor findings. Register the same script on MACBOOK (copy the
  MINI onboarding, absolute-paths lesson already recorded).
- **Size:** M.
- **First step (<5 min):** copy `fleet_health.py` + its dispatch.json entry
  onto MACBOOK and restart the runner — the script picker will show it.

## 10. Graph-aware daily digest (routine outputs, new dimension)

- **Systems:** knowledge graph + cloud routine fleet (daily-digest).
- **What Greg gets:** each digest item arrives with its graph neighborhood
  ("touches: waypoint, nexus-notifier") so triage needs no vault spelunking.
- **Existing wires:** `vault/_meta/graph/{nodes,edges}.jsonl` is a plain
  in-repo file (verified), so the cloud routine can read it with zero infra
  — no API, no mount, no secrets; daily-digest is live and auto-merged
  (verified, routines README).
- **Genuinely new:** a prompt-only change to `daily-digest.md`: for each
  surfaced item, grep nodes.jsonl for the matching node and list 2–3 linked
  neighbors. One re-paste into the cloud UI (known workflow).
- **Size:** S (prompt edit + re-paste; freshness improves further once
  idea 3 lands).
- **First step (<5 min):** grep `nodes.jsonl` for one of today's digest
  topics by hand to confirm match quality before editing the prompt.

---

## Rank summary (leverage ÷ effort)

| #   | Idea                     | Size | Why this rank                                                                 |
| --- | ------------------------ | ---- | ----------------------------------------------------------------------------- |
| 1   | ONE morning push         | S    | Biggest decision-load cut per line of code; same host, endpoints already live |
| 2   | Finish DISTRICTS         | S    | Zero code; converts a shipped-but-honest-empty feature into a real one        |
| 3   | MINI graph rebuild       | S    | Unlocks idea 10's freshness + Tbilisi-proof graph; proven script pattern      |
| 4   | Watchdog remote probes   | S    | Cheapest insurance for the Nov relocation; failure is currently silent        |
| 5   | Todo → one-tap dispatch  | M    | Morning friction to near zero; pure client work on existing planes            |
| 6   | Phone PR merge           | M    | Kills the last desktop-only morning chore; needs the gated script             |
| 7   | Vault flags → OPS REVIEW | M    | One ops surface; parser is the only new code                                  |
| 8   | Receipts → vault ledger  | M    | Memory loop; valuable but nothing blocks on it                                |
| 9   | Scheduled fleet sweep    | M    | Nice-to-have once 1+4 exist; overlaps watchdog partially                      |
| 10  | Graph-aware digest       | S    | Cheap, but payoff depends on graph freshness (idea 3 first)                   |

## CUT list (considered, explicitly not proposed)

- **Free-form prompting of unmanaged/hand-started sessions** — design-gated
  in v4 (G-1 rider); the by-construction DESK-only containment is the
  feature. Do not reopen from an ideation doc.
- **New cloud routines** — the fleet is 9 and each addition costs a paste +
  merge-policy row; every idea above reuses existing routines instead.
- **Per-project Projects-Board rollout** — Greg explicitly deferred until he
  shares design ideas; parked, not planned.
- **n8n as glue for any of the above** — the Bark-loop-on-restart history
  makes it the least reliable plane in the estate; nexus cron + board API
  cover every case here.
- **Immich integrations** (photo-of-the-day on morning page etc.) — charming,
  zero leverage toward finish-half-built.
- **Blender/sprite/aesthetic passes** — already cut from v4; not
  cross-system leverage.
- **A separate "estate status page"** — would compete with OPS REVIEW +
  morning page; ideas 1/4/7/9 upgrade those instead of forking a new surface.
