"""characters.py — parametric low-poly staff + pets for the Living Studio.

One stylized person model (capsule-ish limbs, ico-sphere head, no face —
it reads by silhouette + outfit color at 128px-tile scale), posed by
DIRECT TRANSFORM: every joint is an empty; poses are plain dicts of
joint angles. No armatures — deterministic under headless bpy, nothing
to bake, nothing to desync.

Skeleton (front faces -Y = "S", same convention as props.py):

  root ── pelvis, hip_l/r ─ knee_l/r          (legs)
       └─ spine ─ torso, shoulder_l/r ─ elbow_l/r, neck ─ head_j ─ head

Angle conventions (all degrees, forward-positive where sensible):
  hip / shoulder  swing forward (-Y) positive
  knee            bend backward positive
  elbow           bend forward positive
  sho_out         raise arm sideways-up positive (abduction)
  spine / head    pitch forward/down positive

Sprites (name -> frames x rotations):
  worker_<outfit>.walk     4-frame walk cycle (contact/pass/contact/pass)
  worker_<outfit>.sit      seated (chair seat top = 0.40, chair drawn by WS-A)
  worker_<outfit>.type     2-frame seated typing (alternating forearms)
  worker_<outfit>.blocked  standing, head down, right hand raised
  cat.curl                 curled sleeping cat (1 frame)
  cat.walk                 2-frame cat walk (diagonal leg pairs)
"""

import math

import bpy

from props import mat, add_bevel, _root, _result

# ---------------------------------------------------------------- outfits
# Palette-varied identities: shirt / trousers / skin / hair (+ hair style).

OUTFITS = {
    "worker_teal": {
        "shirt": "#2F6D62", "trousers": "#3A3637", "skin": "#E8B48C",
        "hair": "#3B2E24", "style": "blob",
    },
    "worker_rust": {
        "shirt": "#C77B4A", "trousers": "#52381F", "skin": "#C68B62",
        "hair": "#1F1A16", "style": "bun",
    },
    "worker_slate": {
        "shirt": "#4A5E74", "trousers": "#2E2A28", "skin": "#8C5A3C",
        "hair": "#141210", "style": "cap",
    },
    "worker_moss": {
        "shirt": "#5B7A45", "trousers": "#4A4034", "skin": "#6B4630",
        "hair": "#2A2018", "style": "buzz",
    },
}

CAP_COLOR = "#B85C38"      # terracotta cap for the "cap" hair style
SHOE_COLOR = "#2A2422"
CAT_BODY = "#B96F42"       # amber tabby
CAT_DARK = "#7E4A28"
CAT_CREAM = "#E8D5B0"

# ---------------------------------------------------------------- skeleton
# 1 unit = 1 tile = ~1 m. Standing height ~1.5 (slightly chibi — reads
# better at 128px tiles). Desk top is 0.72; seated eye line ~1.0.

HIP_Z = 0.60
HIP_X = 0.10
U_LEG = 0.28
L_LEG = 0.26
FOOT_H = 0.06
SPINE_Z = 0.70
SHO_X = 0.20
SHO_UP = 0.38          # shoulder height above spine joint
U_ARM = 0.24
L_ARM = 0.20
SEAT_DROP = -0.13      # root z-offset so pelvis bottom sits at seat 0.40


# ---------------------------------------------------------------- helpers
# Parented-part helpers (props.py's box/cyl place at WORLD coords under a
# flat root; characters need locals under nested joint empties).

def _finish(obj, parent, loc, material, bevel, rot):
    obj.parent = parent
    obj.location = loc
    if rot != (0.0, 0.0, 0.0):
        obj.rotation_euler = tuple(math.radians(a) for a in rot)
    if material:
        obj.data.materials.append(material)
    if bevel:
        add_bevel(obj, bevel)
    return obj


def jnt(parent, name, loc):
    """Joint empty; rotate .rotation_euler to pose everything under it."""
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    e.location = loc
    return e


