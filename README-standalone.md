# War Room — standalone server (no VS Code)

This fork is decapitated: the VS Code extension is **quarantined from the
build**. The default build produces only the standalone server
(`dist/cli.js`), the SPA (`dist/webview/`), sprite assets, and the Claude
Code hook script. No VS Code, no Electron, no Tauri.

## Build

From the repo root:

```
npm install
npm run build
```

`npm run build` runs: AsyncAPI message codegen → esbuild (CLI bundle +
assets + hooks) → Vite build of the SPA into `dist/webview/`.
`dist/extension.js` is **not** produced.

## Start

```
node dist/cli.js --port 3141
```

(`npm start` is an alias; add `-- --port 3141` to pass the flag through.)

Then open `http://127.0.0.1:3141` in any browser. The server binds
loopback only — remote/tailnet exposure is a separate, gated milestone (M2).

- The working directory you start from determines which Claude Code
  project is watched: `~/.claude/projects/<encoded-cwd>/*.jsonl`.
- Live sessions in that project dir are adopted automatically and stream
  over the existing WebSocket event plane at `ws://127.0.0.1:<port>/ws`.
- Health check: `GET /api/health` → `{"status":"ok",...}`.

## Multi-machine ingest (M2)

Remote machines ship Claude Code hook events to `POST /api/hooks/claude`
on the existing event plane (no new service). Delivery is a
`type:"command"` hook running the `~/.war-room/hook.sh` forwarder, which
sources `~/.war-room/env` (token, server URL, machine label) and curls
the server in a detached background job — always exits 0, so a dead
server never blocks Claude Code. Native `type:"http"` hooks CANNOT be
used: Claude Code blocks http hooks whose URL resolves to a
private/link-local address, which includes every Tailscale 100.x IP
(learned 2026-07-07 — the http-hook install broke every session on the
machine).

- **Auth:** `Authorization: Bearer $WAR_ROOM_TOKEN`. Set `WAR_ROOM_TOKEN`
  in the server env to pin a stable token (otherwise it is random per
  start and remote hooks break on restart).
- **Machine identity:** requests carry an `X-Machine: <LABEL>` header
  (e.g. `MACBOOK`, `MINI`). The label renders as TEXT in the UI
  (`[MINI]` line in the agent overlay — shape + text, never color-only).
  Set `WAR_ROOM_MACHINE` in the server env to label local agents
  (default: hostname).
- **Remote sessions are hooks-only:** their JSONL transcript lives on the
  remote machine, so `transcript_path` is stripped at ingress and the
  agent renders from hook events alone (label + state; tool detail comes
  from `PreToolUse` payloads). This is the accepted v0 limitation.
- Deployment to NEXUS (Docker + Caddy on the tailnet listener) and hook
  installation on the Macs are **gated runbooks** in `.planning/runbooks/`
  — human-run only.

## Needs-input poller (M4)

Per-machine sidecar that makes `state:"blocked"` sessions loud even when
hooks/JSONL can't see the block (e.g. background `claude` agents):

```
WAR_ROOM_TOKEN=<token> node bin/needs-input-poller.mjs \
  --url http://127.0.0.1:3141 --machine MACBOOK
```

- Every ~15s it runs `claude agents --json` (research-preview surface,
  v2.1.139+), normalizes it through `bin/lib/normalize-agents.mjs`
  (tolerant: unknown fields ignored, malformed output = tick skipped
  with a `⚠` log line, never a crash) and POSTs to
  `POST /api/agents/poll` (same Bearer token, same `X-Machine` header).
- The server matches entries to adopted agents (sessionId → short-id
  prefix → unique cwd; never guesses on ambiguity) and broadcasts
  `agentPollState` on the existing WS event plane. `blocked` renders the
  ⚠ NEEDS INPUT chip (loudest element, SHAPE + TEXT), with `waitingFor`
  as the detail line; `failed`/`stopped` render their own chips.
- Staleness is fail-safe twice: the server clears state the poller stops
  reporting (per tick) and sweeps states older than 60s (dead poller);
  the webview additionally expires poll state client-side after 60s.
- Testing: `npm run test:poller` (node:test, fixtures include a real
  2.1.202 capture where `kind:"interactive"` entries have NO `state` —
  those are skipped by design). Fixture override for live drills:
  `--cmd "cat fixture.json"`.
- Install as a launchd agent = **gated runbook**
  `.planning/runbooks/install-poller-launchd.sh <MACHINE>` (human-run
  only; reuses the token stored by the hooks runbook).

