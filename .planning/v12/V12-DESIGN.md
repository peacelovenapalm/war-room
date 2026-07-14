# V12 DESIGN — remote-first hardening (Tbilisi-proof, rung 1)

Drafted 2026-07-13. Act III opener per `HORIZON-v20.md` §Act III: "the
spine works from a café in Georgia exactly as from the desk — and the
product seams quietly stay ready." Auth work here doubles as a product
seam (both doors stay open, per the register's end-state answer).

## Invariants this version must not violate

Inherited from `CLAUDE.md` house rules and `HORIZON-v20.md` §Invariants:
honest data (⊘ over pretty lies, including auth/connectivity states);
capability is local (wire carries intent, machines hold allowlists —
identity work must not centralize trust); colorblind-safe (shape+word,
never color alone, including on any new "offline"/"stale"/"revoked"
indicator); Greg gates the irreversible (revocation and identity issuance
are exactly this kind of action).

## Current state (evidence, verify live before build)

- **Security boundary today**: tailnet-only network isolation
  (`tailscale serve --bg`, funnel explicitly OFF —
  `.planning/runbooks/nexus-war-room-deploy.sh:239-246`) plus a single
  shared Bearer token compared with `crypto.timingSafeEqual`
  (`server/src/httpServer.ts:2416-2426`), applied as `preHandler` on
  hook/runner routes. The WebSocket route only enforces Bearer auth in
  embedded (VS Code) mode; standalone mode skips it because it binds
  127.0.0.1 (`server/src/httpServer.ts:2118-2131`).
- **No per-device concept exists.** One token, one trust level, shared
  across every client that has it. `GET /api/districts` and
  `/api/briefing` are unauthenticated entirely, relying solely on
  tailnet isolation (`server/src/districtsProvider.ts:35-37`).
- **Beta evidence (`BETA-SYNTHESIS-2026-07-13.md`)**: the board is a
  "strong, polished, unusually honest desktop product" but "not yet
  reliable as a phone-first incident surface" (both testers,
  independently, with measured DOM evidence). M1 (triage rows painted
  under the floor feed on 390×844) and M2 (tall modals hidden under the
  fixed HUD, no Esc on phones) were the concrete blockers-to-mobile-trust.
  These two were fixed in `lane/beta-fixes` (merged as deploy #5,
  `.planning/v8/SPRINT-STATE.md`) — **v12 is where phone-first becomes a
  design GOAL**, not another patch lane. The mobile layout is now sound;
  v12's job is making it trustworthy over a bad connection and a
  provisioned-but-not-fully-trusted device.
- **No offline/PWA posture exists.** The webview is a live-connection
  React app over WebSocket with reconnect/backoff
  (`webview-ui/src/transport/webSocketTransport.ts`, per CLAUDE.md
  §Transport Abstraction) — there is no service worker, no offline
  shell, no queued-action-while-disconnected UX beyond the transport's
  own send-queue-while-disconnected.

## Preconditions (checkable, HALT if unmet)

1. **Act II exit question answered** (see `KICKOFF-ACT3.md`) — V10 rung
   has fired and been reviewed at least once; V8 tally has ≥5 real
   trials. Verify: `/api/memory/tally` and self-heal receipt count, live.
