# GOAL — War Room v0: pixel-agents fork, one view, two machines, zero color-only signals

This is the goal contract for the autonomous build loop. Every loop iteration
reads this file first. It is the narrowed scope from
`review-fable-medium.md` §6 — nothing outside it gets built without Greg
saying so in a new message.

## Mission (one sentence)

A tailnet-only browser dashboard on NEXUS, forked from
`pixel-agents-hq/pixel-agents`, showing live Claude Code agents from the
MacBook and Mac Mini as a pixel office, where session state and needs-input
are readable by shape + text label alone.

## Kill criterion — check FIRST every iteration

If Anthropic has shipped a hosted/web Agent View with cross-machine support
(check the Agent View docs / changelog at code.claude.com), STOP building.
Write a closing note to `.planning/STATE.md`, keep only the colorblind
rendering work, and tell Greg the kill criterion fired.

## Hard constraints (violating any of these = the iteration failed)

1. **Colorblind (deuteranopia):** agent identity and state via SHAPE + TEXT
   LABEL. Color is reinforcement only. Audit `colorize.ts` and every place
   the upstream renderer or UI encodes state as tint/color. Applies to the
   dashboard AND to any status output the loop itself prints (✓/✗/⚠ + words).
2. **Tailnet-only:** the dashboard and event endpoint bind behind Tailscale
   (Caddy on NEXUS, `nexus.tail722a2e.ts.net`). Never on the public funnel.
3. **Keep the fork's existing WebSocket event plane.** Do NOT build the
   greenfield SSE service from report 2. Graft report-2 ideas only if a real
   gap shows up in use (then: deterministic `event_id` + `INSERT OR IGNORE`).
4. **License hygiene:** patterns from disler's repo (no license) and ClaudeSec
   (AGPL) may be imitated, never copied. Upstream is MIT — keep headers.
5. **Gated actions** (NEXUS systemd/Caddy/Docker changes, anything touching
   shared services): never run directly. Package as a chmod +x runbook in
   `.planning/runbooks/` (the ntfy-kill.sh pattern: confirm prompt, [OK]/[WARN]
   lines, inline undo) and record it as blocked in STATE.md.
6. **Git:** atomic commits, conventional-commit subject + em-dash, explicit
   path staging only (no `git add -A`).
7. **Deliverables Greg must run = executable scripts**, not pasted command
   blocks (his terminal mangles multi-line pastes).

## Known traps (verified 2026-07-04 — do not rediscover these)

- The repo ROOT package of pixel-agents IS the VS Code extension
  (`main: ./dist/extension.js`); npm workspaces are only `server` +
  `webview-ui`. Decapitation = build-config surgery. The `dist/cli.js` bin
  (`npx pixel-agents`) already exists — start from it.
- The JSONL poller always runs and is inherently LOCAL. Remote machines send
  hook events only → remote agents will lack tool content in v0. Accept it;
  a per-machine tailer/forwarder is parking-lot.
- Claude Code `type:"http"` hooks: non-2xx/timeout = non-blocking, fire and
  forget (safe). `allowedEnvVars` is required for bearer-token interpolation.
- `claude agents --json` is a research-preview surface (v2.1.139+): fields
  `id, state ∈ {working, blocked, done, failed, stopped}, waitingFor, cwd,
pid, startedAt`. Wrap it in a normalizer; expect churn.

## Milestones — strictly in order, one per loop iteration or less

- [ ] **M0 Bootstrap.** `gh repo fork pixel-agents-hq/pixel-agents --clone`
      into `/Users/greg/code/war-room` (rename the fork repo `war-room`).
      Create `.planning/STATE.md` (copy this file's milestone list into it)
      and copy this GOAL.md to `.planning/GOAL.md`. Run the standalone CLI
      locally; verify a local Claude Code session renders. First command is
      under 5 minutes.
- [ ] **M1 Decapitate.** Standalone server + static browser build with the
      VS Code extension quarantined from the build (expect root package.json
      surgery). Acceptance: `server` serves the SPA from a plain
      `node`/`npx` start on macOS, no VS Code, no Electron, no Tauri.
- [ ] **M2 Second machine over Tailscale.** Server runs on NEXUS (Docker +
      Caddy route = GATED runbook). MacBook Claude Code ships events via
      native `type:"http"` hooks to it. Acceptance: sessions from two
      machines visible in one browser view, machine identity labeled in text.
- [ ] **M3 Colorblind pass.** Shape + text label for every state; per-agent
      name tags; needs-input as a distinct SHAPE (e.g. ⚠ badge + "NEEDS
      INPUT" text), not a tint. Acceptance: grayscale screenshot of the
      dashboard is fully readable.
- [ ] **M4 needs-input poller.** Small script per machine: poll
      `claude agents --json` every ~15s, POST normalized state to the server;
      render `state:"blocked"` + `waitingFor` as the loudest badge on screen.
      Acceptance: block a session behind a permission prompt on the MacBook,
      badge appears on the NEXUS dashboard within 30s.
- [ ] **M5 Soak (not a build task).** Use it daily for a month. Only after
      that does anything in the parking lot get discussed.

## Parking lot — explicitly NOT in scope (do not start these)

Four-view architecture, semantic zoom/LOD, steering/approval broker (if ever
built: block = 2xx + `permissionDecision:"deny"` body, NOT 403), Ollama,
OTEL/Grafana cost rail, Codex ingestion, per-machine JSONL forwarder.

## Definition of done (v0 shipped)

Dashboard reachable tailnet-only on NEXUS; live sessions from ≥2 machines;
needs-input badge via shape+text within 30s; survives laptop sleep/reconnect;
zero color-only signals (grayscale test passes); every gated NEXUS change has
a runbook; `.planning/STATE.md` current.
