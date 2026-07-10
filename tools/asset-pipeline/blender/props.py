"""props.py — parametric office prop builders (pure bpy primitives +
bevel/solidify modifiers, flat-shaded materials from a shared warm palette).

Every builder returns a dict:
  root       — empty at world origin; rotate .rotation_euler.z for N/E/S/W
  footprint  — (w, d) in tiles
  shadow     — whether the ground shadow-catcher should render for this prop
  attach     — optional named world-space quads, e.g. desk monitor screen
               corners for the DOM tail overlay to anchor onto (the screen
               face is also UV-marked as its own "screen" material slot)

Conventions:
  1 unit = 1 tile = ~1 m. Props sit on z=0 (floor tiles live BELOW z=0 so
  the assembled scene keeps props flush on tile tops). Fronts face -Y ("S").
  Walls are authored hugging the tile's NORTH (+Y) edge.
"""

import math
import random

import bpy
from mathutils import Vector

from rig import hex_rgb

# ---------------------------------------------------------------- palette
# Shared warm night-office palette (sRGB hex, converted to linear).

PALETTE = {
    "floor_a":     "#8A705B",
    "floor_a_in":  "#94795F",
    "floor_b":     "#7C6450",
    "floor_b_in":  "#6F5946",
    "floor_c":     "#867059",
    "rug_teal":    "#2F6D62",
    "wall":        "#6B5F58",
    "wall_trim":   "#57493F",
    "wainscot":    "#7D5A3C",
    "wood_dark":   "#52381F",
    "wood":        "#875A39",
    "wood_light":  "#AE7A4F",
    "metal_dark":  "#3A3637",
    "metal":       "#6E6866",
    "fabric_teal": "#2F6D62",
    "fabric_warm": "#C77B4A",
    "cushion":     "#E0B98A",
    "plant_green": "#5B7A45",
    "plant_dark":  "#41602F",
    "terracotta":  "#B85C38",
    "screen_dark": "#10161B",
    "glass_night": "#16222E",
    "paper":       "#E8DCC8",
    "amber":       "#FFB454",
    "gold":        "#D8A24A",
    "board_white": "#EDE8DF",
    "crate":       "#A06034",
    "hazard":      "#D9A441",
    "note_amber":  "#F2C14E",
    "note_teal":   "#7FBFB0",
    "note_rose":   "#E88D8D",
}

BOOK_COLORS = ["#8A4B3B", "#3E5F6B", "#B08A4F", "#5B6E4E", "#7A5070",
               "#A3684A", "#4E6B5D", "#94513E"]

_mat_cache = {}


def mat(key, hex_str=None, roughness=0.85, metallic=0.0,
        emission=None, emission_strength=0.0):
    """Cached flat-shaded Principled material."""
    if key in _mat_cache:
        return _mat_cache[key]
    m = bpy.data.materials.new(key)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = hex_rgb(hex_str or PALETTE[key])
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = hex_rgb(emission)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    _mat_cache[key] = m
    return m


# ---------------------------------------------------------------- helpers

def _link(obj, root):
    obj.parent = root


def add_bevel(obj, width=0.012, segments=2):
    b = obj.modifiers.new("Bevel", "BEVEL")
    b.width = width
    b.segments = segments
    b.limit_method = "ANGLE"
    b.angle_limit = math.radians(40)
    return b


def box(root, name, sx, sy, sz, x=0.0, y=0.0, zb=0.0, material=None,
        bevel=0.012, rot_z=0.0):
    """Axis-aligned box; zb = bottom z. Scale is APPLIED so bevel width
    stays uniform in world units."""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(x, y, zb + sz / 2))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if rot_z:
        obj.rotation_euler.z = math.radians(rot_z)
    if material:
        obj.data.materials.append(material)
    if bevel:
        add_bevel(obj, bevel)
    _link(obj, root)
    return obj