## Briefing panel (post-v0)

The HUD's BRIEFING toggle overlays today's todo top-3 and the half-baked
project tracker's gate tallies. Data comes from two optional, env-wired
files on the deploy host — never hardcoded paths:

- **`WAR_ROOM_TODO_DIR`** — a directory of daily todo-compiler files named
  `YYYY-MM-DD.md`. The lexicographically-latest filename is used. The
  file's `## Start now` section's numbered items become the top-3; every
  other `##`/`###` heading contributes a `{title, count}` summary from its
  `- [ ]` items.
- **`WAR_ROOM_TRACKER_STATE`** — path to a single `STATE.md` whose YAML
  frontmatter carries `milestone_name:` and a `gates:` list (id, label,
  status, tasks). Parsed with a tolerant line-based parser (no YAML
  dependency).

Either or both may be unset — the corresponding half of the panel renders
"no source configured" instead of failing. `GET /api/briefing` is
unauthenticated, same as `/api/health` (the server itself is tailnet-only),
and the response is cached for 60s.

## Crisis & triage layer (v1)

A blocked session is a FIRE at that agent's desk that AGES — smoke (fresh),
flame (90 s+), flame + white flashing beacon (4 min+). Each stage is a
distinct SILHOUETTE + a text tag under the state chip (`▲ FIRE 2:41`).
Concurrent crises fill the TRIAGE board (top-right), sorted by
age × severity (blocked > failed > stopped) with the one-line cause
(`waitingFor`) per row. Failed/stopped sessions leave labeled DEBRIS at the
desk until acknowledged (click the desk label or the board's CLEAR button;
persists across refreshes via localStorage). Resolving a crisis steams the
desk with a floating `✓ RESOLVED`; the last one flashes `✓ ALL CLEAR`.

Aging is server-anchored: the poll ingest keeps the state's transition time
and broadcasts `ageMs` (rebroadcasting unchanged states every 20 s so the
webview's 60 s TTL never expires a still-blocked session — this also fixed a
v0 defect where >60 s blocks lost their badge).

## Help screen (v1)

`?` (or the **Help** toolbar button) opens the in-dashboard help screen:
every chip, fire stage, debris, the triage board, briefing panel, machine
labels, coworker badges, and where the data comes from.
`webview-ui/test/helpContent.test.ts` fails if a new state or stage ships
without a help entry.

## Coworker adapter — Codex / Gemini (v1 mechanic #6a)

Codex and Gemini CLI sessions render as coworkers: a distinct badge
silhouette above the head (square = Codex, diamond = Gemini) plus a
`[CODEX]` / `[GEMINI]` text label in the name tag. Per machine:

```
WAR_ROOM_TOKEN=<token> node bin/coworker-adapter.mjs \
  --url https://nexus.tail722a2e.ts.net:8484 --machine MACBOOK
```

It tails `~/.codex/sessions/**/rollout-*.jsonl` (tool-level: turns, shell
commands, approval prompts → NEEDS INPUT) and `~/.gemini/tmp/*/logs.json`
(heartbeat-level — the source is sparse), POSTing normalized hook events to
the authed `/api/hooks/codex` / `/api/hooks/gemini`. Only NEW activity
streams (pre-existing files seed at EOF) and no message content leaves the
machine. Env: `WAR_ROOM_URL`, `WAR_ROOM_TOKEN`, `WAR_ROOM_MACHINE`,
`WAR_ROOM_COWORKER_MS`, `WAR_ROOM_CODEX_DIR`, `WAR_ROOM_GEMINI_DIR`;
flags `--providers codex,gemini --interval <ms> --once --replay`.

Dispatch ("call a coworker from the dashboard") is design-only:
`.planning/DISPATCH-6B-DESIGN.md`.

## Config guard (do not undo)

`hooksEnabled` now **defaults to `false`** in this fork (upstream default
was `true`): a fresh `node dist/cli.js` on a new machine never writes hook
entries into `~/.claude/settings.json`. Hook wiring is always a human-run
runbook (`.planning/runbooks/macbook-hooks-install.sh`). The pre-seeded
`~/.pixel-agents/config.json` guard (`standalone.hooksEnabled: false`)
stays as belt-and-suspenders — do not flip it on outside a runbook.

## VS Code extension (quarantined)

The extension source stays in `adapters/vscode/` for reference and still
type-checks (`npm run check-types`), but it is only bundled when
explicitly requested:

```
npm run build:extension   # opt-in: node esbuild.js --extension --production
```

Nothing in the standalone build or start path requires it.
