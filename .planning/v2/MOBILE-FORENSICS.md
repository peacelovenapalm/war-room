# Mobile Forensics — KICKOFF-v2.0 Phase 1.1

Investigation of the reported webview-ui (Pixi office) breakage on Greg's
real iPhone: (a) loads poorly, (b) wrong scale, (c) sprite/canvas assets
never render. Method: Playwright **WebKit** + iPhone device profiles
(closest available proxy to iOS Safari on a Mac), compared against desktop
WebKit and Chromium's iPhone emulation (the config that gave a **false
pass** during the original v1.1 "disappearing view" fix, commit `a44ede6`).

Repro: `npx playwright test --config .planning/v2/forensics/playwright.forensics.config.ts`
(builds nothing — uses the already-built `dist/`; run `npm run build` first
if stale). Probe source: `.planning/v2/forensics/mobile-forensics.spec.ts`.
Raw JSON + screenshots per project: `.planning/v2/forensics/screenshots/`.

## Finding 1 — "assets never render" / "wrong scale": ROOT CAUSE ISOLATED, VERIFIED

**Verified.** The office canvas paints **zero visible content** on any
narrow (~390px CSS) WebKit viewport at `deviceScaleFactor: 3` (iPhone
14 and 15 Pro profiles), while the _identical served build_ renders the
full office (floor, walls, furniture) correctly on desktop WebKit
(1280×800, DPR 1). This reproduces the bug in WebKit-on-Mac — no real
device needed.

Screenshots (DOM overlays hidden via a runtime `page.addStyleTag`, not a
source change, so only the canvas is visible):

- `screenshots/webkit-desktop-canvas-isolated.png` — office renders correctly.
- `screenshots/webkit-iphone14-canvas-isolated.png` — **entirely blank**.