def cyl(root, name, r, depth, x=0.0, y=0.0, zb=0.0, material=None,
        verts=24, bevel=0.008, r2=None):
    """Cylinder (or truncated cone when r2 given); zb = bottom z."""
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(
            radius=r, depth=depth, vertices=verts,
            location=(x, y, zb + depth / 2))
    else:
        bpy.ops.mesh.primitive_cone_add(
            radius1=r, radius2=r2, depth=depth, vertices=verts,
            location=(x, y, zb + depth / 2))
    obj = bpy.context.active_object
    obj.name = name
    if material:
        obj.data.materials.append(material)
    if bevel:
        add_bevel(obj, bevel)
    _link(obj, root)
    return obj


def ico(root, name, r, x=0.0, y=0.0, z=0.0, material=None, subdiv=1):
    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=subdiv, radius=r, location=(x, y, z))
    obj = bpy.context.active_object
    obj.name = name
    if material:
        obj.data.materials.append(material)
    _link(obj, root)
    return obj


def _root(name):
    root = bpy.data.objects.new(f"{name}_root", None)
    bpy.context.scene.collection.objects.link(root)
    return root


def _result(root, footprint=(1, 1), shadow=True, attach=None):
    return {"root": root, "footprint": footprint, "shadow": shadow,
            "attach": attach or {}}


# ---------------------------------------------------------------- floors
# Tiles live below z=0: top face flush at z=0. Minimal bevel so the
# diamond edge stays a clean 2:1 line for seamless tiling.

def build_floor_tile(name="floor_tile"):
    root = _root(name)
    box(root, "slab", 1.0, 1.0, 0.05, zb=-0.05,
        material=mat("floor_a"), bevel=0.004)
    box(root, "panel", 0.92, 0.92, 0.006, zb=0.0,
        material=mat("floor_a_in"), bevel=0.003)
    return _result(root, shadow=False)


def build_floor_tile_b(name="floor_tile_b"):
    root = _root(name)
    box(root, "slab", 1.0, 1.0, 0.05, zb=-0.05,
        material=mat("floor_b"), bevel=0.004)
    # two plank strips for a subtle direction read
    box(root, "plank1", 0.92, 0.44, 0.006, y=-0.24, zb=0.0,
        material=mat("floor_b_in"), bevel=0.003)
    box(root, "plank2", 0.92, 0.44, 0.006, y=0.24, zb=0.0,
        material=mat("floor_b_in"), bevel=0.003)
    return _result(root, shadow=False)


def build_floor_tile_c(name="floor_tile_c"):
    root = _root(name)
    box(root, "slab", 1.0, 1.0, 0.05, zb=-0.05,
        material=mat("floor_c"), bevel=0.004)
    box(root, "rug", 0.78, 0.78, 0.012, zb=0.0,
        material=mat("rug_teal"), bevel=0.006)
    box(root, "rug_in", 0.62, 0.62, 0.006, zb=0.012,
        material=mat("floor_c"), bevel=0.003)
    return _result(root, shadow=False)


# ---------------------------------------------------------------- walls
# Authored on the tile's NORTH (+Y) edge; rotations move the wall to the
# other edges. Height 1.5 (waist-high game walls read better in iso).

WALL_H = 1.5
WALL_T = 0.12


def _wall_run(root, prefix, along="x"):
    """One straight wall segment on the +Y edge (along X) or +X edge."""
    def seg(name, sx, sy, sz, x, y, zb, material, bevel=0.01):
        return box(root, f"{prefix}{name}", sx, sy, sz, x=x, y=y, zb=zb,
                   material=material, bevel=bevel)
    if along == "x":
        yc = 0.5 - WALL_T / 2
        seg("body", 1.0, WALL_T, WALL_H, 0, yc, 0, mat("wall"))
        seg("wainscot", 1.0, WALL_T + 0.02, 0.5, 0, yc, 0, mat("wainscot"))
        seg("base", 1.0, WALL_T + 0.04, 0.08, 0, yc, 0, mat("wall_trim"))
        # cap sits PROUD of the body top — coplanar tops z-fight
        seg("cap", 1.0, WALL_T + 0.03, 0.05, 0, yc, WALL_H - 0.03,
            mat("wall_trim"))
    else:
        xc = 0.5 - WALL_T / 2
        seg("body", WALL_T, 1.0, WALL_H, xc, 0, 0, mat("wall"))
        seg("wainscot", WALL_T + 0.02, 1.0, 0.5, xc, 0, 0, mat("wainscot"))
        seg("base", WALL_T + 0.04, 1.0, 0.08, xc, 0, 0, mat("wall_trim"))
        seg("cap", WALL_T + 0.03, 1.0, 0.05, xc, 0, WALL_H - 0.03,
            mat("wall_trim"))


