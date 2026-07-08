# Section 07 — Art Direction & Asset Pipeline

## ASSUMES (reconcile with other sections)

- **ASSUMES engine section** picks PixiJS as the renderer (per Greg's lock).
  This section's assets are plain PNG spritesheets + JSON metadata — engine-
  agnostic. If the engine section instead names Phaser, nothing here changes:
  both consume PNG atlases the same way. Only the atlas-packing step (§5)
  targets Pixi's `Spritesheet` loader format specifically; Phaser's atlas
  JSON is a near-identical schema swap.
- **ASSUMES building/room section** defines the room list (dev pit, server
  room, break room, war room + any v1.0 additions). This section inventories
  tiles/furniture generically per room-type slot; if the room list differs,
  §4's furniture table needs a row-count adjustment, not a structural change.
- **ASSUMES employee/colony-sim section** defines the trait taxonomy (fast,
  sloppy, night-owl, etc.). This section assumes traits map to **palette
  variants**, not new geometry — i.e., a "sloppy" employee is the same
  sprite sheet with a mood-overlay icon (see §4.4), not a unique skeleton.
  If traits are meant to visually diverge in body shape, that's a scope
  increase this section doesn't currently budget for.
- **ASSUMES economy section** defines Cash costs for cosmetic unlocks
  (decor, employee outfits). This section does not price anything — it
  only inventories what assets exist to be unlocked.

---

## 0. Ground truth as of 2026-07-08 (verified this session)

Read directly from `/Users/greg/code/war-room` (branch `war-room/v1`):

- **Tile grid: 16×16px.** `FLOOR_TILE_SIZE = 16` (`core/src/assets/constants.ts`).
- **Character frames: 16×32px**, `CHAR_FRAME_W=16`, `CHAR_FRAME_H=32`.
  Sheet layout: `char_N.png` is **112×96px** = 7 frames/row (`CHAR_FRAMES_PER_ROW=7`)
  × 3 direction rows (`CHARACTER_DIRECTIONS = ['down','up','right']`, left
  is a runtime horizontal flip, not a stored frame). `CHAR_COUNT = 6`
  palette variants ship today (`char_0.png`…`char_5.png`).
  Decoder: `core/src/assets/pngDecoder.ts::decodeCharacterPng`.
  Consumer: `webview-ui/src/office/sprites/spriteData.ts` — resolves into
  `CharacterSprites { walk: 4-frame per dir, typing: 2-frame, reading: 2-frame }`.
- **Furniture: manifest-driven, per-folder.** `webview-ui/public/assets/furniture/<ID>/manifest.json`
  - sibling PNGs. Manifest tree types: `asset` (leaf) and `group`
    (`rotation | state | animation`). Standard leaf size **16×32** (2-tile-tall
    props like PC/DESK) or **16×16** (1-tile props like CACTUS/BIN). Loader:
    `server/src/assetLoader.ts::loadFurnitureAssets` walks folders, flattens
    via `core/src/assets/manifestUtils.ts::flattenManifest`, decodes PNG→
    `SpriteData` (`string[][]` of hex colors) via `pngToSpriteData`.
- **Floor tiles:** `assets/floors/floor_N.png`, each exactly 16×16, decoded
  by `decodeFloorPng`.
- **Walls:** `assets/walls/wall_N.png`, each a 64×128 grid = 16 bitmask
  pieces (N/E/S/W wall-junction autotile), `WALL_PIECE_WIDTH=16,
WALL_PIECE_HEIGHT=32`, parsed by `parseWallPng`.
- **Pets:** `assets/pets/<id>/{manifest.json,pet.png}`, 96×96 sheet,
  `PET_FRAME_W_SMALL=16 / PET_FRAME_W_LARGE=32`, `PET_FRAME_H=32`, walk
  3 frames × idle 3 frames, cap 512KB/pet PNG (`MAX_PET_PNG_SIZE`).
- **Recolor system, not per-employee unique art.** `office/colorize.ts`
  ships two modes: `colorizeSprite` (grayscale template → fixed HSL, used
  for floors) and `adjustSprite` (HSL shift on original pixels, used for
  furniture + the 6 base character templates → N visual variants via hue
  shift, see `hueShiftSprites` in `spriteData.ts`). **This is the existing
  mechanism v2 must keep extending** — don't hand-paint one sprite per
  employee; hue-shift + accessory-overlay a small template set.
- **Colorblind pattern already established and must be repeated exactly:**
  `office/sprites/crisisSprites.ts` — every escalation stage (SMOKE, FIRE,
  ALARM, DEBRIS, STEAM) is a **distinct silhouette**, comment states
  explicitly "a grayscale screenshot must stay readable by shape alone,"
  colors are "reinforcement only." New v2 states (mood, weather, room
  status) must follow this exact discipline — new shape first, color second.
- **Test coverage exists for the loader chain**: `webview-ui/test/dev-assets.test.ts`
  (grep target when adding new asset types — extend this file, don't
  create a parallel test path).

### The Diablito asset-gen system (located, per FOCUS)

Found at `/Users/greg/code/Diablito`:

- **Skill doc:** `.claude/skills/gpt-image-2/SKILL.md` — full recipe.
- **Model:** `openai/gpt-image-2` (ChatGPT Images 2.0) served via **Fal AI**,
  not OpenAI's own API. Two endpoints: text-to-image (`https://fal.run/openai/gpt-image-2`)
  and edit (`https://fal.run/openai/gpt-image-2/edit`, takes `image_urls` +
  optional `mask_url`). Sync HTTP, no polling. Auth: `Authorization: Key
$FAL_KEY` (not `Bearer`).
- **Actual production usage pattern** (from `uploads/gallery/_progress.md`,
  a real batch-generation log): **`codex exec` invoking gpt-image-2 with a
  canonical reference image attached, prompt piped via stdin**, output
  saved to `uploads/gallery/{style}/tile-NN-slug.png`, progress tracked as
  a markdown checklist with `[ ]/[~]/[x]/[!]` states, batched in waves of
  ~4-10 generations, each visually reviewed and accepted/regenerated before
  moving on. **This is the exact workflow to replicate for war-room sprite
  batches** — anchor image + stdin prompt + checklist tracking, not a bespoke
  script.
- **Cost:** token-based via Fal. Rough per-image at `landscape_4_3`
  (1536×1024): low ≈ $0.02, **medium ≈ $0.05 (default)**, high ≈ $0.18.
  Custom dimensions allowed (multiples of 16, 655K–8.3M total px, max edge
  3840, aspect ≤3:1) — this matters because sprite sheets are small and
  odd-shaped; see §5 for the actual generation-size strategy (generate
  large, downsample — not native-size generation).
- **No native transparency.** Fal's GPT Image 2 wrapper does not support
  `background: transparent` — output is flat RGB. "Transparent background"
  prompts produce a _fake_ checkerboard baked into pixels. **Required
  post-step:** chain `fal-ai/imageutils/rembg` (cheap/fast) as a second Fal
  call per generated sheet before any alpha-dependent pixel-art conversion.
- **Not built for native pixel art.** GPT Image 2 is optimized for
  typography/photoreal/painterly composition, not authentic low-res pixel
  grids. Community category slug `pixel-art` exists but is stylistic
  flavor, not literal N×N output. **Decision: do NOT ask it for "pixel
  art" directly.** Generate at high resolution in an _illustrated flat-
  color_ style, then mechanically downsample (§5.2) — this is what the
  existing house sprites already look like (flat-color, hard outline,
  limited palette; consistent with `SpriteData`'s hex-grid representation).

---

## 1. Art direction

### 1.1 Resolution & scale (extends existing house system, not replaced)

| Layer                    | Native/base unit                                          | v2 change                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Floor tile               | 16×16px                                                   | unchanged                                                                                                                                                                                                                                                                                                                                                                            |
| Wall piece               | 16×32px, 16-way autotile bitmask                          | unchanged                                                                                                                                                                                                                                                                                                                                                                            |
| Furniture (1-tile)       | 16×16px                                                   | unchanged                                                                                                                                                                                                                                                                                                                                                                            |
| Furniture (2-tile)       | 16×32px                                                   | unchanged                                                                                                                                                                                                                                                                                                                                                                            |
| Character frame          | 16×32px, 7 frames/row × 3 dir rows (112×96 sheet)         | unchanged grid; **new sheets add rows, not resize** (see §4.1)                                                                                                                                                                                                                                                                                                                       |
| Camera zoom              | Pixi stage scale, integer steps only (1x/2x/3x)           | new — engine-section owns the number, this section requires **nearest-neighbor / no bilinear filtering** at every zoom level so 16px pixel art stays crisp. Hard requirement for build agents: set `PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.NEAREST` (or the Pixi 8 equivalent, `scaleMode: 'nearest'` per texture) — a smoothed 16px sprite reads as a blurry smear at 3x zoom. |
| Weather/lighting overlay | Full-viewport, not tile-locked                            | new, see §4.5                                                                                                                                                                                                                                                                                                                                                                        |
| UI chrome                | Existing house `--` CSS custom properties (not pixel-art) | unchanged — HUD/panels stay vector/CSS, only the office canvas is pixel-art                                                                                                                                                                                                                                                                                                          |

### 1.2 Palette discipline (colorblind hard rule — non-negotiable)

Every new visual state added in v2 (mood, weather, season, room condition,
employee trait badge) follows the exact rule already coded into
`crisisSprites.ts`:

1. **Shape first.** A new state must change the _silhouette_ or add a
   distinct _icon glyph_, never rely on a hue swap alone.
2. **Grayscale test is a literal build-gate command**, not a suggestion —
   see §6.3 verification.
3. **Reinforcement-only color** for any red/green pairing. Existing
   danger/warning colors (`--color-danger` `#D1424A`, `--color-warning`
   `#FF8D14`) stay as-is; **never introduce a green "good" state that
   depends on being distinguished from red by hue alone** — pair every
   good/bad state with `✓`/`✗`/`⚠` glyphs per the vault's colorblind rule,
   exactly as `UnlocksPanel.tsx` already does.
4. **New base palette additions for v2** (mood/weather), chosen for
   grayscale-distinctness (verified by converting each swatch to luminance
   and checking pairwise ΔL ≥ 40/255 between any two states used
   simultaneously on screen):

| Token            | Hex                                        | Luminance (0-255)                                                                                          | Used for                           |
| ---------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `--mood-great`   | `#FFD75E` (existing Y from crisis palette) | 211                                                                                                        | happy/thriving glyph fill          |
| `--mood-neutral` | `#8F8F9C` (existing S)                     | 152                                                                                                        | neutral glyph fill                 |
| `--mood-bad`     | `#62626E` (existing d)                     | 98                                                                                                         | stressed/low glyph fill            |
| `--weather-rain` | `#5C7A99`                                  | 112                                                                                                        | rain overlay tint                  |
| `--weather-snow` | `#E8ECF2`                                  | 231                                                                                                        | snow overlay tint                  |
| `--weather-sun`  | `#FFD75E`                                  | 211 (reuse mood-great — shared "positive" grayscale band, differentiated by glyph: sun icon vs. face icon) |
| `--night-tint`   | `#1A1E33` @ 35% overlay alpha              | —                                                                                                          | day/night darkening multiply layer |

All four mood states additionally render a **fixed glyph**: 😀-style
outline / flat / frown-style outline / prone-Zzz icon — never color-only.
Reuse the existing `BUBBLE_*_SPRITE` 11×13/13×11 bubble-icon convention
(`spriteData.ts` lines 20-30) as the geometry template for these new
badges — same size class, same "distinct silhouette with tail pointer"
shape language, so they read consistently next to existing permission/
waiting bubbles.

---

## 2. Employee sprite sheets (walk / work / celebrate)

Extends the existing `char_N.png` 112×96, 7-frames×3-dir convention.
**Do not resize the frame or the sheet grid** — the runtime decoder
(`decodeCharacterPng`, `CHAR_FRAME_W/H`, `CHAR_FRAMES_PER_ROW`) is a hard
contract; changing it requires touching `core/src/assets/pngDecoder.ts`
and `constants.ts` plus every consumer, which is out of scope for an
asset-only pass. Instead, v2 **adds new sheets in the same grid** and new
animation-state metadata alongside the existing ones.

### 2.1 New sheet: `char_N_work.png` (per employee palette, N = 0..5, extendable)

- Grid: 112×96, same 7×3 layout as walk sheets, reusing frame slots:
  - Row `down`: frames 0-1 = existing "typing" (already exists per
    `CharacterSprites.typing`), frames 2-3 = existing "reading", frames
    4-6 = **new**: `desk-work` cycle (3-frame loop: lean-in, type-tap,
    lean-back) for the colony-sim "at desk, working" idle state.
  - Row `up`/`right`: same new 4-6 slots for symmetry (some rooms face
    other directions).
- This reuses the _existing_ 7-frame row budget — frames 0-3 already
  spoken for by typing/reading, frames 4-6 are currently unused headroom
  in the shipped sheets (verify: `char_0.png` is 112px = exactly 7×16,
  confirm frames 4-6 aren't already draw-mapped to something else before
  overwriting — grep `typing\[` and `reading\[` index usage in
  `spriteData.ts` first).

### 2.2 New sheet: `char_N_celebrate.png` — separate file, same grid contract

- 112×96, 3 direction rows, but only `down` row is populated (celebrate
  poses always face camera regardless of last-walked direction — matches
  how `crisisSprites.ts` STEAM/resolve states already ignore facing).
- 4-frame celebrate loop: arms-raise, jump-up, arms-raise (mirror), land.
- Trigger: shift-report "grade A" moment, streak milestone, contract
  completion — event names owned by the progression/economy section;
  this section only guarantees the sprite sheet exists and the frame
  count (4) for whatever trigger fires it.

### 2.3 Frame counts summary (single source of truth for build agents)

| Cycle                         | Frames | Directions                     | New or existing                                                                                                                                  |
| ----------------------------- | ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Walk                          | 4      | down/up/right (+left via flip) | existing                                                                                                                                         |
| Typing                        | 2      | down/up/right                  | existing                                                                                                                                         |
| Reading                       | 2      | down/up/right                  | existing                                                                                                                                         |
| Desk-work                     | 3      | down/up/right                  | **new**, packed into existing frame slots 4-6                                                                                                    |
| Celebrate                     | 4      | down only                      | **new sheet**, `char_N_celebrate.png`                                                                                                            |
| Break-room idle (coffee/chat) | 3      | down only                      | **new sheet**, `char_N_break.png`, 112×32 single-row (down only, no need for 3-row waste — decoder needs a **new** lightweight loader, see §2.4) |

### 2.4 New decoder function required (file-level task)

`core/src/assets/pngDecoder.ts` needs one new export:
`decodeSingleRowCharacterPng(buffer, frameCount)` — same 16×32 frame
slicing as `decodeCharacterPng` but for single-row sheets (break-room idle,
celebrate-if-scoped-down-later). Keep the existing 3-row decoder
untouched; add, don't modify, per the "extend don't rewrite" rule for a
tested, working decoder (`dev-assets.test.ts` already covers it — a
regression there blocks the whole asset pipeline).

---

## 3. Room tiles & furniture inventory for v1.0

Room list assumed from building section (dev pit, server room, break
room, war room — see ASSUMES). Per room, minimum v1.0 asset set, all
using the existing manifest-driven furniture pipeline (§0):

| Room        | New floor_N.png variants                                                                                                                | New furniture (manifest folders)                                                                                                                                                                                                           | Footprint convention   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| Dev Pit     | 1 (existing carpet/tile reused — confirm `floor_0..8` already covers "office carpet"; add only if a distinct dev-pit texture is wanted) | `MONITOR_DUAL` (16×32, rotation group like `PC`), `MECH_KEYBOARD` (16×16 decor-only)                                                                                                                                                       | 1×2 desks, standard    |
| Server Room | 1 new: `floor_serverroom.png` (16×16, cool-tint grid pattern — grayscale-distinct from office carpet, not just re-hued)                 | `SERVER_RACK` (16×32, `state` group: idle/busy — busy state uses a **blinking LED glyph animation**, 3-frame, not a color-only "busy" tint), `CABLE_TRAY` (16×16 decor)                                                                    | racks along walls, 1×2 |
| Break Room  | 1 new: `floor_breakroom.png` (warmer tone, distinct texture, not just hue)                                                              | `COFFEE_MACHINE` (already exists per STATE.md unlock list — reuse), `VENDING_MACHINE` (16×32), `LOUNGE_SOFA` (16×16, reuse `CUSHIONED_BENCH` pattern)                                                                                      |                        |
| War Room    | 1 new: `floor_warroom.png` (tactical-grid texture)                                                                                      | `BIG_MAP_TABLE` (32×32 — first 2×2-footprint prop; manifest `footprintW:2, footprintH:2`, confirm renderer's tile-occupancy logic supports >1×2 footprints before committing — check `office/layout/tileMap.ts` for footprint assumptions) | 2×2 centerpiece        |

### 3.1 Weather/lighting overlays (new asset category, no manifest needed — these are full-canvas, not tile props)

- **Day/night tint:** single semi-transparent PNG or programmatic multiply-
  blend (`--night-tint` token, §1.2) — cheaper as a Pixi `Graphics` rect
  with alpha animated over in-game clock time than as a generated asset.
  **Decision: implement as code, not a generated image.** No Diablito
  gen needed here.
- **Weather overlays (rain/snow):** generated as a small **tileable
  particle sprite** (rain streak 4×16px, snowflake 8×8px), animated via
  Pixi `ParticleContainer`, not full-frame overlays. These ARE good
  Diablito-gen candidates for the _texture_ of a single streak/flake at
  high res then downsampled (§5.2) — but the motion/tiling is code, not
  asset.
- **Seasonal decor variants** (e.g. holiday decorations, autumn leaves
  on the office window): treated as regular `furniture` manifest entries
  with a `category: "seasonal"` tag and a start/end date gate owned by
  the world/events section — this section only supplies the sprites.

---

## 4. UI chrome

Existing house UI (`webview-ui/src/components/*`, CSS custom properties)
is **not** pixel-art and v2 does not change that split — HUD panels,
modals, toolbars stay crisp vector/CSS (this is why `CallModal`,
`UnlocksPanel`, `ProgressionHUD` etc. all read cleanly at any zoom). New
v1.0 UI needs:

- **Employee roster card** — portrait (16×32 idle-down frame of that
  employee's sheet, scaled 3x with nearest-neighbor, framed in existing
  CSS card style) + trait icons (new 11×13 glyph set, same geometry class
  as bubble sprites) + mood badge (§1.2).
- **Room-buy/furniture-shop panel** — reuses existing `furnitureCatalog.ts`
  data shape; new furniture just needs a manifest, no new UI component.
- **Budget-headroom gauge** (dispatch/automation real-rate-limit display,
  per Greg's BUDGET GUARDRAIL) — this is a HUD meter, not pixel art;
  build as CSS/SVG bar with `✓`/`⚠`/`✗` zones (green-safe / caution /
  near-limit), text-labeled thresholds, no color-only signal. Out of this
  section's asset scope beyond stating the constraint — implementation
  belongs to whichever section owns dispatch/automation UI.

---

## 5. Generation → QA → import workflow (autonomous, for Sonnet build agents)

This is the operational core of this section — written so a build agent
can run it end-to-end with a single human review gate at the end of each
batch, mirroring the exact Diablito `_progress.md` pattern (§0).

### 5.1 Directory structure (new, under war-room repo)

```
war-room/
  assets-source/                      # NEW — gen inputs/outputs, gitignored raw
    prompts/
      employee-desk-work.json         # structured JSON prompt per Diablito convention
      employee-celebrate.json
      room-tiles-server.json
      ...
    canonical/
      char-template-ref.png           # existing char_0.png used as style anchor
      furniture-template-ref.png      # e.g. DESK_FRONT.png as style anchor
    raw-gen/
      <batch-name>/
        gen-001-desk-work-down.png    # full-res Fal output, pre-downsample
        ...
    _progress.md                      # checklist, [ ]/[~]/[x]/[!], one line per generation job
  webview-ui/public/assets/           # EXISTING — final import target, unchanged paths
```

### 5.2 Per-asset generation recipe

1. **Reference-anchor every batch.** Attach the existing shipped PNG
   (`char_0.png` frame crop, or a furniture PNG) as `image_urls` to the
   **edit** endpoint, OR — for genuinely new asset types with no existing
   equivalent (e.g. server rack) — use **text-to-image** with a structured
   JSON prompt (per SKILL.md "prompting tips": JSON keys `type, subject,
style, background, pose, palette`) that explicitly locks: flat-color
   cel-shaded illustration, hard 2px dark outline (`#10101C` — reuse the
   house crisis-palette outline color for consistency), limited palette
   (name the exact house hex tokens in the prompt), orthographic/isometric-
   lite game-asset framing, no gradients, no soft shadows, plain neutral
   background (for later background removal).
2. **Generate at 8x native resolution, `quality: "medium"`, `image_size:
{width: 1024, height: 1024}` (single frame) or a grid multiple for
   multi-frame sheets** (e.g. an 8-frame walk cycle at 8x = 128×256 native
   → generate at 1024×2048, must satisfy the ≤3:1 aspect + ≥655K px
   constraints — 1024×2048 = 2.1M px, fine). Generating large then
   downsampling to exact 16px grid gives cleaner edges than asking the
   model for literal 16px output (which it cannot produce reliably).
3. **Background removal**: pipe the output through `fal-ai/imageutils/rembg`
   (second Fal call, output URL from step 1 → `image_url` input) to strip
   the neutral background before pixelization. Skip this step for floor
   tiles/weather overlays that are meant to be fully opaque.
4. **Downsample to exact target grid** using nearest-neighbor / area-
   averaging + a hard palette quantization pass — do NOT use naive
   `sips`/ImageMagick bilinear resize (produces mushy anti-aliased edges
   that break the flat-color `SpriteData` hex-grid model). Concrete tool:
   a small Node script using `sharp` — `sharp(input).resize(16, 32, {
kernel: 'nearest' }).png()` for a single frame, then a palette-snap
   pass (round each pixel to nearest color in a fixed N-color house
   palette, e.g. via a simple k-d tree or the existing `adjustSprite`
   HSL-shift infrastructure run in reverse — **quantize, don't just
   resize**). This script is a new file: `assets-source/scripts/pixelize.mjs`.
5. **Palette-snap validation**: after quantization, the resulting PNG's
   unique-color count must be ≤ 16 (house sprites are 6-10 colors
   typically — check any existing furniture PNG's color count as the
   ceiling: `sips` or a one-line Node `pngjs` histogram). If over budget,
   re-run step 4 with a smaller target palette, don't hand-edit.
6. **Grid re-composition**: individual generated frames get composited
   into the required sheet layout (112×96 for character sheets, N×16 rows
   for furniture rotation groups) via the same `pixelize.mjs` script's
   compose mode — reads N input frame PNGs, writes one sheet PNG at the
   exact byte-for-byte dimensions the decoder expects.

### 5.3 QA gate (automated, before human review)

Build agents run these checks per generated asset **before** adding it
to `_progress.md` as `[~]` (pending human review):

- **Dimension check**: `file <output>.png` output width/height matches
  the manifest's declared `width`/`height` exactly (16×32, 16×16, 112×96,
  etc.) — hard fail if not, regenerate.
- **Alpha check** (non-floor assets): PNG has a real alpha channel (not
  a baked checkerboard) — verify via `sharp(...).metadata().channels === 4`
  AND spot-check that at least one corner pixel has `alpha < 255` (confirms
  rembg actually ran, not just format-converted).
- **Grayscale distinctness check** (any new state/mood/weather asset that
  will appear alongside an existing one on screen): convert both to
  grayscale, diff the silhouettes — if pixel-overlap similarity >90% with
  only color changed, this is a REJECT per the colorblind hard rule, not
  a human judgment call.
- **Color budget check**: unique colors ≤16 per sprite (§5.2 step 5).
- **Decoder smoke test**: run the sprite through the actual
  `decodeCharacterPng`/`pngToSpriteData`/`decodeFloorPng` function (Vitest,
  extend `webview-ui/test/dev-assets.test.ts`) — must not throw, must
  produce a non-empty `SpriteData` grid of the expected dimensions. This
  is the load-bearing gate: an asset that LOOKS right but the loader
  rejects (wrong byte layout, wrong manifest footprint math) is worse
  than no asset — it silently fails to render in-game.

Any `[!]` (regen needed) goes back to step 1 with a tightened prompt;
after 2 failed regens on the same asset, fall back per §5.4.

### 5.4 Fallback plan — if gen quality is insufficient

Named house tilesets that already ship in `webview-ui/public/assets/`
are the fallback tier, not "buy a new asset pack": if a generated asset
fails QA twice, the build agent:

1. **Reuses/recolors an existing shipped sprite** via the existing
   `adjustSprite`/`colorizeSprite` hue-shift pipeline (e.g. a new "server
   rack" that fails gen QA falls back to a hue-shifted `DOUBLE_BOOKSHELF`
   silhouette with a new manifest ID) rather than blocking the whole
   batch.
2. Logs the fallback explicitly in `_progress.md` as `[x] (FALLBACK:
recolored <source-asset>)` — visible in the human review pass, not
   silently substituted.
3. **Never blocks a milestone on art quality** — a placeholder/recolor
   ships in v1.0 if generation underdelivers; a follow-up "art polish"
   backlog item gets filed instead. (This mirrors the existing house
   precedent: `Locked items simply don't render (no teasers)` from
   STATE.md — the game already tolerates "plain until upgraded" states.)
4. **Free public pixel-art tilesets as last resort** (only if the
   recolor fallback also looks wrong for the specific asset — e.g. no
   existing shape reads as "server rack" even recolored): Kenney.nl
   assets (CC0, kenney.nl/assets, tag `1-bit`/`RPG` packs match the
   16×16/16×32 grid closely) — download, re-grid to house dimensions
   with the same `pixelize.mjs` compose step, attribute per license (CC0
   needs no attribution but note the source in the manifest folder's
   README for traceability).

### 5.5 Batch execution order for v1.0 (file-level task list)

1. Employee desk-work + celebrate sheets, all 6 existing palettes (12
   generation jobs: 2 cycles × 6 palettes, reusing `char_N.png` frame
   slots 4-6 for desk-work; new files for celebrate).
2. Break-room idle sheet, all 6 palettes (6 jobs).
3. Server room: floor tile + `SERVER_RACK` + `CABLE_TRAY` (3 jobs).
4. Break room: floor tile + `VENDING_MACHINE` (2 jobs, `COFFEE_MACHINE`/
   `LOUNGE_SOFA` reuse existing).
5. War room: floor tile + `BIG_MAP_TABLE` (2 jobs) — **gate on confirming
   2×2 footprint support in `tileMap.ts` first**, this is a code
   dependency, not just an asset one.
6. Weather particle textures: rain streak, snowflake (2 jobs, small/cheap).
7. Mood/trait badge glyph set (4 mood states + ~6 trait icons per
   employee-sim section's taxonomy — count depends on that section's
   final trait list, budget ~10 jobs).

Total v1.0 generation budget: ~37 jobs × $0.05 (medium quality, default)
≈ **$1.85** in Fal spend, plus rembg calls (near-negligible, background-
removal pricing is separate/cheap per Fal's utils tier) — trivially
cheap, quality iteration (regens) is the only cost variable worth
tracking, not raw job count.

---

## 6. Verification commands (for build-agent self-check, not judgment calls)

- **Dimension conformance**: `file assets-source/raw-gen/**/*.png` — grep
  output for exact expected `WxH` string per manifest before accepting.
- **Sheet decode smoke test**: `npm test -- dev-assets.test.ts` (extend
  this file with one test per new sheet type — decode, assert frame
  count, assert no throw).
- **Grayscale distinctness**: a small new script,
  `assets-source/scripts/grayscale-check.mjs <fileA> <fileB>` — desaturate
  both, compute pixel-diff percentage, fail if <10% different when the
  two assets represent different game states.
- **Color budget**: `assets-source/scripts/color-count.mjs <file>` — fail
  if >16 unique RGBA values.
- **Full asset-pipeline regression**: whatever the project's existing
  `npm run test` / `npm run build` gate is (STATE.md shows `server
329/329, webview 158/158, bin 63/63, tsc/lint/build clean` as the
  standing bar) — new asset-loader code must not regress this count.

---

## Risks

1. **GPT Image 2 may not hit the flat-color/hard-outline house style
   consistently across 37+ jobs** even with reference anchoring — Diablito's
   own log shows "divergent pairs" needing acceptance calls even within one
   mascot's parchment/dark variants. Expect a non-trivial regen rate (budget
   2-3x the job count in actual API calls, still cheap in dollars, costs
   build-agent time/judgment at the QA gate instead).
2. **2×2-footprint furniture (war room map table) may not be supported by
   the current tile-occupancy code** (`tileMap.ts`) — this section assumed
   it's fine but did not read that file in depth; if unsupported, it's a
   code task disguised as an asset task and will block that one prop.
3. **The "extend char_N.png frames 4-6" plan for desk-work assumes those
   frame slots are genuinely unused** — this was inferred from sheet math
   (112px = 7×16) and the observation that only `typing`/`reading` (4
   frames) are wired in `spriteData.ts`, but was not verified against
   every consumer of the raw decoded array; if frames 4-6 are silently
   used as animation padding/loop-buffer somewhere, overwriting them
   breaks existing walk-cycle rendering, not just adds new content.

## Three things most likely to be wrong

1. **The frame-slot-reuse plan for desk-work animation (§2.1)** — confidence
   is inferred-not-verified; a build agent should re-grep every array index
   into the decoded 7-frame row before writing new pixels into slots 4-6.
2. **The cost estimate (~$1.85, §5.5)** — assumes `medium` quality holds up
   and regen rate stays low; if flat-color consistency requires `high`
   quality (3.5x cost) or heavy iteration, real spend could be 5-10x this,
   still small in absolute dollars but the _time_ cost of QA/regen cycles
   is the bigger unknown, not the API bill.
3. **Whether GPT Image 2 (a photoreal/typography-optimized model) is even
   the right tool for authentic flat-color game-asset generation at all**
   — the SKILL.md's own "when to use vs other models" table doesn't list
   flat-color pixel-game-asset generation as a strength, and steers style-
   transfer/strict-preservation work toward other models. This section
   chose to reuse GPT Image 2 because it's the system Greg already has
   wired (lowest integration cost), not because it's demonstrably the best
   model for this exact job — the fallback tier (§5.4) exists precisely
   because this bet might not pay off.
