#!/usr/bin/env python3
"""Losslessly re-group already-staged atlases using pack.py's policy.

This is the migration path when only atlas grouping changes and the expensive
Blender renders are not present locally. It crops the existing manifest frames,
re-packs those exact RGBA pixels, rewrites frame coordinates/absolute anchors,
and runs the same validation used by a full raw-render pack.
"""

import argparse
import copy
import json
import os
import shutil
import tempfile

from PIL import Image

from pack import group_of, shelf_pack, validate


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", required=True)
    ap.add_argument("--name", required=True, choices=("props", "characters"))
    args = ap.parse_args()

    manifest_path = os.path.join(args.stage, f"{args.name}.manifest.json")
    with open(manifest_path) as f:
        old_manifest = json.load(f)
    manifest = copy.deepcopy(old_manifest)

    source_sheets = []
    for sheet_file in old_manifest["sheets"]:
        with Image.open(os.path.join(args.stage, sheet_file)) as image:
            source_sheets.append(image.convert("RGBA"))

    frames_by_group = {}
    frame_lookup = {}
    for sprite_index, sprite in enumerate(old_manifest["sprites"]):
        group = group_of(sprite["name"])
        w, h = sprite["size"]
        for rotation, frame_value in sprite["frames"].items():
            frame_list = frame_value if isinstance(frame_value, list) else [frame_value]
            for frame_index, frame in enumerate(frame_list):
                image = source_sheets[sprite["sheet"]].crop(
                    (frame["x"], frame["y"], frame["x"] + w, frame["y"] + h)
                )
                packed = {"img": image, "w": w, "h": h}
                frames_by_group.setdefault(group, []).append(packed)
                frame_lookup[(sprite_index, rotation, frame_index)] = packed

    temp_dir = tempfile.mkdtemp(prefix=f".repack-{args.name}-", dir=args.stage)
    try:
        sheet_files = []
        sheet_sizes = []
        sheet_images = {}
        group_index = {}
        for group in sorted(frames_by_group):
            frames = frames_by_group[group]
            sheet_w, sheet_h = shelf_pack(frames)
            sheet = Image.new("RGBA", (sheet_w, sheet_h), (0, 0, 0, 0))
            for frame in frames:
                sheet.paste(frame["img"], (frame["x"], frame["y"]))
            sheet_file = f"{args.name}.{group}.sheet.png"
            sheet.save(os.path.join(temp_dir, sheet_file), optimize=True)
            group_index[group] = len(sheet_files)
            sheet_files.append(sheet_file)
            sheet_sizes.append([sheet_w, sheet_h])
            sheet_images[group] = sheet

        manifest["sheets"] = sheet_files
        manifest["sheetSizes"] = sheet_sizes
        for sprite_index, sprite in enumerate(manifest["sprites"]):
            sprite["sheet"] = group_index[group_of(sprite["name"])]
            ax, ay = sprite["anchor"]
            for rotation, frame_value in sprite["frames"].items():
                frame_list = frame_value if isinstance(frame_value, list) else [frame_value]
                rewritten = []
                for frame_index, _frame in enumerate(frame_list):
                    packed = frame_lookup[(sprite_index, rotation, frame_index)]
                    rewritten.append({
                        "x": packed["x"],
                        "y": packed["y"],
                        "anchor": [round(packed["x"] + ax, 1), round(packed["y"] + ay, 1)],
                    })
                sprite["frames"][rotation] = rewritten if isinstance(frame_value, list) else rewritten[0]

        errors = validate(manifest, sheet_images, group_index)
        for index, sheet_file in enumerate(sheet_files):
            size = os.path.getsize(os.path.join(temp_dir, sheet_file))
            if size > 1024 * 1024:
                errors.append(f"{sheet_file} {size / 1024:.0f} KB exceeds ~1MB budget")
            count = sum(1 for sprite in manifest["sprites"] if sprite["sheet"] == index)
            print(f"[repack] {sheet_file} {size / 1024:.1f} KB, {count} sprites")
        if errors:
            raise ValueError("\n".join(errors))

        new_manifest_path = os.path.join(temp_dir, f"{args.name}.manifest.json")
        with open(new_manifest_path, "w") as f:
            json.dump(manifest, f, indent=2)

        for sheet_file in sheet_files:
            os.replace(os.path.join(temp_dir, sheet_file), os.path.join(args.stage, sheet_file))
        os.replace(new_manifest_path, manifest_path)
        for old_sheet in old_manifest["sheets"]:
            if old_sheet not in sheet_files:
                os.remove(os.path.join(args.stage, old_sheet))
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

    print(f"[repack] OK manifest={manifest_path}")


if __name__ == "__main__":
    main()