def build_wall_straight(name="wall_straight"):
    root = _root(name)
    _wall_run(root, "w_", along="x")
    return _result(root)


def build_wall_corner(name="wall_corner"):
    root = _root(name)
    _wall_run(root, "wx_", along="x")
    _wall_run(root, "wy_", along="y")
    return _result(root)


def build_wall_window(name="wall_window"):
    """Straight wall with a night window — composed from segments (no
    booleans): piers left/right, sill band below, header above, night
    glass with warm mullions."""
    root = _root(name)
    yc = 0.5 - WALL_T / 2
    win_w, win_lo, win_hi = 0.56, 0.55, 1.25
    pier_w = (1.0 - win_w) / 2
    # piers
    box(root, "pier_l", pier_w, WALL_T, WALL_H, x=-(win_w + pier_w) / 2,
        y=yc, zb=0, material=mat("wall"))
    box(root, "pier_r", pier_w, WALL_T, WALL_H, x=(win_w + pier_w) / 2,
        y=yc, zb=0, material=mat("wall"))
    # bands
    box(root, "sill_band", win_w, WALL_T, win_lo, x=0, y=yc, zb=0,
        material=mat("wall"))
    box(root, "header", win_w, WALL_T, WALL_H - win_hi, x=0, y=yc,
        zb=win_hi, material=mat("wall"))
    # trims shared with plain wall
    box(root, "wainscot", 1.0, WALL_T + 0.02, 0.5, y=yc, zb=0,
        material=mat("wainscot"))
    box(root, "base", 1.0, WALL_T + 0.04, 0.08, y=yc, zb=0,
        material=mat("wall_trim"))
    box(root, "cap", 1.0, WALL_T + 0.03, 0.05, y=yc, zb=WALL_H - 0.03,
        material=mat("wall_trim"))
    # window frame as BORDER strips (a filled box would occlude the
    # glass) + night glass slightly proud of the wall faces
    ft = 0.035
    box(root, "frame_top", win_w + 2 * ft, WALL_T + 0.02, ft, x=0, y=yc,
        zb=win_hi, material=mat("wood_dark"), bevel=0.006)
    box(root, "frame_bot", win_w + 2 * ft, WALL_T + 0.02, ft, x=0, y=yc,
        zb=win_lo - ft, material=mat("wood_dark"), bevel=0.006)
    box(root, "frame_l", ft, WALL_T + 0.02, win_hi - win_lo,
        x=-(win_w + ft) / 2, y=yc, zb=win_lo, material=mat("wood_dark"),
        bevel=0.006)
    box(root, "frame_r", ft, WALL_T + 0.02, win_hi - win_lo,
        x=(win_w + ft) / 2, y=yc, zb=win_lo, material=mat("wood_dark"),
        bevel=0.006)
    glass = mat("glass_night", emission="#274E6B", emission_strength=1.1)
    box(root, "glass", win_w, WALL_T + 0.01, win_hi - win_lo,
        x=0, y=yc, zb=win_lo, material=glass, bevel=0)
    box(root, "mullion_v", 0.03, WALL_T + 0.03, win_hi - win_lo, x=0, y=yc,
        zb=win_lo, material=mat("wood_dark"), bevel=0.004)
    box(root, "mullion_h", win_w, WALL_T + 0.03, 0.03, x=0, y=yc,
        zb=(win_lo + win_hi) / 2 - 0.015, material=mat("wood_dark"),
        bevel=0.004)
    # sill ledge
    box(root, "sill", win_w + 0.1, WALL_T + 0.06, 0.035, x=0, y=yc - 0.01,
        zb=win_lo - 0.035, material=mat("wood"))
    return _result(root)


