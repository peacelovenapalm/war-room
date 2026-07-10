#!/usr/bin/env python3
"""pack.py — pack raw Blender renders into spritesheet PNG(s) + manifest.

Reads  <raw>/meta.json + <raw>/<prop>__<ROT>.png   (at 2x render scale)
Writes <stage>/props.sheet.png + <stage>/props.manifest.json (at 1x)

Per prop:
  1. union alpha bbox across all 4 rotations (threshold ALPHA_TRIM — the
     Cycles shadow catcher leaves a faint sub-8 wash across the canvas)
  2. crop all rotations with the SAME box so the anchor stays aligned,
     snap box to even coords so the 2x -> 1x downscale is exact
  3. LANCZOS downscale to 1x
  4. shelf-pack frames into the sheet (height-sorted, PADding)

Manifest schema (KICKOFF-v3.1 WS-B item 1):
  { name, size, anchor, rotations, frames }
  - size    [w, h]     frame size in sheet px (uniform across rotations)
  - anchor  [x, y]     tile-floor contact point RELATIVE to the frame
  - sheet   int        index into top-level "sheets"
  - frames  {ROT: {x, y, anchor: [sheetX, sheetY]}}   -- per-frame anchor
            is the same contact point in ABSOLUTE sheet pixels
  - attach  {name: {ROT: [[x,y] * 4]}}  frame-relative quads (e.g. the
            desk monitor screen face, for the DOM tail overlay)

ANIMATED sprites (characters): when the raw meta lists MULTIPLE files
per rotation, frames.ROT becomes an ARRAY of {x, y, anchor} in
animation order and the sprite carries "fps" (0/absent = static).
Union-trim spans all rotations AND all animation frames, so size and
the frame-relative anchor stay uniform across the whole sprite — walk
frames never jitter against the tile.

Sprites are packed into deterministic atlas GROUPS (structure /
furniture / staff / pets) so each PNG stays under the ~1MB budget and
regeneration diffs stay local to one sheet.
"""

import argparse
import json
import os
import sys

from PIL import Image

ALPHA_TRIM = 8      # ignore shadow-catcher wash below this alpha
PAD = 2             # px between packed frames (1x)
SHEET_MAX_W = 2048