def part_box(parent, name, sx, sy, sz, loc=(0, 0, 0), material=None,
             bevel=0.02, rot=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(obj, parent, loc, material, bevel, rot)


def part_cyl(parent, name, r, depth, loc=(0, 0, 0), material=None,
             verts=14, bevel=0.01, r2=None, rot=(0.0, 0.0, 0.0)):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(
            radius=r, depth=depth, vertices=verts, location=(0, 0, 0))
    else:
        bpy.ops.mesh.primitive_cone_add(
            radius1=r, radius2=r2, depth=depth, vertices=verts,
            location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = name
    return _finish(obj, parent, loc, material, bevel, rot)


def part_ico(parent, name, r, loc=(0, 0, 0), material=None, subdiv=2,
             scale=None):
    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=subdiv, radius=r, location=(0, 0, 0))
    obj = bpy.context.active_object
    obj.name = name
    if scale:
        obj.scale = scale
    return _finish(obj, parent, loc, material, None, (0.0, 0.0, 0.0))


# ---------------------------------------------------------------- poses

def pose(**kw):
    p = dict(root_z=0.0, bob=0.0, spine=0.0, head=0.0,
             l_hip=0.0, r_hip=0.0, l_knee=0.0, r_knee=0.0,
             l_sho=0.0, r_sho=0.0, l_sho_out=0.0, r_sho_out=0.0,
             l_elb=12.0, r_elb=12.0)
    p.update(kw)
    return p


def walk_pose(i):
    """4-frame cycle: contact-L, pass (R swings through), contact-R, pass."""
    contact = dict(l_hip=26, l_knee=5, r_hip=-20, r_knee=38,
                   l_sho=-15, r_sho=17, l_elb=12, r_elb=24, bob=0.0)
    passing = dict(l_hip=-2, l_knee=3, r_hip=14, r_knee=62,
                   l_sho=3, r_sho=-3, l_elb=14, r_elb=16, bob=0.035)
    frames = [contact, passing, _mirror(contact), _mirror(passing)]
    return pose(**frames[i % 4])


def _mirror(p):
    m = dict(p)
    for a, b in (("l_hip", "r_hip"), ("l_knee", "r_knee"),
                 ("l_sho", "r_sho"), ("l_elb", "r_elb"),
                 ("l_sho_out", "r_sho_out")):
        m[a], m[b] = p.get(b, 0.0), p.get(a, 0.0)
    return m


def sit_pose():
    return pose(root_z=SEAT_DROP, l_hip=65, r_hip=65, l_knee=62, r_knee=62,
                spine=4, head=3, l_sho=12, r_sho=12, l_elb=24, r_elb=24)


def type_pose(i):
    base = sit_pose()
    base.update(head=9, l_sho=35, r_sho=35)
    base.update((dict(l_elb=54, r_elb=40), dict(l_elb=40, r_elb=54))[i % 2])
    return base


def blocked_pose():
    """Head down, right hand raised — the universal 'I am blocked'."""
    return pose(head=24, spine=6, l_hip=4, r_hip=-4,
                l_sho=3, l_elb=10, r_sho=0, r_sho_out=158, r_elb=18)


# ---------------------------------------------------------------- person

def build_worker(name, outfit_key, p):
    o = OUTFITS[outfit_key]
    shirt = mat(f"shirt_{outfit_key}", hex_str=o["shirt"])
    trousers = mat(f"trousers_{outfit_key}", hex_str=o["trousers"])
    skin = mat(f"skin_{outfit_key}", hex_str=o["skin"], roughness=0.7)
    hair = mat(f"hair_{outfit_key}", hex_str=o["hair"])
    shoes = mat("shoes", hex_str=SHOE_COLOR)

    root = _root(name)
    root.location.z = p["root_z"] + p["bob"]

    # pelvis
    part_box(root, "pelvis", 0.32, 0.21, 0.18, loc=(0, 0, 0.62),
             material=trousers, bevel=0.05)

    # legs: hip -> upper leg -> knee -> lower leg + foot
    for side, sx in (("l", 1.0), ("r", -1.0)):
        hip = jnt(root, f"hip_{side}", (sx * HIP_X, 0, HIP_Z))
        hip.rotation_euler.x = -math.radians(p[f"{side}_hip"])
        part_cyl(hip, f"uleg_{side}", 0.062, U_LEG, loc=(0, 0, -U_LEG / 2),
                 material=trousers, bevel=0.015)
        knee = jnt(hip, f"knee_{side}", (0, 0, -U_LEG))
        knee.rotation_euler.x = math.radians(p[f"{side}_knee"])
        part_cyl(knee, f"lleg_{side}", 0.055, L_LEG, loc=(0, 0, -L_LEG / 2),
                 material=trousers, bevel=0.012)
        part_box(knee, f"foot_{side}", 0.11, 0.19, FOOT_H,
                 loc=(0, -0.045, -L_LEG - FOOT_H / 2), material=shoes,
                 bevel=0.02)

    # spine group: torso + arms + head all pitch together
    spine = jnt(root, "spine", (0, 0, SPINE_Z))
    spine.rotation_euler.x = math.radians(p["spine"])
    part_box(spine, "torso", 0.34, 0.23, 0.42, loc=(0, 0, 0.22),
             material=shirt, bevel=0.07)

    # arms: shoulder -> upper arm (sleeve) -> elbow -> forearm + hand
    for side, sx in (("l", 1.0), ("r", -1.0)):
        sho = jnt(spine, f"sho_{side}", (sx * SHO_X, 0, SHO_UP))
        out = 6.0 + p[f"{side}_sho_out"]          # rest abduction 6deg
        sho.rotation_euler = (
            -math.radians(p[f"{side}_sho"]),
            -sx * math.radians(out),
            0.0,
        )
        part_cyl(sho, f"uarm_{side}", 0.052, U_ARM, loc=(0, 0, -U_ARM / 2),
                 material=shirt, bevel=0.012)
        elb = jnt(sho, f"elb_{side}", (0, 0, -U_ARM))
        elb.rotation_euler.x = -math.radians(p[f"{side}_elb"])
        part_cyl(elb, f"larm_{side}", 0.045, L_ARM, loc=(0, 0, -L_ARM / 2),
                 material=skin, bevel=0.01)
        part_ico(elb, f"hand_{side}", 0.055, loc=(0, 0, -L_ARM - 0.02),
                 material=skin, subdiv=1)

    # neck + head (nod pivot at neck top)
    part_cyl(spine, "neck", 0.05, 0.08, loc=(0, 0, 0.45), material=skin,
             bevel=0)
    head_j = jnt(spine, "head_j", (0, 0, 0.50))
    head_j.rotation_euler.x = math.radians(p["head"])
    part_ico(head_j, "head", 0.16, loc=(0, 0, 0.12), material=skin)

    # hair styles (cheap identity — silhouette varies per outfit)
    style = o["style"]
    if style in ("blob", "bun", "buzz"):
        squash = 0.62 if style == "buzz" else 0.78
        part_ico(head_j, "hair", 0.165, loc=(0, 0.03, 0.155),
                 material=hair, scale=(1.02, 1.0, squash))
    if style == "bun":
        part_ico(head_j, "bun", 0.055, loc=(0, 0.15, 0.20), material=hair,
                 subdiv=1)
    if style == "cap":
        cap = mat("cap", hex_str=CAP_COLOR)
        part_cyl(head_j, "cap_crown", 0.155, 0.10, loc=(0, 0.015, 0.225),
                 material=cap, verts=18, bevel=0.02)
        part_box(head_j, "cap_brim", 0.18, 0.13, 0.02,
                 loc=(0, -0.155, 0.19), material=cap, bevel=0.008)

    return _result(root)


# ---------------------------------------------------------------- cat

def build_cat_walk(name, i):
    body = mat("cat_body", hex_str=CAT_BODY)
    dark = mat("cat_dark", hex_str=CAT_DARK)
    cream = mat("cat_cream", hex_str=CAT_CREAM)

    root = _root(name)
    part_box(root, "body", 0.16, 0.36, 0.15, loc=(0, 0.01, 0.21),
             material=body, bevel=0.05)
    part_ico(root, "head", 0.085, loc=(0, -0.21, 0.28), material=body)
    part_box(root, "muzzle", 0.055, 0.045, 0.04, loc=(0, -0.275, 0.26),
             material=cream, bevel=0.012)
    for sx in (1.0, -1.0):
        part_cyl(root, f"ear_{sx}", 0.028, 0.055, r2=0.004,
                 loc=(sx * 0.047, -0.185, 0.355), material=dark, verts=8,
                 bevel=0)

    # tail: two-segment S-curve, up and back
    tail = jnt(root, "tail_j", (0, 0.19, 0.26))
    tail.rotation_euler.x = -math.radians(38)
    part_cyl(tail, "tail1", 0.021, 0.16, loc=(0, 0, 0.08), material=body,
             verts=8, bevel=0)
    tip = jnt(tail, "tail_tip_j", (0, 0, 0.16))
    tip.rotation_euler.x = math.radians(46)
    part_cyl(tip, "tail2", 0.017, 0.10, loc=(0, 0, 0.05), material=dark,
             verts=8, bevel=0)

    # legs: diagonal pairs swing (frame 0: FL+BR forward; frame 1: swap)
    swing = 16.0
    for (lx, ly, phase) in ((0.055, -0.12, 0), (-0.055, -0.12, 1),
                            (0.055, 0.13, 1), (-0.055, 0.13, 0)):
        leg = jnt(root, f"leg_{lx}_{ly}", (lx, ly, 0.16))
        a = swing if (phase == i % 2) else -swing
        leg.rotation_euler.x = -math.radians(a)
        part_cyl(leg, f"leg_m_{lx}_{ly}", 0.024, 0.16, loc=(0, 0, -0.08),
                 material=body, verts=8, bevel=0.008)

    return _result(root)


def build_cat_curl(name):
    body = mat("cat_body", hex_str=CAT_BODY)
    dark = mat("cat_dark", hex_str=CAT_DARK)

    root = _root(name)
    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.12, minor_radius=0.062, major_segments=20,
        minor_segments=10, location=(0, 0, 0))
    torus = bpy.context.active_object
    torus.name = "curl"
    torus.parent = root
    torus.location = (0, 0, 0.055)
    torus.scale = (1.0, 1.0, 0.85)
    torus.data.materials.append(body)

    part_ico(root, "head", 0.075, loc=(0.05, -0.075, 0.115), material=body)
    for sx in (1.0, -1.0):
        part_cyl(root, f"ear_{sx}", 0.024, 0.045, r2=0.004,
                 loc=(0.05 + sx * 0.04, -0.09, 0.175), material=dark,
                 verts=8, bevel=0)
    # tail draped across the top of the curl
    part_cyl(root, "tail", 0.02, 0.20, loc=(-0.055, 0.03, 0.11),
             material=dark, verts=8, bevel=0, rot=(78, 0, 20))

    return _result(root)


# ---------------------------------------------------------------- registry
# name -> {frames, fps, build(frame_i) -> result dict}. fps 0 = static.

SPRITES = {}
for _o in OUTFITS:
    SPRITES[f"{_o}.walk"] = {
        "frames": 4, "fps": 8,
        "build": lambda i, o=_o: build_worker(o, o, walk_pose(i))}
    SPRITES[f"{_o}.sit"] = {
        "frames": 1, "fps": 0,
        "build": lambda i, o=_o: build_worker(o, o, sit_pose())}
    SPRITES[f"{_o}.type"] = {
        "frames": 2, "fps": 2,
        "build": lambda i, o=_o: build_worker(o, o, type_pose(i))}
    SPRITES[f"{_o}.blocked"] = {
        "frames": 1, "fps": 0,
        "build": lambda i, o=_o: build_worker(o, o, blocked_pose())}
SPRITES["cat.curl"] = {"frames": 1, "fps": 0,
                       "build": lambda i: build_cat_curl("cat_curl")}
SPRITES["cat.walk"] = {"frames": 2, "fps": 3,
                       "build": lambda i: build_cat_walk("cat_walk", i)}