**Verified — isolated the variable.** Ran the _same_ 390×664 CSS viewport
at `deviceScaleFactor: 1` vs `3` (`mobile-forensics.spec.ts`'s "DPR 1 vs
DPR 3" test, `screenshots/dpr{1,3}-narrow-viewport-canvas-isolated.png`):

- DPR 1 + narrow viewport → office renders correctly, properly scaled.
- DPR 3 + narrow viewport (same CSS size) → blank.

This rules out "narrow viewport" as the cause. **DPR is the variable that
flips the bug on.**

**Verified — not an asset-delivery, WebGL, or error problem.** On the
blank DPR-3 run: zero console errors/warnings, zero `pageerror` events,
zero failed network requests, WebGL2 context obtained successfully
(`unmaskedRenderer: "Apple GPU"`, `MAX_TEXTURE_SIZE: 16384`), Pixi
`Application.init()` completed exactly once (`pixiInitCount: 1`), and
**every** asset WS message arrived with a plausible byte size within 36ms
of connect (`characterSpritesLoaded` 451KB, `furnitureAssetsLoaded`
196KB, `wallTilesLoaded` 83KB, `petSpritesLoaded` 95KB,
`floorTilesLoaded` 23KB, `layoutLoaded` 12KB — full log in
`screenshots/webkit-iphone14.json`'s `wsProbeLog`). So "assets never
render" is misleading as a name: the _data_ arrives and Pixi _initializes_
fine; the _scene_ just isn't inside the visible frame. **Important
correction to the KICKOFF brief's framing**: assets are not fetched as
PNG files at runtime at all in production (`webview-ui/src/browserMock.ts`'s
PNG-decode/fetch path is dev-only, tree-shaken from the build per
`main.tsx:10-12`) — in standalone mode the server decodes PNGs once and
pushes pre-decoded `SpriteData` JSON over the WS on `webviewReady`
(`server/src/clientMessageHandler.ts`). Any theory involving PNG 404s/MIME
types on `/assets/*` does not apply to the deployed NEXUS build.

**Inferred, strong candidate mechanism (not fully closed).**
`webview-ui/src/office/toolUtils.ts:29`:

```js
defaultZoom() = max(ZOOM_MIN, round(ZOOM_DEFAULT_DPR_FACTOR * devicePixelRatio))
```

`ZOOM_DEFAULT_DPR_FACTOR = 2` (`constants.ts:106`). This computes the
camera's device-pixel zoom **purely from DPR**, with no reference to
canvas or viewport size. DPR 1 → zoom 2. DPR 3 → zoom **6** (3x larger).
`pixiRenderer.ts:1046-1047` then centers the map:

```
mapW = layout.cols * TILE_SIZE * zoom   // 21 * 16 * zoom
mapH = layout.rows * TILE_SIZE * zoom   // 22 * 16 * zoom (layout confirmed 21×22, default-layout-1.json)
offsetX = floor((canvasWidth - mapW) / 2) + round(panX)   // panX = 0 at first paint
```

At DPR 3 on an iPhone-14-size canvas (1170×1992 device px): `mapW =
2016`, `mapH = 2112` — the zoomed map is **larger than the canvas itself**
in both dimensions, and the resulting centering offset is strongly
negative. The DPR-1 desktop case (`mapW = 672`, canvas 1280 wide) has
generous margin and renders correctly. This direction is consistent with
every observation above (why DPR is the toggle, why it's independent of
CSS viewport width) but I did not instrument the live `offsetX/offsetY`
values at runtime (would require a source-touching console.log — out of
scope for this read-only investigation) — so the _exact_ reason the result
is **total** blankness rather than a cropped/zoomed partial view (my
hand math for the negative offset predicts a still-overlapping middle
slice should be visible) is not fully closed. Next verifier: add a
temporary `console.log({offsetX, offsetY, mapW, mapH, canvasWidth,
canvasHeight})` in `renderFrame` gated behind the E2E flag, rerun this
same probe, and read it off `page.on('console')`.

**Same root class as the "9x pixel cost" lead flagged in the kickoff.**
`pixiApp.ts:68`'s `resolution: window.devicePixelRatio` (from commit
`a44ede6`, 2026-07-09) and `toolUtils.ts:29`'s DPR-scaled zoom are two
_independent_ pieces of code both scaling directly off raw DPR with no
upper bound or viewport-awareness. Verified via a dedicated context-pair
comparison (`screenshots/dpr-comparison.json`): canvas device-pixel area
at DPR 3 is **9x** DPR 1's (1170×1992 vs 390×664), confirming the
resolution multiplier is real and compounds with the zoom-inflation bug
above.

## Finding 2 — "loads poorly/slowly": PARTIALLY REPRODUCED, real-device divergence risk flagged

**Verified, magnitude only.** Total payload before the office is fully
populated: JS bundle 925KB (`index-*.js`) + CSS 30KB + ~985KB of asset
JSON pushed over the WS in the burst above ≈ **1.9MB** before first
meaningful paint. On localhost this all lands in under 400ms
(`tMounted` 105-386ms across runs, `screenshots/*.json`).

**Inferred, not verified this session.** On a real phone over Tailscale
(`tailscale serve --https=8484`, confirmed via
`.planning/runbooks/nexus-war-room-deploy.sh:147-158` — a native
Tailscale-managed HTTPS listener, NOT Caddy/nginx, so WS-upgrade-eating
reverse-proxy misconfiguration is unlikely), actual latency/bandwidth is
unknown — Playwright's network throttling can't simulate WS frame delay
(Playwright's `page.route` doesn't intercept WebSocket traffic in any
browser, same reason the workbox NetworkOnly comment in
`webview-ui/vite.config.ts:146-150` gives for `/ws`). ~1.9MB over
real-world Tailscale-over-cellular could plausibly take several seconds
and "feel" broken even though nothing is actually erroring — this is
architecture-level (eager, all-at-once asset push on connect) rather
than a specific bug. **Could not reproduce or refute the "slow" complaint
directly in WebKit-on-Mac** — flagging as real-device divergence risk.

**Inferred risk, not investigated further.** `vite-plugin-pwa`'s
`registerType: 'autoUpdate'` (`vite.config.ts:120`) means a previously
cached broken build can persist on a returning visit until the SW's
background update completes and the client re-navigates — if Greg tested
right after a deploy without a hard refresh, a stale service worker could
independently produce "looks broken" symptoms unrelated to the DPR bug
above. Worth a deliberate SW-update-flow decision in V3, not investigated
here.

## WebGL / context findings — RULED OUT as a cause

**Verified**, consistent across all 4 project runs: Pixi negotiates
`webgl2` successfully every time (never falls back to `webgl1`), with
`MAX_TEXTURE_SIZE: 16384` (WebKit/Apple GPU) vs `8192` (Chromium/ANGLE-
SwiftShader) — both far above any texture this app produces (largest
rasterized texture is a per-sprite offscreen canvas at native pixel
size, e.g. 16×16 to ~96×96; see `manifestToPixiSpritesheet.ts`'s
`rasterize()`). `antialias: false` from `pixiApp.ts` is honored. No
context-creation errors, no fallback-path warnings. **Inferred**: real
iPhone GPUs (A15/A16 Bionic) support at minimum 8192, typically 16384 on
recent models — this constraint is very unlikely to be the real-device
gap; note as an assumption, not verified against actual iOS Safari.

## Constraints for the V3 design

1. **Never derive camera zoom or any layout-affecting value from raw
   `devicePixelRatio` alone.** `resolution` (device-pixel _density_, a
   GPU-side sampling concern) and `zoom` (camera framing, a _layout_
   concern) must not share the same DPR-scaling formula — this run found
   two independent instances of exactly that conflation. Compute default
   zoom from **canvas/viewport size vs. map size** (fit-to-view math),
   never from DPR directly.
2. **Cap `resolution` at 2**, not raw DPR. The 9x device-pixel area at
   DPR 3 (verified, `dpr-comparison.json`) is real GPU fill-rate cost on
   top of the framing bug — even after the zoom-inflation is fixed,
   uncapped DPR-3 resolution is unnecessary spend on a phone GPU weaker
   than the dev Mac's. WebGL2/Canvas both remain viable (context
   negotiation itself is not the problem) — this is a budget, not an
   engine choice.
3. **Don't eagerly push the entire sprite/asset catalog (~1MB) on WS
   connect before first paint.** Fine on localhost; unverified but risky
   over real mobile networks. V3 should send only what's needed for the
   current view, or paint an immediate placeholder/skeleton before assets
   land — the current architecture has no "still loading" visual state
   distinguishable from "broken" (both look like a blank canvas).
4. **Add a canvas-content self-check to CI-visible e2e**, at a real
   mobile _viewport size_ (not just Chromium's iPhone-emulation preset —
   that gave the false pass last time) — e.g., the DPR-1-vs-DPR-3-at-
   same-viewport comparison this probe ran ad hoc should become a
   permanent regression test once the fix lands, asserting non-blank
   canvas content specifically at `deviceScaleFactor: 3`.
5. **Decide the SW update strategy deliberately** (immediate
   `skipWaiting`/`clientsClaim` vs. prompt-to-reload) rather than
   inheriting `autoUpdate`'s default — unverified as a contributor here,
   but a known PWA footgun class worth closing off explicitly.
6. Real-device acceptance (Phase 4) must include a **real iPhone**
   regardless of what WebKit-on-Mac shows clean — this session closed the
   scale/render gap but explicitly could not verify perceived load speed
   or actual iOS Safari version quirks (Playwright's bundled WebKit is
   26.4; Greg's phone's Safari version is unknown/unverified).
