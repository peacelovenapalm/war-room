#!/usr/bin/env python3
"""make_preview_grid.py — C2 sprite-diversity preview grid.

Phone-viewable single PNG: every NEW C2 worker variant, S-facing sit
pose + walk frame 0, side by side with a text label. Reads the staged
characters.manifest.json + sheets (post-pack.py, so it's exactly what
ships), not the raw Blender renders.

Usage: python3 make_preview_grid.py [--stage ../../webview-v3-assets] [--out preview/c2-variants.png]
"""

import argparse
import json
import os

from PIL import Image, ImageDraw, ImageFont

NEW_VARIANTS = [
    "worker_amber", "worker_coral", "worker_indigo", "worker_sage",
    "worker_plum", "worker_ochre", "worker_charcoal", "worker_rose",
    "worker_navy", "worker_clay", "worker_mint", "worker_violet",
]

CELL_PAD = 14
LABEL_H = 22
BG = (26, 24, 34, 255)
SCALE = 3  # nearest-neighbor upscale so it reads on a phone


def load_manifest(stage):
    with open(os.path.join(stage, "characters.manifest.json")) as f:
        return json.load(f)


def get_frame(stage, manifest, sheets, name, rot="S", idx=None):
    sprite = next(s for s in manifest["sprites"] if s["name"] == name)
    sheet_idx = sprite["sheet"]
    sheet = sheets.setdefault(
        sheet_idx,
        Image.open(os.path.join(stage, manifest["sheets"][sheet_idx])).convert("RGBA"),
    )
    frame = sprite["frames"][rot]
    fr = frame[idx if idx is not None else 0] if isinstance(frame, list) else frame
    w, h = sprite["size"]
    return sheet.crop((fr["x"], fr["y"], fr["x"] + w, fr["y"] + h))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default="../../webview-v3-assets")
    ap.add_argument("--out", default="preview/c2-variants.png")
    args = ap.parse_args()

    manifest = load_manifest(args.stage)
    sheets = {}

    cells = []
    max_w = max_h = 0
    for name in NEW_VARIANTS:
        sit = get_frame(args.stage, manifest, sheets, f"{name}.sit")
        walk = get_frame(args.stage, manifest, sheets, f"{name}.walk", idx=0)
        pair_w = sit.width + walk.width + CELL_PAD
        pair_h = max(sit.height, walk.height)
        cells.append((name, sit, walk, pair_w, pair_h))
        max_w = max(max_w, pair_w)
        max_h = max(max_h, pair_h)

    cols = 4
    rows = (len(cells) + cols - 1) // cols
    cell_w = max_w + CELL_PAD * 2
    cell_h = max_h + LABEL_H + CELL_PAD * 2
    grid = Image.new("RGBA", (cell_w * cols, cell_h * rows), BG)
    draw = ImageDraw.Draw(grid)
    try:
        font = ImageFont.truetype(
            "/System/Library/Fonts/Supplemental/Arial.ttf", 13)
    except OSError:
        font = ImageFont.load_default()

    for i, (name, sit, walk, pw, ph) in enumerate(cells):
        col, row = i % cols, i // cols
        ox, oy = col * cell_w + CELL_PAD, row * cell_h + CELL_PAD
        grid.alpha_composite(sit, (ox, oy + (max_h - sit.height)))
        grid.alpha_composite(walk, (ox + sit.width + CELL_PAD, oy + (max_h - walk.height)))
        label = name.replace("worker_", "")
        draw.text((ox, oy + max_h + 4), label, font=font, fill=(230, 225, 210, 255))

    grid = grid.resize((grid.width * SCALE, grid.height * SCALE), Image.NEAREST)
    out_path = args.out
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    grid.save(out_path)
    print(f"[preview-grid] wrote {out_path} ({grid.width}x{grid.height})")


if __name__ == "__main__":
    main()
