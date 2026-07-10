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

| File | Role |
| --- | --- |
| `blender/rig.py` | scene setup: 2:1 dimetric ortho camera (X 60°, Z 45° — cos 60° = 0.5 gives the exact 2:1 diamond), warm-key three-point night-office light rig, Cycles + transparent film + alpha shadow catcher |
| `blender/props.py` | 16 parametric prop builders (pure bpy primitives + bevel/solidify), shared warm palette |
| `blender/render_props.py` | `-b -P` entry: each prop at 4 rotations (N/E/S/W as the camera sees them) → alpha PNGs + `meta.json` |
| `blender/characters.py` | parametric low-poly person (joint-empty direct posing, no armature — deterministic headless) in 4 palette outfits × 4 animations, plus the cat; rendered through the SAME rig |
| `blender/render_characters.py` | `-b -P` entry: each sprite pose-frame × 4 rotations → alpha PNGs + `meta.json` (frame LISTS + fps) |
| `pack.py` | union-trim across rotations (and animation frames), exact 2x→1x LANCZOS downscale, soft-shadow alpha quantization (~25% smaller PNGs, invisible), shelf-pack, manifest + validation gate |

## Contract

- 1 blender unit = 1 floor tile. Tile diamond = **128×64 px at 1x**
  (`tilePx` in the manifest). Renders happen at 2x and are downscaled.
- Props are authored facing **S** (screen lower-left); rotation labels
  are the compass direction the front faces as the camera sees them
  (N upper-right, E lower-right, S lower-left, W upper-left).
- Walls are authored hugging the tile's **north edge**; rotate to place
  them on other edges. Floor tiles sit *below* z=0 so props rest flush.
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

| Sprite | Frames | What it is |
| --- | --- | --- |
| `worker_<outfit>.walk` | 4 | walk cycle (contact / pass / contact / pass, with bob) |
| `worker_<outfit>.sit` | 1 | seated — pelvis at chair-seat height 0.40; WS-A draws the chair, then the person |
| `worker_<outfit>.type` | 2 | seated typing, alternating forearms; hands land at desk height 0.72 one tile forward |
| `worker_<outfit>.blocked` | 1 | standing, head down, right hand raised |
| `cat.curl` | 1 | curled sleeping cat |
| `cat.walk` | 2 | cat walk, diagonal leg pairs |

Outfits (shirt / skin / hair silhouette): `worker_teal` (blob),
`worker_rust` (bun), `worker_slate` (terracotta cap), `worker_moss`
(buzz). Characters are authored facing **S** like the props; a worker
"sits at" a desk by using the rotation that faces the desk tile.

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

| File | Role |
| --- | --- |
| `imagegen/spec.json` | locked style block + one prompt per asset (name, category, genSize, finalSize, purpose, prompt) |
| `imagegen/gen.sh` | one `codex exec --skip-git-repo-check -s workspace-write` call per asset; `$imagegen` reaches codex literally via a python-built, single-quote-safe prompt (never re-expanded by the shell) — verified invocation pattern, Diablito 2026-07-06. Raw PNGs land in `out/imagegen-raw/` |
| `imagegen/pack_imagegen.py` | stages raw PNGs into `webview-v3-assets/imagegen/<category>/`, downscales portraits to `finalSize`, writes `manifest.json` (schema: `{name, path, size, purpose}` — no anchor/rotation/frames, these aren't sprites) |

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

## Not yet built

HTML sheet-viewer QA harness (screenshot + anchor/alignment check +
manifest schema validation) — out of Stage 3 scope, still open.
