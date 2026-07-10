#!/usr/bin/env python3
"""war-room v3 imagegen lane — stage raw codex/$imagegen PNGs.

Reads spec.json + out/imagegen-raw/, writes processed PNGs into
webview-v3-assets/imagegen/<category>/ plus manifest.json.

Processing per asset:
  - portraits: LANCZOS downscale to finalSize (512x512).
  - everything else: kept at generated size.
  - every staged PNG: if the RGBA save exceeds the size budget, quantize
    to a 256-color adaptive palette (flat painterly art quantizes
    cleanly); hard-fail if still over budget so a bloated sheet can
    never ship silently (same gate philosophy as pack.py).

Validation gate (exit 1): missing raw asset, wrong generated aspect,
over-budget PNG after quantization.
"""
import argparse
import json
import os
import sys

from PIL import Image, ImageFilter

BUDGET_BYTES = 1_100_000  # ~1MB soft budget, matches sheet budget


def stage_one(asset, raw_dir, stage_root, problems):
    name, cat = asset["name"], asset["category"]
    raw_path = os.path.join(raw_dir, name + ".png")
    if not os.path.exists(raw_path):
        problems.append(f"{name}: raw PNG missing ({raw_path})")
        return None

    im = Image.open(raw_path).convert("RGB")  # this lane has NO alpha
    want_w, want_h = (int(x) for x in asset["genSize"].split("x"))
    if (im.width, im.height) != (want_w, want_h):
        # gpt-image occasionally returns its nearest supported size;
        # accept same-orientation, note the drift
        same_orient = (im.width >= im.height) == (want_w >= want_h)
        if not same_orient:
            problems.append(
                f"{name}: generated {im.width}x{im.height}, "
                f"wrong orientation vs spec {asset['genSize']}")
            return None
        print(f"  note {name}: generated {im.width}x{im.height} "
              f"(spec {asset['genSize']}), keeping")

    if asset.get("finalSize"):
        im = im.resize(tuple(asset["finalSize"]), Image.LANCZOS)

    out_dir = os.path.join(stage_root, cat)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, name + ".png")
    im.save(out_path, optimize=True)
    size = os.path.getsize(out_path)

    # Escalating fallback chain — only engages when RGB is over budget.
    # Flat painterly art quantizes cleanly to 256 colors; the vintage
    # print-poster grain (deliberate paper-noise texture) resists that
    # because it varies per-pixel and defeats deflate run-length coding.
    # A light median filter crushes that grain to flat runs WITHOUT
    # softening hard edges (text/shape boundaries survive) — cheaper
    # and more faithful than downscaling a text-bearing poster.
    if size > BUDGET_BYTES:
        im.quantize(colors=256, method=Image.MEDIANCUT).save(
            out_path, optimize=True)
        size = os.path.getsize(out_path)
        print(f"  note {name}: over budget as RGB, quantized to PNG-8 "
              f"({size} bytes)")
    if size > BUDGET_BYTES:
        denoised = im.filter(ImageFilter.MedianFilter(size=3))
        denoised.quantize(colors=256, method=Image.MEDIANCUT).save(
            out_path, optimize=True)
        size = os.path.getsize(out_path)
        print(f"  note {name}: still over budget, median-denoised + "
              f"requantized ({size} bytes)")
    if size > BUDGET_BYTES:
        denoised = im.filter(ImageFilter.MedianFilter(size=3))
        denoised.quantize(colors=128, method=Image.MEDIANCUT).save(
            out_path, optimize=True)
        size = os.path.getsize(out_path)
        print(f"  note {name}: still over budget, denoised + 128-color "
              f"requantize ({size} bytes)")
    if size > BUDGET_BYTES:
        problems.append(f"{name}: {size} bytes > {BUDGET_BYTES} budget "
                        "even after denoise+quantization fallback chain")
        return None

    print(f"  ok {name}: {im.width}x{im.height} {size//1024}KB -> "
          f"{os.path.relpath(out_path, stage_root)}")
    return {
        "name": name,
        "path": f"imagegen/{cat}/{name}.png",
        "size": [im.width, im.height],
        "purpose": asset["purpose"],
    }


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", default=os.path.join(here, "spec.json"))
    ap.add_argument("--raw", default=os.path.join(here, "..", "out",
                                                  "imagegen-raw"))
    ap.add_argument("--stage", default=os.path.join(here, "..", "..", "..",
                                                    "webview-v3-assets"))
    args = ap.parse_args()

    spec = json.load(open(args.spec))
    stage_root = os.path.abspath(args.stage)
    problems, entries = [], []
    for asset in spec["assets"]:
        entry = stage_one(asset, os.path.abspath(args.raw),
                          os.path.join(stage_root, "imagegen"), problems)
        if entry:
            entries.append(entry)

    manifest = {
        "version": spec["version"],
        "generator": "codex $imagegen (gpt-image), rectangular RGB only — "
                     "no alpha in this lane",
        "images": entries,
    }
    man_path = os.path.join(stage_root, "imagegen", "manifest.json")
    os.makedirs(os.path.dirname(man_path), exist_ok=True)
    with open(man_path, "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    print(f"manifest: {len(entries)} images -> {man_path}")

    if problems:
        print("\nVALIDATION GATE FAILED:", file=sys.stderr)
        for p in problems:
            print(f"  ✗ {p}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
