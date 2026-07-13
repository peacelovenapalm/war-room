"""characters.py — parametric low-poly staff + pets for the Living Studio.

One stylized person model (capsule-ish limbs, ico-sphere head, no face —
it reads by silhouette + outfit color at 128px-tile scale), posed by
DIRECT TRANSFORM: every joint is an empty; poses are plain dicts of
joint angles. No armatures — deterministic under headless bpy, nothing
to bake, nothing to desync.

C2 diversity pass (v5 KICKOFF §C2): the original 4 `OUTFITS` entries
render byte-identically (their `build` is "regular", scale 1.0/1.0) —
this pass is additive, not a rig rewrite. `NEW_VARIANTS` adds 12 more
identities spanning body build (via `BUILDS` proportional scale — see
`_scaled()`), skin tone, and hair silhouette (`bald` is one option
among `short`/`buzz`/`bun`/`long`/`curly`/`cap`, not the default).
Every (hair style, build) pair across the 12 new variants is unique so
no two are shape-identical in grayscale — only the originals-vs-new
split can share a build (originals are all "regular").

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
        "hair": "#3B2E24", "style": "blob", "build": "regular",
    },
    "worker_rust": {
        "shirt": "#C77B4A", "trousers": "#52381F", "skin": "#C68B62",
        "hair": "#1F1A16", "style": "bun", "build": "regular",
    },
    "worker_slate": {
        "shirt": "#4A5E74", "trousers": "#2E2A28", "skin": "#8C5A3C",
        "hair": "#141210", "style": "cap", "build": "regular",
    },
    "worker_moss": {
        "shirt": "#5B7A45", "trousers": "#4A4034", "skin": "#6B4630",
        "hair": "#2A2018", "style": "buzz", "build": "regular",
    },
}

# C2 diversity pass — 12 new identities. Deterministic explicit params
# (no RNG at render time): every (style, build) pair below is unique so
# grayscale silhouettes don't collide by construction (see module docstring).
NEW_VARIANTS = {
    "worker_amber": {
        "shirt": "#D8A24A", "trousers": "#3A3637", "skin": "#3E2A1C",
        "hair": "#14100D", "style": "bald", "build": "broad",
    },
    "worker_coral": {
        "shirt": "#E88D8D", "trousers": "#52381F", "skin": "#F2C9A0",
        "hair": "#6B4226", "style": "long", "build": "slim",
    },
    "worker_indigo": {
        "shirt": "#3B4A6B", "trousers": "#2E2A28", "skin": "#B97A4E",
        "hair": "#1C1712", "style": "curly", "build": "tall",
    },
    "worker_sage": {
        "shirt": "#7FBFB0", "trousers": "#4A4034", "skin": "#5C3A24",
        "hair": "#0F0C0A", "style": "short", "build": "short",
    },
    "worker_plum": {
        "shirt": "#7A5070", "trousers": "#3A3637", "skin": "#D9A26C",
        "hair": "#2A2018", "style": "buzz", "build": "broad",
    },
    "worker_ochre": {
        "shirt": "#B08A4F", "trousers": "#52381F", "skin": "#8A5A38",
        "hair": "#17110D", "style": "bun", "build": "slim",
    },
    "worker_charcoal": {
        "shirt": "#4E6B5D", "trousers": "#2A2422", "skin": "#3E2A1C",
        "hair": "#050403", "style": "bald", "build": "tall",
    },
    "worker_rose": {
        "shirt": "#E0B98A", "trousers": "#4A4034", "skin": "#F2C9A0",
        "hair": "#4A2E1C", "style": "curly", "build": "short",
    },
    "worker_navy": {
        "shirt": "#2F4A6B", "trousers": "#1F1A16", "skin": "#B97A4E",
        "hair": "#1A1512", "style": "short", "build": "slim",
    },
    "worker_clay": {
        "shirt": "#A06034", "trousers": "#3A3637", "skin": "#8A5A38",
        "hair": "#0C0908", "style": "buzz", "build": "tall",
    },
    "worker_mint": {
        "shirt": "#5B9B84", "trousers": "#2E2A28", "skin": "#D9A26C",
        "hair": "#2A1E14", "style": "bald", "build": "short",
    },
    "worker_violet": {
        "shirt": "#6B5E8A", "trousers": "#52381F", "skin": "#F2C9A0",
        "hair": "#6B4226", "style": "long", "build": "broad",
    },
}

VARIANTS = {**OUTFITS, **NEW_VARIANTS}

# Proportional scale factors: h = overall height (leg/torso/arm lengths),
# w = overall width (torso/shoulder/limb girths). h is applied to the
# whole leg chain (hip->knee->foot) TOGETHER so the sum stays zero —
# see _scaled() — meaning feet stay flush at z=0 (the floor-contact
# anchor point) regardless of build. "regular" is scale 1.0/1.0 so the
# original 4 outfits render pixel-identical to pre-C2 output.
BUILDS = {
    "regular": {"h": 1.00, "w": 1.00},
    "slim":    {"h": 1.04, "w": 0.83},
    "broad":   {"h": 0.96, "w": 1.20},
    "short":   {"h": 0.85, "w": 1.04},
    "tall":    {"h": 1.15, "w": 0.93},
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
    o = VARIANTS[outfit_key]
    build = BUILDS[o.get("build", "regular")]
    h, w = build["h"], build["w"]
    # head/hand scale less aggressively than the body so heads don't
    # balloon on "broad" or shrink to a pinhead on "slim" (chibi look
    # is load-bearing at 128px tiles — see module docstring).
    hw = 1.0 + (w - 1.0) * 0.15
    hh = 1.0 + (h - 1.0) * 0.3

    # leg-chain lengths scale TOGETHER by h so HIP_Z - U_LEG - L_LEG -
    # FOOT_H stays exactly 0 (feet flush at the floor-contact anchor).
    hip_z, u_leg, l_leg, foot_h = HIP_Z * h, U_LEG * h, L_LEG * h, FOOT_H * h
    spine_z, sho_up, u_arm, l_arm = SPINE_Z * h, SHO_UP * h, U_ARM * h, L_ARM * h
    hip_x, sho_x = HIP_X * w, SHO_X * w

    shirt = mat(f"shirt_{outfit_key}", hex_str=o["shirt"])
    trousers = mat(f"trousers_{outfit_key}", hex_str=o["trousers"])
    skin = mat(f"skin_{outfit_key}", hex_str=o["skin"], roughness=0.7)
    hair = mat(f"hair_{outfit_key}", hex_str=o["hair"])
    shoes = mat("shoes", hex_str=SHOE_COLOR)

    root = _root(name)
    root.location.z = p["root_z"] + p["bob"]

    # pelvis
    part_box(root, "pelvis", 0.32 * w, 0.21 * w, 0.18 * h, loc=(0, 0, hip_z + 0.02 * h),
             material=trousers, bevel=0.05)

    # legs: hip -> upper leg -> knee -> lower leg + foot
    for side, sx in (("l", 1.0), ("r", -1.0)):
        hip = jnt(root, f"hip_{side}", (sx * hip_x, 0, hip_z))
        hip.rotation_euler.x = -math.radians(p[f"{side}_hip"])
        part_cyl(hip, f"uleg_{side}", 0.062 * w, u_leg, loc=(0, 0, -u_leg / 2),
                 material=trousers, bevel=0.015)
        knee = jnt(hip, f"knee_{side}", (0, 0, -u_leg))
        knee.rotation_euler.x = math.radians(p[f"{side}_knee"])
        part_cyl(knee, f"lleg_{side}", 0.055 * w, l_leg, loc=(0, 0, -l_leg / 2),
                 material=trousers, bevel=0.012)
        part_box(knee, f"foot_{side}", 0.11 * w, 0.19 * w, foot_h,
                 loc=(0, -0.045, -l_leg - foot_h / 2), material=shoes,
                 bevel=0.02)

    # spine group: torso + arms + head all pitch together
    spine = jnt(root, "spine", (0, 0, spine_z))
    spine.rotation_euler.x = math.radians(p["spine"])
    part_box(spine, "torso", 0.34 * w, 0.23 * w, 0.42 * h, loc=(0, 0, 0.22 * h),
             material=shirt, bevel=0.07)

    # arms: shoulder -> upper arm (sleeve) -> elbow -> forearm + hand
    for side, sx in (("l", 1.0), ("r", -1.0)):
        sho = jnt(spine, f"sho_{side}", (sx * sho_x, 0, sho_up))
        out = 6.0 + p[f"{side}_sho_out"]          # rest abduction 6deg
        sho.rotation_euler = (
            -math.radians(p[f"{side}_sho"]),
            -sx * math.radians(out),
            0.0,
        )
        part_cyl(sho, f"uarm_{side}", 0.052 * w, u_arm, loc=(0, 0, -u_arm / 2),
                 material=shirt, bevel=0.012)
        elb = jnt(sho, f"elb_{side}", (0, 0, -u_arm))
        elb.rotation_euler.x = -math.radians(p[f"{side}_elb"])
        part_cyl(elb, f"larm_{side}", 0.045 * w, l_arm, loc=(0, 0, -l_arm / 2),
                 material=skin, bevel=0.01)
        part_ico(elb, f"hand_{side}", 0.055 * hw, loc=(0, 0, -l_arm - 0.02),
                 material=skin, subdiv=1)

    # neck + head (nod pivot at neck top)
    part_cyl(spine, "neck", 0.05 * w, 0.08 * h, loc=(0, 0, 0.45 * h),
             material=skin, bevel=0)
    head_j = jnt(spine, "head_j", (0, 0, 0.50 * h))
    head_j.rotation_euler.x = math.radians(p["head"])
    part_ico(head_j, "head", 0.16 * hh, loc=(0, 0, 0.12 * h), material=skin)

    # hair styles (cheap identity — silhouette varies per outfit/variant)
    style = o["style"]
    if style in ("blob", "short", "bun", "buzz"):
        squash = 0.62 if style == "buzz" else 0.78
        part_ico(head_j, "hair", 0.165 * hh, loc=(0, 0.03, 0.155 * h),
                 material=hair, scale=(1.02, 1.0, squash))
    if style == "bun":
        # bigger + higher (top-knot, not tucked behind the skull) so it
        # pokes past the head silhouette from every rotation including
        # S — a small rear-only bun was nearly invisible from the front
        # (qa_grayscale_distinctness.py caught rust/teal and navy/ochre
        # both >90% head-silhouette overlap on the first pass).
        part_ico(head_j, "bun", 0.085 * hh, loc=(0, 0.15, 0.27 * h),
                 material=hair, subdiv=1)
    if style == "long":
        part_ico(head_j, "hair", 0.165 * hh, loc=(0, 0.03, 0.155 * h),
                 material=hair, scale=(1.02, 1.0, 0.78))
        # thicker, higher-anchored ponytail so it bulges past the head
        # silhouette in every rotation (not just N/back) — a thin tail
        # tucked straight down was invisible from S per preview render.
        part_cyl(head_j, "ponytail", 0.075 * hh, 0.30 * hh, r2=0.025 * hh,
                 loc=(0, 0.155, 0.135 * h), material=hair, verts=10,
                 bevel=0, rot=(-42.0, 0.0, 0.0))
    if style == "curly":
        # cluster of small icospheres around the crown for an afro-like
        # silhouette — reads distinctly from the smooth "blob"/"short"
        # hair in grayscale (bumpy scalloped edge, not a single round
        # bulge). Larger + wider-spread than the first pass, which read
        # as a plain blob at this render scale.
        for (ox, oy, oz, r) in (
            (0.0, 0.02, 0.20, 0.115), (0.12, 0.03, 0.155, 0.105),
            (-0.12, 0.03, 0.155, 0.105), (0.0, 0.15, 0.17, 0.11),
            (0.09, -0.06, 0.16, 0.09), (-0.09, -0.06, 0.16, 0.09),
            (0.0, -0.02, 0.235, 0.09),
        ):
            part_ico(head_j, f"curl_{ox}_{oy}", r * hh,
                     loc=(ox * hh, oy, oz * h), material=hair, subdiv=1)
    if style == "cap":
        cap = mat("cap", hex_str=CAP_COLOR)
        part_cyl(head_j, "cap_crown", 0.155 * hh, 0.10 * h,
                 loc=(0, 0.015, 0.225 * h), material=cap, verts=18,
                 bevel=0.02)
        part_box(head_j, "cap_brim", 0.18 * hh, 0.13 * hh, 0.02 * h,
                 loc=(0, -0.155, 0.19 * h), material=cap, bevel=0.008)
    # style == "bald": no hair mesh added.

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
for _o in VARIANTS:
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
