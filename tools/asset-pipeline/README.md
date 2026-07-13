# war-room v3 asset pipeline (WS-B)

Generated-first art lane for the Living Studio iso office
(KICKOFF-v3.1 workstream B). Headless Blender renders parametric office
props as TRUE 2:1 dimetric sprites; `pack.py` trims, downscales and
packs them into a spritesheet + manifest that `webview-v3` consumes.

## One command

```sh
cd tools/asset-pipeline
make all          # render (Blender 4.2 headless, ~10 min CPU) + pack + stage
```

Outputs land in `webview-v3-assets/`:

- `props.structure.sheet.png` — floors + walls atlas (1x)
- `props.furniture.sheet.png` — furniture/prop atlas (1x)
- `props.manifest.json` — frame geometry for both sheets (schema below)
- `characters.staff_a.sheet.png` — teal + rust outfits × 4 animations
- `characters.staff_b.sheet.png` — slate + moss outfits × 4 animations
- `characters.pets.sheet.png` — cat sprites atlas
- `characters.manifest.json` — same schema, animated (frame arrays + fps)

Sheets are split into deterministic groups so each PNG stays under the
~1MB budget and regeneration diffs stay local to one sheet.

## Layout

| File                           | Role                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `blender/rig.py`               | scene setup: 2:1 dimetric ortho camera (X 60°, Z 45° — cos 60° = 0.5 gives the exact 2:1 diamond), warm-key three-point night-office light rig, Cycles + transparent film + alpha shadow catcher |
| `blender/props.py`             | 16 parametric prop builders (pure bpy primitives + bevel/solidify), shared warm palette                                                                                                          |
| `blender/render_props.py`      | `-b -P` entry: each prop at 4 rotations (N/E/S/W as the camera sees them) → alpha PNGs + `meta.json`                                                                                             |
| `blender/characters.py`        | parametric low-poly person (joint-empty direct posing, no armature — deterministic headless) in 4 palette outfits × 4 animations, plus the cat; rendered through the SAME rig                    |
| `blender/render_characters.py` | `-b -P` entry: each sprite pose-frame × 4 rotations → alpha PNGs + `meta.json` (frame LISTS + fps)                                                                                               |
| `pack.py`                      | union-trim across rotations (and animation frames), exact 2x→1x LANCZOS downscale, soft-shadow alpha quantization (~25% smaller PNGs, invisible), shelf-pack, manifest + validation gate         |

## Contract

- 1 blender unit = 1 floor tile. Tile diamond = **128×64 px at 1x**
  (`tilePx` in the manifest). Renders happen at 2x and are downscaled.
- Props are authored facing **S** (screen lower-left); rotation labels
  are the compass direction the front faces as the camera sees them
  (N upper-right, E lower-right, S lower-left, W upper-left).
- Walls are authored hugging the tile's **north edge**; rotate to place
  them on other edges. Floor tiles sit _below_ z=0 so props rest flush.
- The lighting rig is world-fixed and only the warm key casts shadows —
  every sprite is lit from screen-left and carries a tight baked
  contact shadow in its alpha.

## Manifest schema (agreed in KICKOFF-v3.1)

```jsonc
{
  "version": 1,
  "sheets": ["props.furniture.sheet.png", "props.structure.sheet.png"],
  "sheetSizes": [[w, h], [w, h]],
  "tilePx": 128,
  "renderScale": 2,
  "sprites": [{
    "name": "desk_monitor",
    "size": [w, h],              // frame size, uniform across rotations
    "anchor": [x, y],            // tile-floor contact point, frame-relative
    "rotations": ["N","E","S","W"],
    "footprint": [1, 1],         // tiles occupied (depth-sort input)
    "sheet": 0,                  // index into top-level "sheets"
    "frames": {                  // per rotation
      "S": { "x": 0, "y": 0, "anchor": [x, y] }   // anchor in SHEET px
    },
    "attach": {                  // optional, frame-relative quads
      "screen": { "S": [[x,y],[x,y],[x,y],[x,y]] } // TL,TR,BR,BL — the
    }                            // monitor face the DOM tail overlay
  }]                             // anchors onto
}
```

Drawing rule for WS-A: to place a sprite so its prop stands on tile T,
draw the frame at `screenOf(T) - anchor`.

### Animated sprites (characters.manifest.json)

Same schema, two additions:

- `frames.<ROT>` is an **array** of `{x, y, anchor}` in animation order
  (static prop sprites keep the single object — distinguish by
  `Array.isArray`).
- `fps` (absent/0 = static): walk 8, sit-typing 2, cat walk 3.

Union-trim spans all rotations AND animation frames of a sprite, so
`size`/`anchor` are uniform across the whole animation — cycling frames
never jitters against the tile. The character set:

