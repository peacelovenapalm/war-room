"""render_props.py — headless entry point: build each prop, render it at
4 rotations (N/E/S/W as the iso camera sees them) to alpha PNGs, and
write out/raw/meta.json (anchor px, attach quads, footprints) for pack.py.

Usage:
  <blender> -b -P render_props.py -- --out out/raw [--props a,b,c]
                                     [--samples 96]
"""

import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import rig  # noqa: E402
import props  # noqa: E402


def parse_args():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--props", default="all",
                   help="comma-separated prop names, or 'all'")
    p.add_argument("--samples", type=int, default=96)
    return p.parse_args(argv)


def main():
    args = parse_args()
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)

    names = (sorted(props.BUILDERS) if args.props == "all"
             else [n.strip() for n in args.props.split(",") if n.strip()])

    scene = rig.build_scene(samples=args.samples)

    # The floor-contact anchor: world origin projected into render px.
    # Camera is static, so this is identical for every prop and rotation.
    anchor_px = rig.project_px(scene, (0.0, 0.0, 0.0))

    meta = {
        "scale": rig.RENDER_SCALE,
        "tile_px": rig.TILE_PX,
        "canvas": [scene.render.resolution_x, scene.render.resolution_y],
        "anchor_px": [anchor_px[0], anchor_px[1]],
        "rotations": list(rig.ROTATIONS),
        "props": {},
    }

    # Partial renders must MERGE into an existing meta.json — clobbering
    # sibling prop entries desyncs the manifest from the PNGs on disk.
    meta_path = os.path.join(out_dir, "meta.json")
    if os.path.exists(meta_path):
        with open(meta_path) as f:
            prev = json.load(f)
        if (prev.get("scale") == meta["scale"]
                and prev.get("canvas") == meta["canvas"]
                and prev.get("anchor_px") == meta["anchor_px"]):
            meta["props"] = prev.get("props", {})

    for name in names:
        result = props.build(name)
        rig.set_shadow_catcher(result["shadow"])
        entry = {
            "footprint": list(result["footprint"]),
            "frames": {},
            "attach": {},
        }
        for rot_label, yaw_deg in rig.ROTATIONS.items():
            yaw = math.radians(yaw_deg)
            result["root"].rotation_euler = (0.0, 0.0, yaw)
            bpy.context.view_layer.update()

            fname = f"{name}__{rot_label}.png"
            scene.render.filepath = os.path.join(out_dir, fname)
            bpy.ops.render.render(write_still=True)
            entry["frames"][rot_label] = fname

            # project attach quads (rotate authored world coords by yaw)
            if result["attach"]:
                rot_m = Matrix.Rotation(yaw, 4, "Z")
                for aname, quad in result["attach"].items():
                    pts = [rig.project_px(scene, rot_m @ Vector(p))
                           for p in quad]
                    entry["attach"].setdefault(aname, {})[rot_label] = [
                        [px, py] for (px, py) in pts]
            print(f"[render] {name} {rot_label} -> {fname}", flush=True)

        meta["props"][name] = entry
        props.clear_prop(result)

    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"[render] wrote {meta_path} ({len(names)} props x "
          f"{len(rig.ROTATIONS)} rotations)", flush=True)


if __name__ == "__main__":
    main()
