"""rig.py — shared Blender scene setup for the war-room iso asset pipeline.

TRUE 2:1 dimetric camera, derivation (do not eyeball this):
  Orthographic camera, rotation_euler = (X=60deg, 0, Z=45deg).
  With Z=45deg a unit floor tile's diagonals align with the screen axes.
  A ground vector along the view-depth direction of length L projects to
  L*cos(theta) where theta is the camera tilt from vertical. cos(60)=0.5,
  so the tile diamond renders exactly twice as wide as tall -> 2:1.

Pixel scale contract:
  1 blender unit = 1 floor tile = 1 "meter".
  Tile diamond width at 1x  = TILE_PX px      (diamond height = TILE_PX/2).
  Renders happen at RENDER_SCALE x for crisp downscale in pack.py.
  px_per_unit (screen-X) = TILE_PX * RENDER_SCALE / sqrt(2)
  ortho_scale = canvas_width_px / px_per_unit   (world units across frame)

Lighting: three-point soft rig, warm key from screen-left (night-office
mood), cool dim fill from screen-right, warm-neutral rim from behind-top.
The rig is world-fixed; props rotate under it so every rotation of every
prop is lit from the same screen direction — consistency across ALL
renders is load-bearing for the spritesheet.
"""

import math

import bpy
from mathutils import Vector

# ---------------------------------------------------------------- constants

TILE_PX = 128          # tile diamond width at 1x, in px
RENDER_SCALE = 2       # render at 2x, pack.py downscales
CANVAS_PX = 640        # square render canvas at RENDER_SCALE (320 at 1x)
CAM_TILT_DEG = 60.0    # from vertical; cos(60) = 0.5 -> 2:1
CAM_YAW_DEG = 45.0
CAM_DIST = 14.0
CAM_TARGET = Vector((0.0, 0.0, 0.35))  # lift frame so tall props fit

PX_PER_UNIT = TILE_PX * RENDER_SCALE / math.sqrt(2.0)   # 181.019 at 2x
ORTHO_SCALE = CANVAS_PX / PX_PER_UNIT                   # 3.5355 world units

# rotation label -> prop yaw (deg). Props are authored facing "S"
# (front toward world -Y, which the camera sees as lower-left).
ROTATIONS = {"N": 180.0, "E": 90.0, "S": 0.0, "W": 270.0}


def _clear_scene():
    """Hard-reset to an empty scene (headless-safe)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(hex_str, alpha=1.0):
    """'#RRGGBB' (sRGB) -> linear RGBA tuple for Blender."""
    h = hex_str.lstrip("#")
    r, g, b = (int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), alpha)


# ---------------------------------------------------------------- scene

def build_scene(samples=96):
    """Fresh scene with camera + lights + shadow catcher. Returns scene."""
    _clear_scene()
    scene = bpy.context.scene

    # --- render engine: Cycles CPU (deterministic headless), denoised
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.02
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    scene.cycles.max_bounces = 4

    scene.render.resolution_x = CANVAS_PX
    scene.render.resolution_y = CANVAS_PX
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 90

    # Punchy flat colors: no filmic/AgX tone-mapping on stylized sprites.
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"

    # --- camera: TRUE 2:1 dimetric
    cam_data = bpy.data.cameras.new("iso_cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ORTHO_SCALE
    cam_data.clip_start = 0.1
    cam_data.clip_end = 100.0
    cam = bpy.data.objects.new("iso_cam", cam_data)
    scene.collection.objects.link(cam)
    cam.rotation_euler = (
        math.radians(CAM_TILT_DEG),
        0.0,
        math.radians(CAM_YAW_DEG),
    )
    # camera looks down local -Z; back it off along local +Z from target
    cam.location = (
        cam.rotation_euler.to_matrix() @ Vector((0.0, 0.0, CAM_DIST))
    ) + CAM_TARGET
    scene.camera = cam

    # --- world: faint cool night ambient so shadows stay readable
    world = bpy.data.worlds.new("night_office")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.012, 0.018, 0.035, 1.0)
    bg.inputs["Strength"].default_value = 1.0
    scene.world = world

    # --- three-point soft rig (screen-left = world (-X,-Y) quadrant)
    # Only the key casts shadows: multi-directional shadow blobs from
    # fill+rim muddy the sprite and bloat the trimmed frames.
    _area_light(
        "key_warm", loc=(-2.4, -2.0, 5.2), size=3.0,
        color=(1.0, 0.66, 0.38), energy=1100.0, shadow=True,
    )
    _area_light(
        "fill_cool", loc=(3.4, 1.2, 2.6), size=5.0,
        color=(0.55, 0.68, 1.0), energy=170.0, shadow=False,
    )
    _area_light(
        "rim_top", loc=(-1.2, 3.2, 4.4), size=3.5,
        color=(1.0, 0.88, 0.72), energy=320.0, shadow=False,
    )

    # --- shadow catcher ground (alpha contact shadows on transparent film)
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, -0.001))
    catcher = bpy.context.active_object
    catcher.name = "shadow_catcher"
    catcher.is_shadow_catcher = True

    return scene


def _area_light(name, loc, size, color, energy, shadow=True):
    data = bpy.data.lights.new(name, type="AREA")
    data.size = size
    data.color = color[:3]
    data.energy = energy
    data.use_shadow = shadow
    if hasattr(data, "cycles"):  # Cycles' own cast_shadow toggle
        data.cycles.cast_shadow = shadow
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = loc
    # aim at origin
    direction = Vector((0, 0, 0)) - Vector(loc)
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return obj


def set_shadow_catcher(enabled):
    obj = bpy.data.objects.get("shadow_catcher")
    if obj:
        obj.hide_render = not enabled


# ---------------------------------------------------------------- projection

def project_px(scene, world_co):
    """World coordinate -> render pixel (x right, y down) at RENDER_SCALE."""
    from bpy_extras.object_utils import world_to_camera_view

    ndc = world_to_camera_view(scene, scene.camera, Vector(world_co))
    w = scene.render.resolution_x
    h = scene.render.resolution_y
    return (ndc.x * w, (1.0 - ndc.y) * h)