2. **Beta mobile fixes are live and holding** — verify `/api/version`
   matches a SHA at or after `14c1840` (deploy #5) and re-run the M1/M2
   mobile scenarios manually (or via a headed-Chrome check) before
   building further mobile hardening on top of them.
3. **A real Tbilisi (or equivalent high-latency/lossy) network sample
   exists** — v12 optimizes for a measured condition, not a guess. If no
   real sample exists yet, the first deliverable is capturing one
   (throttled-network DevTools profile is an honest ⊘ SIMULATED
   substitute, labeled as such, not a silent stand-in).

## D1 — Per-device identity

- Replace the single shared `WAR_ROOM_TOKEN` model with per-device
  tokens: each device (MacBook, phone, iPad, ...) gets its own issued
  credential, distinguishable in logs and receipts. Issuance is a
  Greg-gated action (no self-service registration).
- Token storage stays server-side only; the mechanism for
  `timingSafeEqual` comparison generalizes to "compare against the set
  of live tokens," not a single constant.
- Every authenticated action's receipt carries which device acted —
  this is an extension of the existing `machine` field pattern already
  used for MACBOOK/NEXUS/MINI tagging (`server/src/types.ts:45`,
  `dispatchStore.ts`), not a new concept, applied one layer earlier (at
  auth time instead of just at dispatch-record time).

## D2 — Revocation

- A revoked device's token stops authenticating on the NEXT request,
  not eventually — no cache with a stale-trust window.
- Revocation is itself a receipted, Greg-gated action, visible on the
  board (which devices are trusted, when each was last seen, one-tap
  revoke) — this is a new admin surface, small and boring by design.
- ⊘ Explicit non-goal: this is not a full IdP. No SSO, no OAuth
  provider, no per-user (as opposed to per-device) model — Greg is the
  only principal; devices are the unit of trust.

## D3 — Offline-tolerant PWA shell

- Add a minimal service worker: cache the app shell (webview static
  assets) so the UI itself loads instantly on a bad connection even
  when the WebSocket can't yet reach the server. Data still comes live
  over WS — this is shell-caching, not offline data sync.
- Explicit degraded-UI state when disconnected: the existing
  `TransportState` (`connecting` / `reconnecting` / `disconnected`,
  `core/src/transport.ts`) already models this — v12's job is making
  every disconnected state VISIBLE (persistent banner, shape+word, not
  just a silently-stale board), extending the same signaling fix the
  beta-fix lane already applied to STOP-ALL (M3) to the transport layer
  generally.
- Offline actions PARK as clearable drafts, never auto-fire on
  reconnect — register-locked (`HORIZON-v20.md` Q41).

## D4 — Latency-tolerant tails

- Remote-tail demand (`server/src/remoteTailDemand.ts`) currently
  assumes a responsive round trip; audit its timeout/retry constants
  against a real high-latency sample (D-precondition-3) and widen them
  where the current values would falsely read as "stale" or "dead" on a
  merely-slow connection. This is a constants/tuning deliverable, not a
  protocol rewrite.
- Any tail that degrades due to latency must say so honestly (⊘ or ◷
  with a word — "slow" is not the same fact as "gone").

## D5 — Morning push on poor mobile networks

- The morning push (Bark-based per `HORIZON-v20.md` §Act I) must
  degrade gracefully when the phone's network is poor: the push itself
  is small (a notification), but the surface it opens must render a
  useful partial state even if full sync hasn't completed — reuse D3's
  degraded-UI signaling rather than inventing a second one.
- Falsifiable bet, carried from the register (Q40): "seconds-fine,
  minutes-not" is the latency bar. Measure actual time-to-useful-render
  on the real network sample from a cold PWA shell load.

## Open risks

- **R1 — Per-device identity could silently become a product feature
  disguised as a security fix**, drifting scope toward multi-tenant
  auth before there's a second tenant. Default resolution: D1/D2 stay
  strictly device-scoped (one principal, many devices), never
  user-scoped; any user-scoped model is explicitly OUT of v12 and
  deferred to whenever the product door actually opens (v15+ evidence).
- **R2 — Offline PWA shell could mask real disconnection as a
  false-fine state** (stale cached shell looks like a live board).
  Default resolution: the degraded-UI banner from D3 is mandatory and
  tested before D3 ships; a cached-but-disconnected shell must never be
  visually indistinguishable from a live one.
- **R3 — No real Tbilisi network sample may exist when this version is
  built** (Greg's move timing is independent of the build schedule).
  Default resolution: use throttled-DevTools as an explicitly-labeled
  ⊘ SIMULATED substitute per precondition 3; do not block the whole
  version on travel timing, but do not claim "field-tested" for
  simulated results either.

## Exit question

One week of real (or credibly simulated, labeled as such) high-latency
mobile use with zero silent degradation — every bad-connection moment
was visibly announced, not silently endured. Per-device revocation
tested at least once for real (a device actually revoked, actually
stopped working on the next request).

## Honest seams left

- Full multi-user auth (see R1) — explicitly deferred.
- True offline data mutation (not just shell caching) — v12 ships
  read-mostly offline tolerance; write-while-offline stays parked
  drafts only, per the register.
- Watch-face / lock-screen complications beyond the existing
  NEEDS-YOU count (`HORIZON-v20.md` Q6) — parked until the count itself
  proves out further.