# ---------------------------------------------------------------- desk

def build_desk_monitor(name="desk_monitor"):
    """Desk + monitor. The monitor screen face is its own UV-marked
    material slot AND its 4 corners are exported as attach['screen'] so
    the DOM tail overlay can anchor onto it."""
    root = _root(name)
    top_z = 0.72
    # slab legs + top + modesty panel
    box(root, "top", 1.0, 0.56, 0.045, zb=top_z, material=mat("wood"))
    box(root, "leg_l", 0.05, 0.5, top_z, x=-0.45, zb=0,
        material=mat("wood_dark"))
    box(root, "leg_r", 0.05, 0.5, top_z, x=0.45, zb=0,
        material=mat("wood_dark"))
    box(root, "modesty", 0.88, 0.03, 0.34, y=0.2, zb=0.3,
        material=mat("wood_dark"))
    # monitor: stand + panel + proud screen face (front faces -Y)
    mz = top_z + 0.045
    box(root, "mon_foot", 0.2, 0.14, 0.02, x=0.08, y=0.12, zb=mz,
        material=mat("metal_dark"))
    box(root, "mon_stem", 0.035, 0.035, 0.14, x=0.08, y=0.13, zb=mz + 0.02,
        material=mat("metal_dark"))
    box(root, "mon_panel", 0.46, 0.035, 0.28, x=0.08, y=0.14,
        zb=mz + 0.13, material=mat("metal_dark"))
    screen_mat = mat("screen", hex_str=PALETTE["screen_dark"],
                     roughness=0.35, emission="#33545F",
                     emission_strength=2.4)
    scr = box(root, "mon_screen", 0.42, 0.006, 0.24, x=0.08, y=0.1205,
              zb=mz + 0.15, material=screen_mat, bevel=0)
    # UV-mark the screen: smart-project so the face carries clean UVs
    bpy.context.view_layer.objects.active = scr
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66))
    bpy.ops.object.mode_set(mode="OBJECT")
    # screen quad corners, world space (front face, y = panel front)
    sx0, sx1 = 0.08 - 0.21, 0.08 + 0.21
    sz0, sz1 = mz + 0.15, mz + 0.15 + 0.24
    sy = 0.1205 - 0.003
    screen_quad = [
        (sx0, sy, sz1), (sx1, sy, sz1),  # top-left, top-right
        (sx1, sy, sz0), (sx0, sy, sz0),  # bottom-right, bottom-left
    ]
    # charm: keyboard, mug, paper stack
    box(root, "keyboard", 0.3, 0.11, 0.02, x=0.02, y=-0.08, zb=mz,
        material=mat("metal"), bevel=0.006)
    cyl(root, "mug", 0.035, 0.07, x=-0.33, y=-0.02, zb=mz,
        material=mat("fabric_teal"), verts=16)
    box(root, "papers", 0.16, 0.2, 0.02, x=0.36, y=-0.08, zb=mz,
        material=mat("paper"), bevel=0.004, rot_z=8)
    # warm desk lamp
    cyl(root, "lamp_base", 0.05, 0.02, x=-0.38, y=0.16, zb=mz,
        material=mat("metal_dark"), verts=16)
    box(root, "lamp_arm", 0.02, 0.02, 0.2, x=-0.38, y=0.16, zb=mz + 0.02,
        material=mat("metal_dark"), bevel=0.004)
    lamp_mat = mat("lamp_glow", hex_str=PALETTE["amber"],
                   emission=PALETTE["amber"], emission_strength=7.0)
    box(root, "lamp_head", 0.1, 0.06, 0.045, x=-0.36, y=0.13, zb=mz + 0.2,
        material=lamp_mat, bevel=0.008)
    return _result(root, attach={"screen": screen_quad})


