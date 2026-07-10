"""render_characters.py — headless entry point for the character set:
build each character sprite pose-frame by pose-frame, render it at the
4 iso rotations through the SAME rig.py camera/light rig as the props
(style consistency is load-bearing), and write out/raw-chars/meta.json.

meta.json shape matches render_props.py except frames per rotation is a
LIST (animation frame order) and each sprite carries an fps hint.

Usage:
  <blender> -b -P render_characters.py -- --out out/raw-chars
            [--sprites worker_teal.walk,cat.curl] [--samples 96]
"""

import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

import rig  # noqa: E402
import props  # noqa: E402
import characters  # noqa: E402


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--sprites", default="all",
                   help="comma-separated sprite names, or 'all'")
    p.add_argument("--samples", type=int, default=96)
    return p.parse_args(argv)


def main():
    args = parse_args()
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)

    names = (sorted(characters.SPRITES) if args.sprites == "all"
             else [n.strip() for n in args.sprites.split(",") if n.strip()])
    for n in names:
        if n not in characters.SPRITES:
            raise KeyError(
                f"unknown sprite: {n} (have {sorted(characters.SPRITES)})")

    scene = rig.build_scene(samples=args.samples)
    anchor_px = rig.project_px(scene, (0.0, 0.0, 0.0))

    meta = {
        "scale": rig.RENDER_SCALE,
        "tile_px": rig.TILE_PX,
        "canvas": [scene.render.resolution_x, scene.render.resolution_y],
        "anchor_px": [anchor_px[0], anchor_px[1]],
        "rotations": list(rig.ROTATIONS),
        "props": {},
    }

    # Partial renders MERGE into an existing meta.json (same rule as
    # render_props.py — clobbering desyncs manifest from PNGs on disk).
    meta_path = os.path.join(out_dir, "meta.json")
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            prev = json.load(f)
        if (prev.get("scale") == meta["scale"]
                and prev.get("canvas") == meta["canvas"]
                and prev.get("anchor_px") == meta["anchor_px"]):
            meta["props"] = prev.get("props", {})

    for name in names:
        spec = characters.SPRITES[name]
        entry = {
            "footprint": [1, 1],
            "fps": spec["fps"],
            "frames": {r: [] for r in rig.ROTATIONS},
            "attach": {},
        }
        for i in range(spec["frames"]):
            result = spec["build"](i)
            rig.set_shadow_catcher(result["shadow"])
            entry["footprint"] = list(result["footprint"])
            for rot_label, yaw_deg in rig.ROTATIONS.items():
                result["root"].rotation_euler = (
                    0.0, 0.0, math.radians(yaw_deg))
                bpy.context.view_layer.update()
                fname = f"{name}__{rot_label}.{i}.png"
                scene.render.filepath = os.path.join(out_dir, fname)
                bpy.ops.render.render(write_still=True)
                entry["frames"][rot_label].append(fname)
                print(f"[render] {name} f{i} {rot_label} -> {fname}",
                      flush=True)
            props.clear_prop(result)
        meta["props"][name] = entry

    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    total = sum(len(v) for e in meta["props"].values()
                for v in e["frames"].values())
    print(f"[render] wrote {meta_path} ({len(meta['props'])} sprites, "
          f"{total} frames on disk)", flush=True)


if __name__ == "__main__":
    main()