# Soft-shadow alpha is denoised Cycles gradient — residual noise there
# kills PNG filtering. Quantize alpha below the wash ceiling to 8/255
# steps (~3% opacity — invisible in an already-soft gradient) and zero
# RGB under fully transparent pixels: ~25% smaller sheets, no visible
# change.
SHADOW_QUANT_BELOW = 64
SHADOW_QUANT_STEP = 8
_ALPHA_LUT = [(i // SHADOW_QUANT_STEP) * SHADOW_QUANT_STEP
              if i < SHADOW_QUANT_BELOW else i for i in range(256)]


def compress_alpha(im):
    a = im.getchannel("A").point(_ALPHA_LUT)
    mask = a.point(lambda p: 255 if p else 0)
    clean = Image.new("RGBA", im.size, (0, 0, 0, 0))
    clean.paste(im, mask=mask)
    clean.putalpha(a)
    return clean

# deterministic atlas grouping — keeps each PNG under the ~1MB budget
GROUPS = {
    "structure": ("floor_tile", "floor_tile_b", "floor_tile_c",
                  "wall_straight", "wall_corner", "wall_window"),
}
# staff split into outfit pairs — one full-quality staff atlas lands
# ~1.4MB, over the ~1MB-per-PNG budget
PREFIX_GROUPS = (("cat", "pets"),
                 ("worker_teal", "staff_a"), ("worker_rust", "staff_a"),
                 ("worker_slate", "staff_b"), ("worker_moss", "staff_b"))
DEFAULT_GROUP = "furniture"


def group_of(prop):
    for g, names in GROUPS.items():
        if prop in names:
            return g
    for prefix, g in PREFIX_GROUPS:
        if prop.startswith(prefix):
            return g
    return DEFAULT_GROUP


def load_meta(raw_dir):
    with open(os.path.join(raw_dir, "meta.json")) as f:
        return json.load(f)


def union_bbox(images):
    box = None
    for im in images:
        a = im.getchannel("A").point(lambda p: 255 if p > ALPHA_TRIM else 0)
        b = a.getbbox()
        if b is None:
            continue
        box = b if box is None else (
            min(box[0], b[0]), min(box[1], b[1]),
            max(box[2], b[2]), max(box[3], b[3]))
    if box is None:
        raise ValueError("prop rendered fully transparent")
    return box


def snap_even(box, limit_w, limit_h):
    """Grow box outward to even coords/size so /2 downscale is exact."""
    x0, y0, x1, y1 = box
    x0 -= x0 % 2
    y0 -= y0 % 2
    x1 += x1 % 2
    y1 += y1 % 2
    return (max(0, x0), max(0, y0), min(limit_w, x1), min(limit_h, y1))


def shelf_pack(frames):
    """frames: list of dicts with w,h. Returns (sheet_w, sheet_h), sets x,y."""
    order = sorted(frames, key=lambda f: (-f["h"], -f["w"]))
    x = y = shelf_h = 0
    sheet_w = 0
    for f in order:
        if x + f["w"] + PAD > SHEET_MAX_W and x > 0:
            y += shelf_h + PAD
            x = shelf_h = 0
        f["x"], f["y"] = x, y
        x += f["w"] + PAD
        shelf_h = max(shelf_h, f["h"])
        sheet_w = max(sheet_w, x)
    return sheet_w - PAD, y + shelf_h


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True)
    ap.add_argument("--stage", required=True)
    ap.add_argument("--name", default="props")
    args = ap.parse_args()

    meta = load_meta(args.raw)
    scale = meta["scale"]
    anchor2x = meta["anchor_px"]  # same for every prop/rotation
    rotations = meta["rotations"]

    sprites = []
    frames_by_group = {}
    for prop, entry in sorted(meta["props"].items()):
        # frames per rotation: single filename (props) or list (animated)
        animated = any(isinstance(entry["frames"][r], list)
                       for r in rotations)
        seq = {r: (entry["frames"][r] if animated else [entry["frames"][r]])
               for r in rotations}
        imgs = {r: [Image.open(os.path.join(args.raw, f)) for f in files]
                for r, files in seq.items()}
        cw, ch = imgs[rotations[0]][0].size
        box = union_bbox([im for lst in imgs.values() for im in lst])
        # grow the box so the floor-contact anchor is always INSIDE the
        # frame (edge-hugging props like walls otherwise trim past it)
        box = (min(box[0], int(anchor2x[0]) - 2),
               min(box[1], int(anchor2x[1]) - 2),
               max(box[2], int(anchor2x[0]) + 2),
               max(box[3], int(anchor2x[1]) + 2))
        box = snap_even(box, cw, ch)
        # frame-relative anchor at 1x
        ax = (anchor2x[0] - box[0]) / scale
        ay = (anchor2x[1] - box[1]) / scale
        w1 = (box[2] - box[0]) // scale
        h1 = (box[3] - box[1]) // scale
        sprite = {
            "name": prop,
            "size": [w1, h1],
            "anchor": [round(ax, 1), round(ay, 1)],
            "rotations": rotations,
            "footprint": entry["footprint"],
            "group": group_of(prop),
            "frames": {},
        }
        if entry.get("fps"):
            sprite["fps"] = entry["fps"]
        # attach quads -> frame-relative 1x coords
        if entry.get("attach"):
            sprite["attach"] = {
                aname: {
                    rot: [[round((px - box[0]) / scale, 1),
                           round((py - box[1]) / scale, 1)]
                          for px, py in quad]
                    for rot, quad in per_rot.items()
                }
                for aname, per_rot in entry["attach"].items()
            }
        for r in rotations:
            placed = []
            for im_src in imgs[r]:
                im = compress_alpha(
                    im_src.crop(box).resize((w1, h1), Image.LANCZOS))
                fr = {"prop": prop, "rot": r, "img": im, "w": w1, "h": h1}
                frames_by_group.setdefault(sprite["group"], []).append(fr)
                placed.append(fr)  # placeholders, positions filled below
            sprite["frames"][r] = placed if animated else placed[0]
        sprites.append(sprite)

    os.makedirs(args.stage, exist_ok=True)
    sheet_files, sheet_sizes, sheet_images = [], [], {}
    group_index = {}
    for group in sorted(frames_by_group):
        frames = frames_by_group[group]
        sheet_w, sheet_h = shelf_pack(frames)
        sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))
        for fr in frames:
            sheet.paste(fr["img"], (fr["x"], fr["y"]))
        sheet_file = f"{args.name}.{group}.sheet.png"
        sheet.save(os.path.join(args.stage, sheet_file), optimize=True)
        group_index[group] = len(sheet_files)
        sheet_files.append(sheet_file)
        sheet_sizes.append([sheet_w, sheet_h])
        sheet_images[group] = sheet

    def _emit(fr, ax, ay):
        return {
            "x": fr["x"], "y": fr["y"],
            "anchor": [round(fr["x"] + ax, 1), round(fr["y"] + ay, 1)],
        }

    for sprite in sprites:
        ax, ay = sprite["anchor"]
        sprite["sheet"] = group_index[sprite.pop("group")]
        for r, fr in list(sprite["frames"].items()):
            sprite["frames"][r] = ([_emit(f, ax, ay) for f in fr]
                                   if isinstance(fr, list)
                                   else _emit(fr, ax, ay))

    manifest = {
        "version": 1,
        "sheets": sheet_files,
        "sheetSizes": sheet_sizes,
        "tilePx": meta["tile_px"],
        "renderScale": scale,
        "sprites": sprites,
    }
    manifest_path = os.path.join(args.stage, f"{args.name}.manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    # ---- validation gate (fail loudly, never ship a broken manifest)
    errors = validate(manifest, sheet_images, group_index)
    for i, sheet_file in enumerate(sheet_files):
        size_kb = os.path.getsize(os.path.join(args.stage, sheet_file)) / 1024
        n = sum(1 for s in sprites if s["sheet"] == i)
        print(f"[pack] {sheet_file} {sheet_sizes[i][0]}x{sheet_sizes[i][1]} "
              f"({size_kb:.0f} KB, {n} sprites)")
        if size_kb > 1024:
            errors.append(f"{sheet_file} {size_kb:.0f} KB exceeds ~1MB budget")
    n_frames = sum(
        len(fr) if isinstance(fr, list) else 1
        for s in sprites for fr in s["frames"].values())
    print(f"[pack] {len(sprites)} sprites, {n_frames} frames total")
    if errors:
        for e in errors:
            print(f"[pack] FAIL {e}", file=sys.stderr)
        sys.exit(1)
    print(f"[pack] OK manifest={manifest_path}")


def validate(manifest, sheet_images, group_index):
    errors = []
    sheets = {i: img for g, img in sheet_images.items()
              for gi, i in [(g, group_index[g])]}
    rects = []
    for s in manifest["sprites"]:
        w, h = s["size"]
        ax, ay = s["anchor"]
        si = s["sheet"]
        sw, sh = manifest["sheetSizes"][si]
        sheet = sheets[si]
        if not (0 <= ax <= w and 0 <= ay <= h):
            errors.append(f"{s['name']}: anchor {s['anchor']} outside frame")
        if set(s["rotations"]) != set(s["frames"]):
            errors.append(f"{s['name']}: rotations/frames mismatch")
        for r, fr in s["frames"].items():
            fr_list = fr if isinstance(fr, list) else [fr]
            for fi, f in enumerate(fr_list):
                tag = f"{s['name']}/{r}.{fi}" if len(fr_list) > 1 \
                    else f"{s['name']}/{r}"
                if f["x"] + w > sw or f["y"] + h > sh:
                    errors.append(f"{tag}: frame exceeds sheet")
                rects.append((si, tag, f["x"], f["y"], w, h))
                # frame must contain actual pixels
                crop = sheet.crop((f["x"], f["y"], f["x"] + w, f["y"] + h))
                if crop.getchannel("A").getbbox() is None:
                    errors.append(f"{tag}: frame is empty")
    for i in range(len(rects)):
        for j in range(i + 1, len(rects)):
            s1, t1, x1, y1, w1, h1 = rects[i]
            s2, t2, x2, y2, w2, h2 = rects[j]
            if s1 != s2:
                continue
            if x1 < x2 + w2 and x2 < x1 + w1 and y1 < y2 + h2 and y2 < y1 + h1:
                errors.append(f"overlap: {t1} vs {t2}")
    return errors


if __name__ == "__main__":
    main()
