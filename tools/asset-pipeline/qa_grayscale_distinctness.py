#!/usr/bin/env python3
"""qa_grayscale_distinctness.py — C2 sprite-diversity QA gate.

Independent check that no two worker variants are silhouette-identical
in grayscale (the pack.py/validate-manifest.mjs gates check dimension,
alpha, and manifest geometry — none of them check that two DIFFERENT
sprites actually look different). Reads the staged
characters.manifest.json + sheets, extracts the binary alpha silhouette
of each worker's ".sit" S-rotation frame, aligns pairs, and computes
IoU. Per the v5 KICKOFF C2 acceptance framing: reject any pair with
>90% silhouette overlap.

METHODOLOGY NOTE (why head-region, not full-body): a first pass
compared the FULL-BODY silhouette and found >90% overlap between
almost every pair — including the original 4 outfits against each
other (rust vs teal 99.5%, moss vs teal 99.1%), which already ship in
production and are visibly distinct to a human. That proves full-body
raw-pixel IoU is the wrong metric for this rig: every worker shares
the same torso/leg geometry (only "build" scales it, and build is
identical within most same-build variant groups), so torso+legs
dominate total pixel count regardless of how different the hair is.
The doctrine's own wording ("hair/build differences should carry
this") names hair as the intended discriminator, so this gate crops to
the head+hair region (top ~42% of the frame, empirically where hair
geometry lives and shoulders don't yet dominate) before computing IoU.
This caught a real bug on the first head-region pass too: the "bun"
hairstyle was tucked behind the skull and barely visible from the S
rotation (rust vs teal 93.4%, navy vs ochre 92.6%) — fixed in
characters.py by enlarging/raising the bun into a visible top-knot.

Usage: python3 qa_grayscale_distinctness.py [--stage ../../webview-v3-assets]
"""

import argparse
import itertools
import json
import os
import sys

from PIL import Image

OVERLAP_FAIL_THRESHOLD = 90.0
HEAD_REGION_FRACTION = 0.42  # top fraction of frame height compared


def load_manifest(stage):
    with open(os.path.join(stage, "characters.manifest.json")) as f:
        return json.load(f)


def silhouette_mask(stage, manifest, sprite, sheets):
    sheet_idx = sprite["sheet"]
    sheet = sheets.setdefault(
        sheet_idx,
        Image.open(os.path.join(stage, manifest["sheets"][sheet_idx])).convert("RGBA"),
    )
    frame = sprite["frames"]["S"]
    fr = frame[0] if isinstance(frame, list) else frame
    w, h = sprite["size"]
    crop = sheet.crop((fr["x"], fr["y"], fr["x"] + w, fr["y"] + h))
    alpha = crop.getchannel("A")
    mask = alpha.point(lambda p: 255 if p > 16 else 0)
    head_h = int(h * HEAD_REGION_FRACTION)
    head_mask = mask.crop((0, 0, w, head_h))
    ax, ay = sprite["anchor"]
    return head_mask, (ax, min(ay, head_h))


def iou_aligned(mask_a, anchor_a, mask_b, anchor_b):
    """Overlap % aligned by floor-contact anchor (not raw bbox), since
    workers differ in height/width by build — a naive top-left overlap
    would penalize a tall/short pair for merely differing in canvas
    size rather than silhouette shape."""
    ax, ay = anchor_a
    bx, by = anchor_b
    # canvas big enough to hold both, anchors coincide at a common point
    pad = 40
    cx, cy = int(max(ax, bx)) + pad, int(max(ay, by)) + pad
    cw = cx + max(mask_a.width - int(ax), mask_b.width - int(bx)) + pad
    ch = cy + max(mask_a.height - int(ay), mask_b.height - int(by)) + pad

    canvas_a = Image.new("L", (cw, ch), 0)
    canvas_a.paste(mask_a, (cx - int(ax), cy - int(ay)))
    canvas_b = Image.new("L", (cw, ch), 0)
    canvas_b.paste(mask_b, (cx - int(bx), cy - int(by)))

    pa = canvas_a.point(lambda p: 1 if p else 0)
    pb = canvas_b.point(lambda p: 1 if p else 0)

    a_px = list(pa.getdata())
    b_px = list(pb.getdata())
    inter = sum(1 for x, y in zip(a_px, b_px) if x and y)
    union = sum(1 for x, y in zip(a_px, b_px) if x or y)
    if union == 0:
        return 0.0
    return 100.0 * inter / union


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", default="../../webview-v3-assets")
    ap.add_argument("--prefix", default="worker_")
    args = ap.parse_args()

    manifest = load_manifest(args.stage)
    sheets = {}
    sit_sprites = {
        s["name"][:-len(".sit")]: s
        for s in manifest["sprites"]
        if s["name"].startswith(args.prefix) and s["name"].endswith(".sit")
    }
    names = sorted(sit_sprites)
    print(f"[qa-grayscale] {len(names)} worker variants found: {names}")

    masks = {}
    for name in names:
        masks[name] = silhouette_mask(args.stage, manifest, sit_sprites[name], sheets)

    failures = []
    checked = 0
    for a, b in itertools.combinations(names, 2):
        mask_a, anchor_a = masks[a]
        mask_b, anchor_b = masks[b]
        overlap = iou_aligned(mask_a, anchor_a, mask_b, anchor_b)
        checked += 1
        status = "FAIL" if overlap > OVERLAP_FAIL_THRESHOLD else "ok"
        if status == "FAIL":
            failures.append((a, b, overlap))
            print(f"[qa-grayscale] FAIL {a} vs {b}: {overlap:.1f}% silhouette overlap")

    print(f"[qa-grayscale] {checked} pairs checked, {len(failures)} failures "
          f"(threshold {OVERLAP_FAIL_THRESHOLD}%)")
    if failures:
        sys.exit(1)
    print("[qa-grayscale] OK — every worker pair is silhouette-distinguishable")


if __name__ == "__main__":
    main()
