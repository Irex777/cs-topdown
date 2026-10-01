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
from lib import _copy_into, Vector, Euler  # noqa: E402

prev = '--preview' in sys.argv
reset()
wood = image_mat('wood', 'tex/wood_c.jpg', rough=0.85)
wood_dark = image_mat('wood_dark', 'tex/wood_c.jpg', srgb('#8d8d8d'), rough=0.9)
steel = mat('steel', srgb('#5b6068'), 0.9, 0.45)
sandbag = image_mat('sandbag', 'tex/sandbag_c.jpg', rough=0.95)
paint_a = image_mat('barrel_orange', 'skins/field-metal-runtime.jpg', srgb('#986044'), 0.25, 0.75)
paint_b = image_mat('barrel_yellow', 'skins/field-metal-runtime.jpg', srgb('#a38f54'), 0.25, 0.75)
paint_c = mat('barrel_olive', srgb('#5a6a3c'), 0.35, 0.55)
hoop = mat('barrel_hoop', srgb('#3b3d40'), 0.85, 0.4)
hazard = mat('hazard', srgb('#e8c02a'), 0.0, 0.6)
black = mat('black', srgb('#141517'), 0.1, 0.7)
bark = image_mat('bark', 'foliage/oak-bark-runtime.jpg', rough=0.95)
foliage = image_mat('foliage', 'foliage/oak-leaves-runtime.png', rough=0.95)
foliage['frontline_alpha_cutoff'] = 0.42
foliage.use_backface_culling = False
foliage.surface_render_method = 'DITHERED'
image_node = next(n for n in foliage.node_tree.nodes if n.type == 'TEX_IMAGE')
foliage.node_tree.links.new(image_node.outputs['Alpha'], foliage.node_tree.nodes['Principled BSDF'].inputs['Alpha'])
rnd = random.Random(7)
objs = []


def place(o, x):
    o.location = (x, 0, 0)
    objs.append(o)


# ---- crate: 1.8 x 1.8 x 1.25 m ------------------------------------------------------------------------
B = Builder('crate')
S, H = 1.8, 1.25
B.box(wood, (0, 0, H / 2), (S - 0.06, S - 0.06, H - 0.04), bevel=0.012)
# Recessed plank joints and lifting plates give cover a readable construction.
for z in (0.26, 0.51, 0.76, 1.01):
    for s in (-1, 1):
        B.box(wood_dark, (s * 0.873, 0, z), (0.006, 1.58, 0.009), bevel=0)
        B.box(wood_dark, (0, s * 0.873, z), (1.58, 0.006, 0.009), bevel=0)
for s in (-1, 1):
    B.box(steel, (s * 0.9, 0, 0.86), (0.014, 0.2, 0.14), bevel=0.008)
    B.cyl(steel, (s * 0.94, -0.07, 0.88), (s * 0.94, 0.07, 0.88), 0.018, verts=8)
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
seam = mat('bag_seam', srgb('#766c4e'), 0.0, 1.0)
for layer in range(3):
    off = 0.5 if layer % 2 else 0.0
    z = 0.145 + layer * 0.29
    for row in range(3):
        y = -0.66 + row * 0.66
        for k in range(2):
            x = -0.5 + k * 1.0 + (off - 0.25) * 0.5 + rnd.uniform(-0.03, 0.03)
            B.box(sandbag, (x, y + rnd.uniform(-0.02, 0.02), z), (0.98, 0.64, 0.3), bevel=0.085, seg=2, rot=(0, rnd.uniform(-2, 2), rnd.uniform(-3, 3)))
            for s in (-1, 1):
                B.cyl(seam, (x - 0.36, y + s * 0.31, z), (x + 0.36, y + s * 0.31, z), 0.005, verts=5)
place(B.finish(uv_size=1.3), 6)

# ---- mature oak: 9 m, real bark and individual alpha-tested leaf branches --------------------------------
B = Builder('tree')
B.cyl(bark, (0, 0, 0), (0.13, -0.07, 5.4), 0.28, r2=0.095, verts=14)
for a in (0.4, 1.5, 2.8, 4.4, 5.6):
    B.cyl(bark, (0, 0, 0.38), (0.65 * math.cos(a), 0.65 * math.sin(a), 0.015), 0.09, r2=0.025, verts=7)
clusters = [(0.1, 0, 7.7)]
for i in range(10):
    a = i * 2.39996
    d, z = rnd.uniform(1.1, 2.0), rnd.uniform(5.4, 7.3)
    tip = Vector((math.cos(a) * d, math.sin(a) * d, z))
    B.cyl(bark, (0.06, 0, 2.8 + i * 0.14), tip, 0.10, r2=0.025, verts=8)
    for s in (-1, 1):
        twig = tip + Vector((math.cos(a + s * 0.6) * 0.7, math.sin(a + s * 0.6) * 0.7, 0.35))
        B.cyl(bark, tip, twig, 0.025, r2=0.008, verts=5)
    clusters.append(tuple(tip))
for center in clusters:
    for i in range(16):
        size = rnd.uniform(1.05, 1.65)
        rotation = Euler((rnd.uniform(-math.pi, math.pi), rnd.uniform(-math.pi, math.pi), rnd.uniform(-math.pi, math.pi))).to_matrix()
        position = Vector(center) + Vector((rnd.uniform(-0.85, 0.85), rnd.uniform(-0.85, 0.85), rnd.uniform(-0.6, 0.85)))
        target = B._target(foliage)
        corners = [(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)]
        verts = [target.verts.new(rotation @ (Vector(c) * size * 0.5) + position) for c in corners]
        target.faces.new(verts)
tree = B.finish(smooth_angle=45, uv_size=1.5)
# Each leaf card consumes the whole cutout, regardless of its 3D orientation.
uv = tree.data.uv_layers.active.data
for poly in tree.data.polygons:
    if tree.data.materials[poly.material_index] == foliage:
        for loop, coord in zip(poly.loop_indices, ((0, 0), (1, 0), (1, 1), (0, 1))):
            uv[loop].uv = coord
place(tree, 9)
if prev:
    preview('tree', (17, -15, 7), (9, 0, 4.6), w=900, h=1100, lens=52)
    preview('props', (4.5, -24, 10), (4.5, 0, 4.4), w=1500, h=960, lens=38)
for o in [o for o in bpy.data.objects if o.type in ('CAMERA', 'LIGHT')]:
    bpy.data.objects.remove(o)
export(os.path.join(OUT, 'props.glb'), objs)
