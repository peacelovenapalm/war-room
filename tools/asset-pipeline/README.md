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

Sheets are split into deterministic groups so each PNG stays under the
~1MB budget and regeneration diffs stay local to one sheet.

## Layout

| File | Role |
| --- | --- |
| `blender/rig.py` | scene setup: 2:1 dimetric ortho camera (X 60°, Z 45° — cos 60° = 0.5 gives the exact 2:1 diamond), warm-key three-point night-office light rig, Cycles + transparent film + alpha shadow catcher |
| `blender/props.py` | 16 parametric prop builders (pure bpy primitives + bevel/solidify), shared warm palette |
| `blender/render_props.py` | `-b -P` entry: each prop at 4 rotations (N/E/S/W as the camera sees them) → alpha PNGs + `meta.json` |
| `pack.py` | union-trim across rotations, exact 2x→1x LANCZOS downscale, shelf-pack, manifest + validation gate |

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

## Iterating on look

```sh
make preview PROP=sofa       # 4 fast renders into out/preview/
open out/preview/sofa__S.png
```

Tune palette hexes in `props.py` (`PALETTE`) and the light rig in
`rig.py` (`build_scene`), then re-run. `pack.py` fails loudly (exit 1)
on schema violations, empty frames, frame overlap, or a sheet over
~1MB — never ship on a red gate.

## Stage 2+ (not yet built)

Walker/character set, codex `$imagegen` lane (portraits/signage,
rectangular only), HTML sheet-viewer QA harness.
