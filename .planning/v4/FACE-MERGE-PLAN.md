# Face Merge Plan — retire `/` (webview-ui), serve v3 at root

**Date:** 2026-07-12 · **Status:** PROPOSED — awaiting Greg's Tier-2 kill-list
gate. **Origin:** Greg noticed tooltips exist only on the old face at `/`
while he lives on `/v3`.

## Diagnosis (verified)

Not drift and not a bug: `httpServer.ts:139` says the old face stays the
root fallback "until the parity gate closes (KICKOFF-v3.1)". The gate never
closed; all v4 work landed in v3 only, so the two faces diverged in BOTH
directions. `.planning/v3/PARITY.md` was the original gap register; this
plan supersedes it with a fresh 2026-07-12 sweep.

- v3 is AHEAD on: districts, inbox, graph search, ops review, answer lane +
  live tail, dispatch visitors/tray, soundscape, deep links (`?agentId=`),
  phone grammar. Nothing mobile-or-core is old-face-only.
- Old face is AHEAD on (the full list — sweep evidence in file:line):
  1. **Tooltips** — two systems (`ControlTooltip.tsx` hover/press +
     `Tooltip.tsx` HUD info). v3 has only bare `title=` attributes.
  2. **PWA** — VitePWA manifest + service worker + iOS meta live ONLY in
     `webview-ui/vite.config.ts:119`. v3 explicitly "No PWA plugin yet"
     (`webview-v3/vite.config.ts:8`). The OLD face's SW also carries the
     `/v3/` navigateFallback denylist — retiring it changes SW behavior for
     every phone that ever visited root. This is the risky seam.
  3. **Live tool-call/subagent activity** — `agentTool*`/`subagentTool*` WS
     types are unhandled in v3.
  4. **FOCUS verb** — wire type exists, tray renders `[FOCUS]`, but no v3
     button sends it (dead plumbing; PARITY gap #1 still open).
  5. **Office layout editor** + saveLayout/export/import/saveAgentSeats +
     external-asset-dir add/remove (read-only in v3 settings).
  6. Progression HUD, Unlocks panel, Employee roster + 8 verbs, Changelog/
     version indicator, rotating tips, world-event banner, migration
     notice, hooks first-run tooltip, `openSessionsFolder`.

## Tiers

### Tier 1 — port INTO v3 before cutover (keeps v3 look & feel)

| Item                       | Shape                                                                                                                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1a tooltip system         | Port the ControlTooltip pattern (hover + long-press) restyled to v3 chrome; apply to PanelDock, HudStrip, TriageBoard, AgentDrawer, CallModal controls. Help text source: reuse `helpContent.ts` strings. |
| T1b PWA for v3             | VitePWA in `webview-v3/vite.config.ts` (manifest, icons, iOS meta, SW with `/api/` + `/ws` denylist). Must be designed WITH the cutover (T3) — the root SW handoff is one seam.                           |
| T1c tool/subagent activity | Consume `agentTool*`/`subagentTool*` in v3 idiom: speech bubbles + FloorFeed lines + a drawer "NOW RUNNING: <tool>" row — not the old canvas rendering.                                                   |
| T1d FOCUS verb             | Drawer button sending `dispatchRequest action:'focus'` gated on the machine's `focus:true` capability (plumbing already live server/runner side).                                                         |

### Tier 2 — GREG GATE: declare dead or port-later (default: dead)

Progression HUD (fake-XP — v3 doctrine already rejects it), Unlocks panel,
Employee roster + verbs, world events, migration notice, rotating tips,
changelog modal, hooks first-run tooltip, office layout editor + seats +
asset-dir writes, `openSessionsFolder`. Each item Greg doesn't name
survives as DECLARED-DEAD in this doc (no more silent drops).

### Tier 3 — cutover (small, after Tier 1 green)

1. `server/src/cli.ts:78-81` + `httpServer.ts` static block: serve
   `dist/webview-v3` at `/`; old face moves to `/v1/` for one grace
   release; `/v3` and `/v3/` 301 → `/` (bookmarks/PWA icons keep working).
2. SW handoff: v3's new root SW ships `clientsClaim`+`skipWaiting`; verify
   a phone that had the OLD root SW updates cleanly (the autoUpdate
   registration on the old face makes this work, but it must be TESTED on
   Greg's actual phone before the old face is deleted).
3. Runbook: manifest check stays valid (new manifest at same root path);
   add a `/` → v3 marker check (e.g. `hud-connection` string).
4. e2e: root-serving specs + redirect spec.

### Tier 4 — retire

Delete `webview-ui/` + its build lane + `test:webview` after one release of
`/v1/` grace and Greg's on-phone acceptance. Archive per repo policy
(move, never delete history — git keeps it regardless).

## Suggested execution

Phase A (Sonnet lanes): T1a + T1c + T1d — pure v3 UI work, parallelizable.
Phase B (Fable seam): T1b + Tier 3 together — PWA/SW/routing is one
containment seam, one owner. codex cross-model review before deploy.
Phase C: Greg on-phone acceptance (install PWA fresh + upgrade-in-place
path) → Tier 4 retire.
Full gate + ledger discipline per KICKOFF-v4 rules throughout.
