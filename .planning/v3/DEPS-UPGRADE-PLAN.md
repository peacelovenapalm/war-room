# Dependency Upgrade Work Plan — 2026-07-10

Source: 4-agent parallel audit (Sonnet lanes: server-prod / asyncapi / frontend /
tooling), read-only, on war-room/v3 @ 95982ff. Full agent reports live in the
session transcript; this doc is the consolidated, deduplicated plan.

Ground truth at audit time: `npm audit --omit=dev` = 2 vulns (1 moderate,
1 high) — matches the deploy log exactly. Full audit (incl. dev) = 46
(8 critical, 19 high), almost all dev-tooling or transitive.

---

## Batch 1 — SECURITY (SAFE-NOW, one pass, highest value)

Every item is a same-major minor/patch bump. Clears **all 4 actionable CVEs**.

| Package            | From → To       | Where                   | Closes                                                                                                        |
| ------------------ | --------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| fastify            | 5.8.5 → 5.10.0  | root + server           | fast-uri HIGH (GHSA-q3j6 path traversal + host confusion) via fast-json-stringify@7 → fast-uri@4              |
| @fastify/static    | 9.1.1 → 9.3.0   | root + server           | brace-expansion MODERATE (DoS) via fresh glob chain                                                           |
| @fastify/cors      | 11.2.0 → 11.3.0 | root + server           | hygiene                                                                                                       |
| @fastify/websocket | 11.2.0 → 11.3.0 | root + server           | hygiene                                                                                                       |
| vitest             | 3.2.4 → 3.2.7   | all workspaces          | **CRITICAL** GHSA-5xrq-8626-4rwp (arbitrary file read/exec via Vitest UI server)                              |
| vite               | 8.0.14 → 8.1.4  | webview-ui + webview-v3 | HIGH server.fs.deny bypass (Windows) + launch-editor NTLMv2; coupled to the vitest bump (vitest vendors vite) |

**Gate (all must pass, in order):** `npm run check-types` → `npm run lint` →
server 767 → webview-ui 293 → webview-v3 291 → poller 97 → e2e v3 (10) →
`npm run build` → `npm audit --omit=dev` shows 0 → redeploy runbook →
`/api/version` + `/v3/` smoke on NEXUS.

Note on the frozen webview-ui surface: vitest/vite are dev-only — the shipped
frozen bundle is untouched by this batch. Accepted rationale: CVE exposure is
dev/CI-side, zero runtime delta.

## Batch 2 — HYGIENE (SAFE-NOW/MINOR-RISK, separate pass)

- react + react-dom → 19.2.7 (lockstep, both workspaces)
- tailwindcss + @tailwindcss/vite → 4.3.2 (webview-ui)
- prettier → 3.9.5, tsx → 4.23.0, esbuild → 0.28.1, typescript-eslint → 8.63.0
- **ESLint drift reconciliation** (real finding): root is already on eslint 10.2 +
  simple-import-sort 13; webview-ui/v3 lag on 9.39 + 12.1. Bring the two
  webviews up to 10.x/13.x to match root (root already proves the config works;
  flat config everywhere so migration mechanics are small). Gate: `npm run lint`.
- eslint-plugin-react-hooks → 7.1.1, react-refresh → 0.5.3, @asyncapi/cli 6.0.0 → 6.0.2
- `npm update` lockfile refresh to sweep remaining in-range transitives

**Gate:** lint + full suites + build. No deploy needed (nothing prod-shipped
changes except lockfile transitives — still redeploy at next natural deploy).

## Batch 3 — MAJOR-PLAN (deferred; each is its own gated pass)

| Item                                                          | Why deferred                                                                                                  | Trigger to schedule                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **node 22 → 24** (Dockerfile base, fnm, `engines`, npm ≥11.5) | Only real fix for asyncapi EBADENGINE warnings; needs an engines sweep across vitest/esbuild/playwright first | When the warnings start costing something, or bundled with the next infra pass |
| vitest 3 → 4                                                  | Major; CVE already handled by 3.2.7 in Batch 1                                                                | Next testing-infra pass                                                        |
| lint-staged 16 → 17                                           | It IS the commit gatekeeper — needs a live pre-commit test                                                    | Bundle with node 24 pass                                                       |
| playwright 1.59 → 1.61                                        | Minor but ships new browser binaries; screenshot baselines may drift                                          | Bundle with a visual-baseline review                                           |
| @vscode/test-electron 2 → 3                                   | Extension-host harness only                                                                                   | Whenever the VS Code adapter gets attention                                    |
| eslint 10.7 majors for plugins                                | Cosmetic                                                                                                      | With Batch 2's drift fix or later                                              |

## Parked / No action

- **TypeScript 5.9 → 7.0: PARKED.** TS 7 is the native compiler rewrite — a
  dedicated migration project, not a dep bump. 5.9.3 is current-latest of 5.x.
- **AsyncAPI deprecation spam (glob/rimraf/q/npmlog/mkdirp chains): ACCEPTED.**
  Verified root cause: @asyncapi/cli deliberately ships a `generator-v2`
  legacy-compat alias (still present in latest 6.0.2) — unfixable from our
  side, devDependencies-only, already excluded from the prod Docker image.
  Codegen verified byte-identical on node 22 despite EBADENGINE (exercised,
  not assumed).
- pixi.js 8.19, vite-plugin-pwa 1.3, husky 9.1.7, npm-run-all: already latest.
- undici / @babel/core / jsdom transitives: resolve automatically with the
  vitest chain; no direct dep to bump.
