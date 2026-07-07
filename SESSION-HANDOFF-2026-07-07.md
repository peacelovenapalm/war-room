# Session Handoff — 2026-07-07 — War Room v0 LIVE, v1 = gamification

## 1 · Verified current state (live commands, this session)

- **Deployed + reachable:** `https://nexus.tail722a2e.ts.net:8484` — SPA HTTP 200,
  `/api/health` ok, `/api/briefing` serving real data (todo 2026-07-06 top-3 +
  10 tracker gates). `tailscale serve status` shows :8484 **tailnet only**
  alongside the existing :10000/:10001 dashboards; no funnel entry. Container
  `war-room` on nexus loopback :3141 with read-only briefing mounts.
- **Branch `war-room/v0`** — HEAD `ee07a41`, 27 commits, **UNPUSHED** (Greg's
  call). Working tree clean. Deployed image was built from this HEAD (rsync
  post-commit), so live == repo.
- **Data freshness by construction:** todo comes from the vault-notifier Brain2
  clone on NEXUS (cron hard-resets to origin/main every 15 min → new daily todo
  appears automatically); tracker STATE.md is rsynced by the deploy runbook
  (laptop copy is canonical — `/Users/greg/code/completion-2026-07` is NOT a
  git repo).
- **One-time fix applied on NEXUS:** `sudo tailscale set --operator=gregory` —
  future `tailscale serve` changes need no sudo.

## 2 · Accomplished this session

- v0 M0–M4 built + adversarially reviewed (22 commits; 2 review defects fixed,
  incl. upstream auto-writing `~/.claude/settings.json` — now off by default).
- Briefing feature: `server/src/briefingProvider.ts` + `GET /api/briefing`
  (60s cache, env-driven paths, null-safe) + webview BRIEFING HUD panel
  (glyph+word statuses). Tests: server 236/236 (+13), webview 48/48.
- Deploy runbook converted to no-sudo tailscale-serve + briefing mounts
  (`ee07a41`); Greg executed it; live verification done end-to-end.
- `.planning/GAMIFICATION-BRIEF.md` — v1 design contract seed distilled from
  Greg's management-game design notes.

## 3 · In progress

- Nothing mid-edit. v1 not started — by design, it starts from the brief.

## 4 · Deferred / gated

- ✗ **Mac hooks install** (`.planning/runbooks/macbook-hooks-install.sh
MACBOOK`, then `MINI`) — until run, the office shows NO live agents (only
  the briefing panel). This is the #1 gap between "deployed" and "alive".
- ✗ **Poller launchd install** (`.planning/runbooks/install-poller-launchd.sh`
  per machine) — needs-input badges from `claude agents --json`.
- ✗ **Push decision** — `war-room/v0` unpushed; 4/27 commit subjects lack the
  em-dash (review finding) — reword or accept, then push.
- ◷ **Briefing "Full list" section counts 0** — cosmetic parser scoping note
  (h2 wrapper counts only its own direct checkboxes); harmless, documented in
  the provider docstring.
- ◷ **v0 parking lot** unchanged (steering broker, semantic zoom, OTEL rail,
  Codex) — reopen only via the brief's guardrails.

## 5 · Decisions made

- Serve via `tailscale serve` not Caddy — no sudo, matches the :10000/:10001
  house pattern; runbook updated accordingly.
- Briefing endpoint is unauthenticated (read-only, tailnet-only server, same
  trust level as the SPA itself).
- Todo source = vault-notifier clone rather than a new sync job — freshness
  for free, zero new moving parts.
- Gamify REAL ops (tokens/crises/gates), never a fake overlay; efficiency
  scoring must reward LOW token spend (tokens are money).

## 6 · Next steps (max 3)

1. **Make the office alive (<5 min):** run
   `bash .planning/runbooks/macbook-hooks-install.sh MACBOOK` on this laptop,
   then reload the dashboard — your live sessions should appear with machine
   labels. (Then `MINI`, then the poller runbook on each.)
2. **Answer the 3 open questions** at the bottom of
   `.planning/GAMIFICATION-BRIEF.md` (shift-report delivery, progression
   storage, sound) — they gate v1 mechanic #3 only, so building can start
   without them.
3. **Kick off v1** with the prompt below (crisis/triage layer first).

## 7 · Kickoff prompt (next agent, verbatim)

```
Read, in order: /Users/greg/code/war-room/.planning/GOAL.md (v0 contract — its
hard constraints all still apply), .planning/STATE.md (bottom section = live
deploy state), .planning/GAMIFICATION-BRIEF.md (the v1 design contract), and
SESSION-HANDOFF-2026-07-07.md.

State: v0 is LIVE tailnet-only at https://nexus.tail722a2e.ts.net:8484 (docker
on nexus, tailscale serve). Branch war-room/v0, unpushed. Briefing panel ships
real todo + half-baked-gate data. Mac hooks/poller may or may not be installed
yet — check the dashboard for live agents and adapt (simulated agents via the
authed ingest are fine for dev, the M2 pattern).

Task: build v1 mechanic #1 from the brief — the crisis & triage layer (blocked
session = aging fire at the agent's desk, shape+label only; triage queue by
age×severity; visible calm on resolution). Work on a new branch war-room/v1
from war-room/v0. Colorblind grayscale test and the existing 236+48 tests stay
green. Verify by exercising with simulated crises, screenshot evidence to
.planning/evidence/, atomic commits (em-dash convention), no push, gated
actions → runbooks only. Redeploy to NEXUS is Greg re-running
.planning/runbooks/nexus-war-room-deploy.sh — never deploy yourself.
```