# ---------------------------------------------------------------- seating

def build_office_chair(name="office_chair"):
    root = _root(name)
    # 5-star base
    for i in range(5):
        a = math.radians(i * 72 + 18)
        r = 0.16
        box(root, f"leg{i}", 0.24, 0.045, 0.03,
            x=r * math.cos(a), y=r * math.sin(a), zb=0.015,
            material=mat("metal_dark"), bevel=0.006,
            rot_z=math.degrees(a))
        ico(root, f"caster{i}", 0.025,
            x=0.27 * math.cos(a), y=0.27 * math.sin(a), z=0.025,
            material=mat("metal_dark"))
    cyl(root, "column", 0.03, 0.28, zb=0.03, material=mat("metal"), verts=16)
    box(root, "seat", 0.4, 0.4, 0.09, zb=0.31, material=mat("fabric_teal"),
        bevel=0.025)
    box(root, "back", 0.38, 0.06, 0.42, y=0.19, zb=0.42,
        material=mat("fabric_teal"), bevel=0.025)
    return _result(root)


def build_sofa(name="sofa"):
    root = _root(name)
    # 2-tile-wide couch, front faces -Y
    box(root, "base", 1.6, 0.72, 0.28, zb=0.08, material=mat("fabric_teal"),
        bevel=0.03)
    for i, x in enumerate((-0.4, 0.4)):
        box(root, f"cushion{i}", 0.72, 0.6, 0.1, x=x, y=-0.04, zb=0.36,
            material=mat("cushion"), bevel=0.035)
    box(root, "backrest", 1.6, 0.18, 0.42, y=0.27, zb=0.36,
        material=mat("fabric_teal"), bevel=0.035)
    for i, x in enumerate((-0.86, 0.86)):
        box(root, f"arm{i}", 0.12, 0.72, 0.5, x=x, zb=0.08,
            material=mat("fabric_teal"), bevel=0.035)
    for i, (x, y) in enumerate(((-0.7, -0.3), (0.7, -0.3),
                                (-0.7, 0.3), (0.7, 0.3))):
        cyl(root, f"foot{i}", 0.025, 0.08, x=x, y=y, zb=0,
            material=mat("wood_dark"), verts=12)
    # throw pillow
    box(root, "pillow", 0.22, 0.1, 0.22, x=-0.6, y=0.16, zb=0.42,
        material=mat("fabric_warm"), bevel=0.05, rot_z=12)
    return _result(root, footprint=(2, 1))


# ---------------------------------------------------------------- storage

def build_bookshelf(name="bookshelf"):
    root = _root(name)
    w, d, h, t = 0.9, 0.3, 1.8, 0.03
    box(root, "side_l", t, d, h, x=-(w - t) / 2, zb=0, material=mat("wood"))
    box(root, "side_r", t, d, h, x=(w - t) / 2, zb=0, material=mat("wood"))
    box(root, "back", w, 0.02, h, y=d / 2 - 0.01, zb=0,
        material=mat("wood_dark"), bevel=0.006)
    box(root, "top", w, d, t, zb=h - t, material=mat("wood"))
    rng = random.Random(42)
    for si, sz in enumerate((0.0, 0.44, 0.88, 1.32)):
        box(root, f"shelf{si}", w - 2 * t, d, t, zb=sz, material=mat("wood"))
        # books: deterministic row of varied spines
        x = -(w / 2) + t + 0.02
        while x < (w / 2) - t - 0.05:
            bw = rng.uniform(0.03, 0.06)
            bh = rng.uniform(0.16, 0.28)
            col = BOOK_COLORS[rng.randrange(len(BOOK_COLORS))]
            lean = 0 if rng.random() > 0.15 else rng.uniform(-8, 8)
            box(root, f"book{si}_{x:.2f}", bw, 0.2, bh, x=x + bw / 2,
                y=0.0, zb=sz + t, material=mat(f"book_{col}", hex_str=col),
                bevel=0.004, rot_z=lean)
            x += bw + rng.uniform(0.002, 0.02)
            if rng.random() < 0.12:
                x += 0.06  # gap
    return _result(root)


