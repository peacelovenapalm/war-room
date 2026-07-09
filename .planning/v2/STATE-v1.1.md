# STATE v1.1 — run ledger (machine-updated, newest log entries first)

status: IN PROGRESS <!-- IN PROGRESS | RUN COMPLETE -->

## Items

| #     | Item                                   | Status  | Evidence                                                                                                                                           |
| ----- | -------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Crisis-card click                      | done    | commit bca9ffc; e2e/tests/standalone/triage.spec.ts PASS (1/1); before/after + grayscale screenshots in test-results/e2e/triage-crisis-card-\*.png |
| 2     | Disappearing view (2a+2b)              | pending |                                                                                                                                                    |
| 3     | Worker session kill + adversarial pass | pending |                                                                                                                                                    |
| 4     | HUD/overlay layout pass                | pending |                                                                                                                                                    |
| 5     | Budget-pause visibility                | pending |                                                                                                                                                    |
| 6     | Employee-quit persist/broadcast        | pending |                                                                                                                                                    |
| 7     | Bark payload fix                       | pending |                                                                                                                                                    |
| 8     | Help/discoverability                   | pending |                                                                                                                                                    |
| 9     | FOCUS/osascript                        | pending |                                                                                                                                                    |
| 10-13 | F1-F4 (tail)                           | pending |                                                                                                                                                    |

## Deploy gates

| Gate | After                                          | Status  |
| ---- | ---------------------------------------------- | ------- |
| 1    | items 1-2                                      | pending |
| 2    | items 3-5                                      | pending |
| 3    | items 6-9 settled + landed F items + full gate | pending |

## Log

<!-- one line per event: ISO time — what happened / what's next -->

- 2026-07-09T08:51:22Z — LOOP-LOCK claimed (pid 97056), first iteration, STATE-v1.1.md created from KICKOFF-v1.1.md template. Next: baseline re-derivation + preflight.
- 2026-07-09T08:56:00Z — baseline re-derivation MATCHES expected exactly: check-types clean, lint clean, server 512/512, webview 264/264, bin/poller 74/74, build clean (PWA output present, 11 precache entries). No mismatch, no stop needed.
- 2026-07-09T08:58:00Z — preflight PASS: `ssh nexus-ts true` reachable; `npx playwright --version` → 1.59.1 present; `git push --dry-run` has no upstream on war-room/v1 (pre-existing — v0/v1 were never pushed to origin; deploy runbook rsyncs the local checkout over SSH directly, no git push in the deploy path, so this is not a blocker). Proceeding to item 1.
- 2026-07-09T09:40:00Z — item 1 DONE (commit bca9ffc). TriagePanel.tsx threads onOpenAgent (App.tsx handleClick) through TriageRowView; row onClick + CLEAR stopPropagation; testHooks.setCrisis added (deterministic e2e trigger, same pattern as existing selectAgent hook) since ch.crisis is server-broadcast-only. New e2e/tests/standalone/triage.spec.ts: mocks a PermissionRequest crisis, clicks the row, asserts `AGENT #<id>` drawer + drawer-row visible — PASS (1/1, 4s once VS Code cached). Before/after + grayscale screenshots captured and visually verified. First e2e run also primed the VS Code test-binary cache (.vscode-test/, 272MB one-time download, ~20s) — de-risks items 2/4/8's own Playwright PASS checks. check-types/lint/test (512/264/74) all re-verified clean post-change. Next: item 2 (disappearing view).