| Sprite                    | Frames | What it is                                                                           |
| ------------------------- | ------ | ------------------------------------------------------------------------------------ |
| `worker_<outfit>.walk`    | 4      | walk cycle (contact / pass / contact / pass, with bob)                               |
| `worker_<outfit>.sit`     | 1      | seated — pelvis at chair-seat height 0.40; WS-A draws the chair, then the person     |
| `worker_<outfit>.type`    | 2      | seated typing, alternating forearms; hands land at desk height 0.72 one tile forward |
| `worker_<outfit>.blocked` | 1      | standing, head down, right hand raised                                               |
| `cat.curl`                | 1      | curled sleeping cat                                                                  |
| `cat.walk`                | 2      | cat walk, diagonal leg pairs                                                         |

Outfits (shirt / skin / hair silhouette): `worker_teal` (blob),
`worker_rust` (bun), `worker_slate` (terracotta cap), `worker_moss`
(buzz). Characters are authored facing **S** like the props; a worker
"sits at" a desk by using the rotation that faces the desk tile.

### C2 diversity pass — 12 more identities

v5 KICKOFF §C2 ("kill the balding-men monoculture"): `characters.py`
gained a `BUILDS` proportional-scale dict (slim / broad / short / tall,
plus the original 4 outfits' implicit "regular") and 3 more hair
silhouettes (`bald`, `long` — ponytail, `curly` — icosphere cluster) on
top of the existing blob/bun/cap/buzz. `BUILDS["regular"]` is scale
1.0/1.0 so the original 4 outfits render pixel-identical to pre-C2
output — this pass is additive, never a rig change. Every (hair style,
build) pair among the 12 new identities is unique by construction, so
no two collide in grayscale silhouette (`qa_grayscale_distinctness.py`
enforces this — see below).

| Variant           | Build | Hair            | Skin        |
| ----------------- | ----- | --------------- | ----------- |
| `worker_amber`    | broad | bald            | deep        |
| `worker_coral`    | slim  | long (ponytail) | light       |
| `worker_indigo`   | tall  | curly           | medium-tan  |
| `worker_sage`     | short | short           | deep-warm   |
| `worker_plum`     | broad | buzz            | tan         |
| `worker_ochre`    | slim  | bun             | medium-deep |
| `worker_charcoal` | tall  | bald            | deep        |
| `worker_rose`     | short | curly           | light       |
| `worker_navy`     | slim  | short           | medium-tan  |
| `worker_clay`     | tall  | buzz            | medium-deep |
| `worker_mint`     | short | bald            | tan         |
| `worker_violet`   | broad | long (ponytail) | light       |

Packed into 6 new sheet groups (`characters.staff_c.sheet.png` through
`staff_h`, 2 outfits each — same ~700KB/pair budget as the original
`staff_a`/`staff_b`). `webview-v3/src/engine/world.ts`'s `WORKER_OUTFITS`
lists all 16 suffixes so agents/dispatch-visitors actually draw the new
variants once this lands.

## Iterating on look

```sh
make preview PROP=sofa                        # 4 fast renders into out/preview/
open out/preview/sofa__S.png
make preview-chars SPRITE=worker_teal.walk    # 16 fast renders into out/preview-chars/
```

Tune palette hexes in `props.py` (`PALETTE`) and the light rig in
`rig.py` (`build_scene`), then re-run. `pack.py` fails loudly (exit 1)
on schema violations, empty frames, frame overlap, or a sheet over
~1MB — never ship on a red gate.

## Stage 3 — codex `$imagegen` lane

Rectangular-only art (no alpha on this lane — anything needing
transparency is Blender's job): `imagegen/`.

```sh
cd tools/asset-pipeline/imagegen
./gen.sh portrait_01                  # one asset
./gen.sh --category portraits         # every asset in a category
./gen.sh --missing                    # every asset with no raw PNG yet
python3 pack_imagegen.py              # stage + manifest + budget gate
```

| File                        | Role                                                                                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `imagegen/spec.json`        | locked style block + one prompt per asset (name, category, genSize, finalSize, purpose, prompt)                                                                                                                                                                                      |
| `imagegen/gen.sh`           | one `codex exec --skip-git-repo-check -s workspace-write` call per asset; `$imagegen` reaches codex literally via a python-built, single-quote-safe prompt (never re-expanded by the shell) — verified invocation pattern, Diablito 2026-07-06. Raw PNGs land in `out/imagegen-raw/` |
| `imagegen/pack_imagegen.py` | stages raw PNGs into `webview-v3-assets/imagegen/<category>/`, downscales portraits to `finalSize`, writes `manifest.json` (schema: `{name, path, size, purpose}` — no anchor/rotation/frames, these aren't sprites)                                                                 |

Budget gate + fallback chain (same ~1.1MB philosophy as `pack.py`,
hard-fails rather than shipping an oversized PNG): RGB save → if over
budget, 256-color quantize → if still over (vintage-poster paper-grain
noise resists deflate even at 256 colors), median-filter denoise +
256-color requantize → denoise + 128-color requantize. All three
posters that tripped the gate (`poster_stop_all`, `poster_ship_it`,
`poster_help_chart`) cleared it at the denoise step with **zero**
visible loss to text legibility (verified by re-reading the staged
PNGs, not just checking file size).

22 assets shipped, 22/22 on the first codex generation (0 regenerations
needed): 12 dossier portraits (`portrait_01` doubles as the style
anchor — its look is locked into `spec.json`'s `styleBlock` and reused
verbatim in every other prompt for consistency), 6 wall posters/signage
(gpt-image typography — STOP ALL, SHIP IT, WING A/B placards, HELP
vocabulary chart, WAR ROOM logo board), 4 seamless-ish textures (wood
floor, carpet, brick, corkboard).

## Stage 4 — QA harness

Zero-dependency HTML viewer + two Node scripts, scoped entirely to this
directory (its own `package.json`, not part of the root workspaces
array — WS-B must not touch anything outside `tools/asset-pipeline/`
and `webview-v3-assets/`).

```sh
cd tools/asset-pipeline
npm install              # once — installs playwright (JS driver only;
                          # reuses the machine's existing cached Chromium
                          # build under ~/Library/Caches/ms-playwright,
                          # no browser re-download if versions align)
npm run validate          # schema-validate every staged manifest
npm run screenshot         # DPR-1 + DPR-3 captures of viewer.html
python3 qa_grayscale_distinctness.py   # C2: silhouette-overlap gate across worker_* variants
python3 make_preview_grid.py           # C2: S-facing sit+walk grid PNG -> preview/c2-variants.png
# or, via make:
make qa                    # validate + screenshots
```

| File                    | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `viewer.html`           | Zero-dependency (no build step, no CDN) HTML+canvas harness. Fetches all 3 manifests + all 5 spritesheets + 22 imagegen PNGs straight from `../../webview-v3-assets/` and re-implements the documented drawing rule `screenOf(tile) − anchor` independently of any game engine code, so it validates the manifest contract itself rather than trusting a consumer. Renders: **(A)** every prop × rotation on its own diamond-guide tile (the anchor dot must land on the prop's visual base), **(B)** a bonus composite room built from every prop + every character outfit + both cats via painter's-algorithm depth sort (catches cross-sprite scale/z issues isolated per-prop tiles can't), **(C)** every character animation actually cycling frames at its manifest `fps`, **(D)** the imagegen assets in a captioned grid. Self-reports pass/fail via `window.__viewerDone` / `window.__viewerFailCount` (text-labelled PASS/FAIL, never color-only, per the vault's colorblind-safe rule) so headless capture can assert on it. |
| `validate-manifest.mjs` | Independent Node (zero deps) schema gate — the consumer-side counterpart to `pack.py`'s Python/Pillow validation gate. Checks `version`/`sheets`/`sheetSizes`/`tilePx`/`renderScale`/`sprites[]` shape, that declared `sheetSizes` matches the actual PNG's IHDR dimensions (catches a stale sheet next to a regenerated manifest, or vice versa), anchor-inside-frame, `rotations`/`frames` key parity, per-frame rect-inside-sheet + a full pairwise overlap check, and that each frame's absolute `anchor` equals `frame origin + relative anchor`. Also validates `imagegen/manifest.json`'s flat schema + per-file budget. Run via `npm run validate` / `make validate`.                                                                                                                                                                                                                                                                                                                                                           |
| `screenshot-viewer.mjs` | Serves the repo root over plain HTTP (so `viewer.html`'s relative `fetch()`/`Image` src resolve — `fetch` on `file://` is CORS-blocked in Chromium), loads it in Playwright Chromium at `deviceScaleFactor` 1 and 3, asserts zero console/page errors and `__viewerFailCount === 0`, then saves full-page PNGs to `.planning/v3/screenshots/assets/viewer-dpr{1,3}.png`. Canvases size their backing store to `window.devicePixelRatio` explicitly (not just CSS pixels), so the DPR-3 capture is genuinely higher-fidelity, not a blurry upscale of the DPR-1 raster — verified by diffing a native-resolution crop of the same on-screen region at both DPRs.                                                                                                                                                                                                                                                                                                                                                                         |

Result as of the Stage 4 run: **0 manifest schema failures, 0 viewer
QA failures, 0 console errors at either DPR** — the alignment/anchor
math has been correct since Stage 1/2 pack.py output; Stage 4 found no
defects to fix.