def build_filing_cabinet(name="filing_cabinet"):
    root = _root(name)
    w, d, h = 0.46, 0.5, 1.25
    box(root, "body", w, d, h, zb=0, material=mat("metal"))
    for i in range(3):
        zb = 0.08 + i * (h - 0.14) / 3
        box(root, f"drawer{i}", w - 0.06, 0.03, (h - 0.2) / 3 - 0.03,
            y=-d / 2, zb=zb, material=mat("metal_dark"), bevel=0.008)
        box(root, f"handle{i}", 0.14, 0.025, 0.03, y=-d / 2 - 0.02,
            zb=zb + (h - 0.2) / 6 - 0.02, material=mat("gold"), bevel=0.006)
    # charm: trailing plant on top
    cyl(root, "pot", 0.07, 0.09, x=0.1, y=0.08, zb=h, r2=0.055,
        material=mat("terracotta"), verts=16)
    ico(root, "leaves", 0.09, x=0.1, y=0.08, z=h + 0.13,
        material=mat("plant_green"))
    return _result(root)


# ---------------------------------------------------------------- greenery

def build_plant(name="plant"):
    root = _root(name)
    pot = cyl(root, "pot", 0.16, 0.28, zb=0, r2=0.12,
              material=mat("terracotta"), verts=20, bevel=0.01)
    # solidify gives the pot a visible rim lip
    s = pot.modifiers.new("Solidify", "SOLIDIFY")
    s.thickness = 0.02
    cyl(root, "soil", 0.13, 0.03, zb=0.25, material=mat("wood_dark"),
        verts=16, bevel=0)
    cyl(root, "trunk", 0.025, 0.35, zb=0.28, material=mat("wood_dark"),
        verts=10, bevel=0)
    # low-poly foliage cluster (flat-shaded icospheres)
    for (x, y, z, r, m) in (
        (0.0, 0.0, 0.78, 0.22, "plant_green"),
        (-0.14, 0.06, 0.62, 0.16, "plant_dark"),
        (0.13, -0.05, 0.66, 0.15, "plant_green"),
        (0.02, 0.13, 0.6, 0.13, "plant_dark"),
        (-0.04, -0.12, 0.58, 0.12, "plant_green"),
    ):
        ico(root, f"leaf_{x}_{y}", r, x=x, y=y, z=z, material=mat(m))
    return _result(root)


# ---------------------------------------------------------------- break area

def build_coffee_station(name="coffee_station"):
    root = _root(name)
    # counter cabinet + top
    box(root, "cabinet", 0.9, 0.5, 0.82, zb=0, material=mat("wood"))
    box(root, "counter", 0.98, 0.56, 0.05, zb=0.82,
        material=mat("wood_dark"))
    box(root, "door_l", 0.4, 0.02, 0.66, x=-0.22, y=-0.25, zb=0.08,
        material=mat("wood_light"), bevel=0.008)
    box(root, "door_r", 0.4, 0.02, 0.66, x=0.22, y=-0.25, zb=0.08,
        material=mat("wood_light"), bevel=0.008)
    # coffee machine with warm brew light
    box(root, "machine", 0.26, 0.3, 0.34, x=-0.24, y=0.05, zb=0.87,
        material=mat("metal_dark"))
    box(root, "machine_head", 0.2, 0.24, 0.08, x=-0.24, y=0.02, zb=1.13,
        material=mat("metal"))
    glow = mat("brew_glow", hex_str=PALETTE["amber"],
               emission=PALETTE["amber"], emission_strength=3.0)
    box(root, "brew_light", 0.05, 0.02, 0.03, x=-0.24, y=-0.11, zb=1.05,
        material=glow, bevel=0)
    cyl(root, "carafe", 0.06, 0.12, x=-0.24, y=0.02, zb=0.87,
        material=mat("screen_dark"), verts=16)
    # mugs + kettle
    for i, (x, y, c) in enumerate(((0.1, -0.1, "fabric_teal"),
                                   (0.22, 0.02, "fabric_warm"),
                                   (0.33, -0.13, "paper"))):
        cyl(root, f"mug{i}", 0.035, 0.07, x=x, y=y, zb=0.87,
            material=mat(c), verts=14)
    cyl(root, "kettle", 0.075, 0.13, x=0.28, y=0.14, zb=0.87, r2=0.055,
        material=mat("metal"), verts=18)
    return _result(root)


