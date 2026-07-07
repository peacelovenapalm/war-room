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
- ✗ **NEXUS manifest stale (affects the ARCADE war-room tool, not this repo)**
  — investigated 2026-07-07, root cause found: the every-2-min rebuild cron
  self-aborts (log redirect into root-owned `/var/log`), AND nexus's manifest
  clone is 103 commits behind (frozen 2026-05-06, double-wrapped shape).
  Case file: `/Users/greg/code/completion-2026-07/nexus-manifest-investigation-2026-07-07.md`.
  Gated fix (Greg runs): `bash /Users/greg/code/completion-2026-07/runbooks/fix-nexus-manifest.sh`.

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
real todo + half-baked-gate data. MACBOOK hooks are LIVE as of 2026-07-07 via
the command-hook forwarder ~/.war-room/hook.sh (smoke test 200; NEVER install
type:"http" hooks — Claude Code blocks them for private IPs and it breaks
every session). MINI hooks + the per-machine pollers are NOT installed yet.
Simulated agents via the authed ingest remain fine for dev (the M2 pattern).

Task: build the v1 visual pass from the brief, in this order: (1) mechanic #1,
the crisis & triage layer (blocked session = aging fire at the agent's desk,
shape+label only; triage queue by age×severity; visible calm on resolution);
(2) the in-dashboard HELP SCREEN from the brief's Additions section (`?` key +
visible HELP button; explains every signal and mechanic; a mechanic isn't done
until its help section exists). Then, if capacity remains, start mechanic #6a
(Codex/Gemini sessions rendered as coworkers with provider text labels) — read
the brief's staged scope first; #6b dispatch needs a design pass before any
code. Work on a new branch war-room/v1 from war-room/v0. Colorblind grayscale
test and the existing 236+48 tests stay green. Verify by exercising with
simulated crises, screenshot evidence to .planning/evidence/, atomic commits
(em-dash convention), no push, gated actions → runbooks only. Redeploy to
NEXUS is Greg re-running .planning/runbooks/nexus-war-room-deploy.sh — never
deploy yourself.
```

## 8 · ADDENDUM 2026-07-07 (later) — hooks incident + rework

§6 step 1 was run and BROKE Claude Code on the MacBook: Claude Code blocks
`type:"http"` hooks whose URL resolves to a private IP (Tailscale 100.x), so
all 14 installed hooks errored on every tool call in every session. Cleaned
up same day (http entries stripped from `~/.claude/settings.json`; backup
`~/.claude/settings.json.bak-war-room-2026-07-07`).

The runbook is REWORKED to `type:"command"` hooks running a
`~/.war-room/hook.sh` forwarder (backgrounded curl, always exit 0, no
`.zshenv` hack) and sandbox-verified. Greg re-ran it on MACBOOK same day:
smoke test 200 — MACBOOK hooks are LIVE. Still pending: `MINI` hooks +
the poller runbook on both machines. Details: STATE.md
"2026-07-07 (later) — INCIDENT" section.

Scope additions for v1 (Greg, same day): an in-dashboard help screen, and
Codex/Gemini as coworkers (mechanic #6, staged 6a render / 6b dispatch) —
folded into `.planning/GAMIFICATION-BRIEF.md` "Additions" and the §7
kickoff prompt above.
