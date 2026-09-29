"""World props -> src/client/assets/props.glb: crate (X), barrel cluster (o), sandbag pile (L), tree (T).
Real-world metres, origin on the ground at the centre of the tile footprint (the game scales 16 px per metre).
Materials named wood / wood_dark / sandbag get the baked PBR textures at load time; everything carries baked AO in COLOR_0.
    python3 tools/blender/build_props.py [--preview]"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *  # noqa: E402,F401,F403
from lib import _copy_into  # noqa: E402

prev = '--preview' in sys.argv
reset()
wood = mat('wood', (1, 1, 1), 0.0, 0.85)
wood_dark = mat('wood_dark', srgb('#8d8d8d'), 0.0, 0.9)
steel = mat('steel', srgb('#5b6068'), 0.9, 0.45)
sandbag = mat('sandbag', (1, 1, 1), 0.0, 0.95)
paint_a = mat('barrel_orange', srgb('#c9531f'), 0.35, 0.5)
paint_b = mat('barrel_yellow', srgb('#d6a621'), 0.35, 0.5)
paint_c = mat('barrel_olive', srgb('#5a6a3c'), 0.35, 0.55)
hoop = mat('barrel_hoop', srgb('#3b3d40'), 0.85, 0.4)
hazard = mat('hazard', srgb('#e8c02a'), 0.0, 0.6)
black = mat('black', srgb('#141517'), 0.1, 0.7)
bark = mat('bark', srgb('#4b3626'), 0.0, 0.95)
leaf_a = mat('leaf_dark', srgb('#2f6a2c'), 0.0, 0.85)
leaf_b = mat('leaf_mid', srgb('#3f8a3a'), 0.0, 0.85)
leaf_c = mat('leaf_light', srgb('#62b058'), 0.0, 0.85)
rnd = random.Random(7)
objs = []


def place(o, x):
    o.location = (x, 0, 0)
    objs.append(o)


# ---- crate: 1.8 x 1.8 x 1.25 m ------------------------------------------------------------------------
B = Builder('crate')
S, H = 1.8, 1.25
B.box(wood, (0, 0, H / 2), (S - 0.06, S - 0.06, H - 0.04), bevel=0.012)
fw = 0.13
for sx in (-1, 1):
    for sy in (-1, 1):
        B.box(wood_dark, (sx * (S / 2 - fw / 2), sy * (S / 2 - fw / 2), H / 2), (fw, fw, H), bevel=0.012)    # corner posts
for z in (0.06, H - 0.06):
    for s in (-1, 1):
        B.box(wood_dark, (s * (S / 2 - fw / 2), 0, z), (fw, S - 2 * fw + 0.02, 0.12), bevel=0.01)
        B.box(wood_dark, (0, s * (S / 2 - fw / 2), z), (S - 2 * fw + 0.02, fw, 0.12), bevel=0.01)
diag = math.degrees(math.atan2(H - 0.3, S - 0.4))
for s in (-1, 1):                              # X braces on the four sides
    for ang in (diag, -diag):
        B.box(wood_dark, (s * (S / 2 + 0.005), 0, H / 2), (0.05, math.hypot(S - 0.4, H - 0.3), 0.11), bevel=0.008, rot=(ang, 0, 0))
        B.box(wood_dark, (0, s * (S / 2 + 0.005), H / 2), (math.hypot(S - 0.4, H - 0.3), 0.05, 0.11), bevel=0.008, rot=(0, ang, 0))
for sx in (-1, 1):
    for sy in (-1, 1):
        for z in (0.16, H - 0.16):
            B.sphere(steel, (sx * (S / 2 - 0.05), sy * (S / 2 - fw - 0.02), z), 0.022, 6)
            B.sphere(steel, (sx * (S / 2 - fw - 0.02), sy * (S / 2 - 0.05), z), 0.022, 6)
B.box(black, (0, 0, H + 0.005), (0.32, 0.32, 0.012), bevel=0.004)            # stencil block on the lid
place(B.finish(uv_size=1.6), 0)

# ---- barrels: 4 drums in a 1.44 m footprint, 1.1 m tall --------------------------------------------------
B = Builder('barrels')
for (x, y, m, rot) in ((-0.36, -0.36, paint_a, 0.0), (0.36, -0.36, paint_a, 1.2), (-0.36, 0.36, paint_b, 2.1), (0.36, 0.36, paint_a, 3.0)):
    r, h = 0.33, 1.08
    B.cyl(m, (x, y, 0.02), (x, y, h), r, verts=20, bevel=0.012)
    B.cyl(m, (x, y, h - 0.005), (x, y, h + 0.012), r * 0.86, verts=20)
    for z in (0.22, 0.54, 0.86):
        B.cyl(hoop, (x, y, z - 0.022), (x, y, z + 0.022), r + 0.012, verts=20)
    B.cyl(hoop, (x, y, 0.0), (x, y, 0.045), r + 0.01, verts=20)
    B.cyl(hoop, (x, y, h - 0.03), (x, y, h + 0.01), r + 0.01, verts=20)
    bx, by = math.cos(rot), math.sin(rot)
    B.box(hazard, (x + bx * (r + 0.005), y + by * (r + 0.005), 0.66), (0.012, 0.22, 0.2), bevel=0.003, rot=(0, 0, math.degrees(rot)))
    B.cyl(black, (x + 0.16, y - 0.06, h + 0.01), (x + 0.16, y - 0.06, h + 0.05), 0.035, verts=10)     # bung
place(B.finish(uv_size=1.0), 3)

# ---- sandbag pile: 2 x 2 m footprint, 0.875 m tall (3 courses) -----------------------------------------
B = Builder('sandbags')
for layer in range(3):
    off = 0.5 if layer % 2 else 0.0
    z = 0.145 + layer * 0.29
    for row in range(3):
        y = -0.66 + row * 0.66
        for k in range(2):
            x = -0.5 + k * 1.0 + (off - 0.25) * 0.5 + rnd.uniform(-0.03, 0.03)
            B.box(sandbag, (x, y + rnd.uniform(-0.02, 0.02), z), (0.98, 0.64, 0.3), bevel=0.085, seg=2, rot=(0, rnd.uniform(-2, 2), rnd.uniform(-3, 3)))
place(B.finish(uv_size=1.3), 6)

# ---- tree: 4.5 m ---------------------------------------------------------------------------------------
B = Builder('tree')
B.cyl(bark, (0, 0, 0), (0.02, 0.0, 3.0), 0.26, r2=0.13, verts=9)
for a in (0.4, 2.3, 4.4):
    B.cyl(bark, (0, 0, 1.9), (0.7 * math.cos(a), 0.7 * math.sin(a), 2.9), 0.07, r2=0.04, verts=6)
for (x, y, z, r, m) in ((0, 0, 3.45, 1.05, leaf_b), (0.75, 0.15, 2.95, 0.75, leaf_a), (-0.6, -0.4, 3.05, 0.8, leaf_a), (0.05, 0.75, 3.05, 0.7, leaf_b), (-0.15, -0.7, 3.0, 0.7, leaf_b), (0.1, 0.05, 4.1, 0.75, leaf_c), (-0.3, 0.3, 3.85, 0.62, leaf_c)):
    t = bmesh.new()
    bmesh.ops.create_icosphere(t, subdivisions=2, radius=r)
    for v in t.verts:
        d = 1 + rnd.uniform(-0.16, 0.16)
        v.co.x *= d; v.co.y *= d; v.co.z *= d * 0.85
    bmesh.ops.translate(t, vec=(x, y, z), verts=t.verts)
    _copy_into(B._target(m), t)
    t.free()
place(B.finish(smooth_angle=60, uv_size=2.0), 9)

bake_ao([o for o in objs if o.name == 'tree'], samples=24, distance=0.35)    # big flat quads (crate, sandbags) shade badly per vertex; the canopy takes it well
if prev:
    preview('props', (4.5, -17, 5.5), (4.5, 0, 1.6), w=1500, h=520, lens=42)
for o in [o for o in bpy.data.objects if o.type in ('CAMERA', 'LIGHT')]:
    bpy.data.objects.remove(o)
export(os.path.join(OUT, 'props.glb'), objs)