# ---------------------------------------------------------------- game props

def build_rework_bin(name="rework_bin"):
    """Scrap & Rework Bin — slatted crate where failed dispatches pile up."""
    root = _root(name)
    w, h = 0.8, 0.5
    # corner posts
    for (x, y) in ((-w / 2 + 0.04, -w / 2 + 0.04), (w / 2 - 0.04, -w / 2 + 0.04),
                   (-w / 2 + 0.04, w / 2 - 0.04), (w / 2 - 0.04, w / 2 - 0.04)):
        box(root, f"post_{x}_{y}", 0.07, 0.07, h, x=x, y=y, zb=0,
            material=mat("wood_dark"), bevel=0.008)
    # slats on all four sides
    for zi, zb in enumerate((0.05, 0.21, 0.37)):
        box(root, f"slat_s{zi}", w, 0.04, 0.1, y=-w / 2 + 0.02, zb=zb,
            material=mat("crate"), bevel=0.008)
        box(root, f"slat_n{zi}", w, 0.04, 0.1, y=w / 2 - 0.02, zb=zb,
            material=mat("crate"), bevel=0.008)
        box(root, f"slat_w{zi}", 0.04, w, 0.1, x=-w / 2 + 0.02, zb=zb,
            material=mat("crate"), bevel=0.008)
        box(root, f"slat_e{zi}", 0.04, w, 0.1, x=w / 2 - 0.02, zb=zb,
            material=mat("crate"), bevel=0.008)
    box(root, "floorboard", w - 0.1, w - 0.1, 0.04, zb=0.02,
        material=mat("wood_dark"), bevel=0)
    # hazard band on the front slat
    box(root, "hazard", 0.3, 0.045, 0.08, y=-w / 2 + 0.02, zb=0.22,
        material=mat("hazard"), bevel=0.006)
    # scrap paper poking above the rim
    rng = random.Random(7)
    for i in range(5):
        box(root, f"scrap{i}", 0.16, 0.2, 0.02,
            x=rng.uniform(-0.2, 0.2), y=rng.uniform(-0.2, 0.2),
            zb=0.42 + i * 0.015, material=mat("paper"), bevel=0.004,
            rot_z=rng.uniform(-40, 40))
    return _result(root)


def build_trophy_shelf(name="trophy_shelf"):
    """Trophy Vault display — merged PRs live here as engraved trophies."""
    root = _root(name)
    w, d = 1.0, 0.34
    box(root, "base", w, d, 0.1, zb=0, material=mat("wood_dark"))
    box(root, "top", w, d, 0.04, zb=1.06, material=mat("wood_dark"))
    box(root, "side_l", 0.04, d, 0.96, x=-(w - 0.04) / 2, zb=0.1,
        material=mat("wood"))
    box(root, "side_r", 0.04, d, 0.96, x=(w - 0.04) / 2, zb=0.1,
        material=mat("wood"))
    box(root, "back", w, 0.02, 0.96, y=d / 2 - 0.01, zb=0.1,
        material=mat("wood"), bevel=0.006)
    box(root, "shelf_mid", w - 0.08, d, 0.03, zb=0.56, material=mat("wood"))
    gold = mat("gold", roughness=0.3, metallic=0.85)
    spots = ((-0.3, 0.1), (0.02, 0.1), (0.32, 0.1),
             (-0.18, 0.585), (0.18, 0.585))
    for i, (x, zb) in enumerate(spots):
        cyl(root, f"t{i}_base", 0.06, 0.03, x=x, y=-0.02, zb=zb,
            material=mat("wood_dark"), verts=14)
        cyl(root, f"t{i}_stem", 0.015, 0.06, x=x, y=-0.02, zb=zb + 0.03,
            material=gold, verts=10, bevel=0)
        cyl(root, f"t{i}_cup", 0.028, 0.08, x=x, y=-0.02, zb=zb + 0.09,
            r2=0.055, material=gold, verts=14, bevel=0)
    # one shelf spot intentionally empty — the next trophy's home
    return _result(root)


def build_whiteboard(name="whiteboard"):
    root = _root(name)
    bz0, bz1, bw = 0.75, 1.5, 1.1
    # A-frame legs
    for side, x in ((-1, -0.5), (1, 0.5)):
        box(root, f"legf_{side}", 0.05, 0.05, 1.5, x=x, y=-0.14, zb=0,
            material=mat("metal_dark"), rot_z=0)
        box(root, f"legb_{side}", 0.05, 0.05, 1.5, x=x, y=0.14, zb=0,
            material=mat("metal_dark"))
        box(root, f"legx_{side}", 0.05, 0.32, 0.05, x=x, zb=0.4,
            material=mat("metal_dark"))
    # board + frame + tray
    box(root, "frame", bw + 0.06, 0.05, bz1 - bz0 + 0.06, zb=bz0 - 0.03,
        material=mat("metal_dark"))
    board = mat("board_white", roughness=0.4)
    box(root, "board", bw, 0.06, bz1 - bz0, y=-0.003, zb=bz0,
        material=board, bevel=0.006)
    box(root, "tray", bw * 0.7, 0.1, 0.03, y=-0.06, zb=bz0 - 0.06,
        material=mat("metal"), bevel=0.006)
    # sticky notes + marker strokes (front face, -Y side)
    rng = random.Random(11)
    for i, c in enumerate(("note_amber", "note_teal", "note_rose",
                           "note_amber", "note_teal")):
        box(root, f"note{i}", 0.09, 0.012, 0.09,
            x=rng.uniform(-0.42, 0.42), y=-0.033,
            zb=rng.uniform(bz0 + 0.1, bz1 - 0.16),
            material=mat(c), bevel=0, rot_z=rng.uniform(-6, 6))
    for i in range(3):
        box(root, f"stroke{i}", rng.uniform(0.2, 0.5), 0.008, 0.018,
            x=rng.uniform(-0.25, 0.25), y=-0.031,
            zb=rng.uniform(bz0 + 0.08, bz1 - 0.1),
            material=mat("screen_dark"), bevel=0)
    # markers on tray
    for i, c in enumerate(("fabric_teal", "terracotta")):
        cyl(root, f"marker{i}", 0.012, 0.11, x=-0.15 + i * 0.12, y=-0.06,
            zb=bz0 - 0.045, material=mat(c), verts=10, bevel=0)
    return _result(root)


# ---------------------------------------------------------------- registry

BUILDERS = {
    "floor_tile": build_floor_tile,
    "floor_tile_b": build_floor_tile_b,
    "floor_tile_c": build_floor_tile_c,
    "wall_straight": build_wall_straight,
    "wall_corner": build_wall_corner,
    "wall_window": build_wall_window,
    "desk_monitor": build_desk_monitor,
    "office_chair": build_office_chair,
    "plant": build_plant,
    "bookshelf": build_bookshelf,
    "sofa": build_sofa,
    "coffee_station": build_coffee_station,
    "filing_cabinet": build_filing_cabinet,
    "rework_bin": build_rework_bin,
    "trophy_shelf": build_trophy_shelf,
    "whiteboard": build_whiteboard,
}


def build(name):
    if name not in BUILDERS:
        raise KeyError(f"unknown prop: {name} (have {sorted(BUILDERS)})")
    return BUILDERS[name](name)


def clear_prop(result):
    """Delete a built prop's objects (root empty + children)."""
    objs = [result["root"]] + list(result["root"].children_recursive)
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
