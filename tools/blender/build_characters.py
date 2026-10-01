"""The soldier model -> src/client/assets/soldier.glb.  Feet on z=0, facing +X, right side is -Y (glTF: +Z after export).
Named nodes: legL / legR (pivot at the hip, the game swings them), weapon (empty where the gun's right-hand grip goes), head_top.
Materials the game re-tints per team and class: uniform, helmet, vest, accent, team_patch.
Modern infantry kit: MICH-style helmet with NVG shroud, ballistic glasses and face gaiter, plate carrier with mag/admin pouches,
assault pack with bedroll and whip antenna, tapered sleeves with elbow pads and fingered gloves, bloused trousers with knee pads, boots.
python3 tools/blender/build_characters.py [--preview] [--save-blend]"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib  # noqa: E402
import lib  # noqa: E402
importlib.reload(lib)    # a long-lived Blender MCP session may hold an older copy
from lib import *  # noqa: E402,F401,F403

prev = '--preview' in sys.argv
reset()
uniform = image_mat('uniform', 'skins/woodland-runtime.jpg', rough=0.88)
pants = image_mat('pants', 'skins/woodland-runtime.jpg', srgb('#d1cbb6'), rough=0.92)
vest = mat('vest', srgb('#474b40'), 0.0, 0.8)
helmet = mat('helmet', srgb('#4a5a3a'), 0.05, 0.6)
accent = mat('accent', srgb('#e0703a'), 0.0, 0.6)
skin = mat('skin', srgb('#c99a78'), 0.0, 0.55)
boots = mat('boots', srgb('#1b1c1f'), 0.0, 0.7)
gear = mat('gear', srgb('#2d3027'), 0.0, 0.8)
lens = mat('goggle', srgb('#0b1116'), 0.6, 0.15)
metal = mat('metal', srgb('#8a9099'), 1.0, 0.35)
webbing = mat('webbing', srgb('#918268'), 0.0, 0.92)
patch = mat('team_patch', srgb('#57afff'), 0.0, 0.55)
glove = boots

B = Builder('soldier_body')

# ---- torso, pelvis ------------------------------------------------------------------------------------------------
B.stack(uniform, [                                                              # field jacket
    (0.95, 0.00, 0, 0.125, 0.175, 2.6), (1.02, 0.00, 0, 0.132, 0.183, 2.7), (1.12, 0.005, 0, 0.142, 0.192, 2.7),
    (1.24, 0.01, 0, 0.150, 0.205, 2.8), (1.36, 0.015, 0, 0.152, 0.216, 2.8), (1.44, 0.01, 0, 0.135, 0.216, 2.6),
    (1.49, 0.00, 0, 0.100, 0.150, 2.3), (1.525, 0.0, 0, 0.060, 0.072, 2.1)], n=32)
B.stack(pants, [(0.86, 0, 0, 0.115, 0.180, 2.4), (0.92, 0, 0, 0.128, 0.190, 2.5), (0.98, 0, 0, 0.128, 0.184, 2.6), (1.03, 0, 0, 0.128, 0.182, 2.6)], n=32)
# neck, head, gaiter
B.sweep(skin, [(0.0, 0, 1.47), (0.012, 0, 1.56)], [0.052, 0.046], n=16, round_ends=(False, False))
B.stack(skin, [(1.540, 0.030, 0, 0.055, 0.046, 2.2), (1.575, 0.028, 0, 0.084, 0.064, 2.3), (1.620, 0.020, 0, 0.097, 0.074, 2.3),
               (1.670, 0.015, 0, 0.102, 0.078, 2.3), (1.720, 0.012, 0, 0.098, 0.076, 2.3), (1.762, 0.010, 0, 0.070, 0.056, 2.2),
               (1.785, 0.010, 0, 0.030, 0.026, 2.1)], n=28)
B.sphere(skin, (0.122, 0, 1.635), 0.02, 10, (1.25, 0.7, 1.3))                     # nose bridge
for s in (-1, 1):
    B.sphere(skin, (0.0, s * 0.077, 1.64), 0.026, 10, (0.6, 0.45, 1.25))          # ears
B.stack(gear, [(1.497, 0.018, 0, 0.060, 0.056, 2.2), (1.535, 0.030, 0, 0.066, 0.056, 2.2), (1.570, 0.030, 0, 0.092, 0.070, 2.3),
                  (1.600, 0.024, 0, 0.102, 0.078, 2.3), (1.622, 0.024, 0, 0.104, 0.080, 2.3)], n=28, cap_top=False, cap_bot=False)   # gaiter / scarf

# ---- helmet -------------------------------------------------------------------------------------------------------
B.stack(helmet, [(1.648, 0.020, 0, 0.127, 0.109, 2.5), (1.690, 0.020, 0, 0.131, 0.113, 2.4), (1.735, 0.018, 0, 0.123, 0.107, 2.3),
                 (1.775, 0.015, 0, 0.096, 0.083, 2.2), (1.803, 0.012, 0, 0.052, 0.046, 2.1), (1.812, 0.012, 0, 0.020, 0.020, 2.0)], n=32, cap_bot=False)
B.stack(gear, [(1.640, 0.020, 0, 0.113, 0.094, 2.4), (1.690, 0.020, 0, 0.118, 0.099, 2.3), (1.735, 0.018, 0, 0.108, 0.093, 2.3)], n=28, cap_top=False, cap_bot=False)  # liner
B.box(gear, (0.142, 0, 1.738), (0.05, 0.066, 0.052), bevel=0.012)                  # NVG shroud
B.cyl(metal, (0.168, 0, 1.738), (0.172, 0, 1.738), 0.019, verts=12)
B.box(gear, (0.128, 0, 1.775), (0.04, 0.04, 0.012), bevel=0.004)
for s in (-1, 1):
    B.box(gear, (0.0, s * 0.112, 1.70), (0.085, 0.012, 0.022), bevel=0.005)        # accessory rails
    B.box(metal, (0.02, s * 0.119, 1.70), (0.010, 0.004, 0.012), bevel=0.001, seg=1)
    B.box(gear, (-0.115, 0, 1.70), (0.05, 0.10, 0.07), bevel=0.014)                    # counterweight pouch
B.box(gear, (0.07, 0, 1.763), (0.12, 0.012, 0.016), bevel=0.004)                   # top strap / cat-eye
for s in (-1, 1):
    B.sphere(gear, (0.005, s * 0.105, 1.62), 0.034, 14, (0.8, 0.5, 1.15))         # comms ear cups
    B.sweep(gear, [(0.03, s * 0.105, 1.648), (0.06, s * 0.07, 1.585), (0.10, s * 0.035, 1.55)], [0.003, 0.003, 0.003], n=6, round_ends=(False, False))  # chin strap
B.sweep(gear, [(0.10, -0.035, 1.55), (0.108, 0, 1.545), (0.10, 0.035, 1.55)], [0.003] * 3, n=6, round_ends=(False, False))
B.sweep(gear, [(0.0, -0.118, 1.62), (0.0, -0.095, 1.69)], [0.0035, 0.0035], n=6, round_ends=(False, False))
B.sweep(gear, [(0.0, 0.118, 1.62), (0.0, 0.095, 1.69)], [0.0035, 0.0035], n=6, round_ends=(False, False))
# ballistic glasses
B.stack(lens, [(1.640, 0.108, 0, 0.012, 0.072, 3.0), (1.672, 0.108, 0, 0.012, 0.072, 3.0)], n=20)
B.box(gear, (0.096, 0, 1.675), (0.028, 0.150, 0.008), bevel=0.003, seg=1)
B.box(gear, (0.096, 0, 1.636), (0.028, 0.150, 0.008), bevel=0.003, seg=1)
for s in (-1, 1):
    B.box(gear, (0.05, s * 0.074, 1.655), (0.10, 0.007, 0.012), bevel=0.002, seg=1)

# ---- plate carrier ------------------------------------------------------------------------------------------------
B.stack(vest, [(1.06, 0.01, 0, 0.148, 0.196, 3.2), (1.16, 0.016, 0, 0.158, 0.208, 3.4), (1.30, 0.020, 0, 0.162, 0.218, 3.4),
               (1.40, 0.016, 0, 0.148, 0.205, 3.1), (1.445, 0.010, 0, 0.128, 0.198, 2.9)], n=32, cap_top=False)
B.box(vest, (0.184, 0, 1.33), (0.034, 0.26, 0.31), bevel=0.018, seg=3)                # front plate
B.box(vest, (-0.155, 0, 1.33), (0.034, 0.25, 0.31), bevel=0.018, seg=3)               # back plate
B.box(accent, (0.203, 0, 1.425), (0.012, 0.15, 0.045), bevel=0.004)                 # class ID panel
for s in (-1, 1):
    B.sweep(vest, [(0.16, s * 0.13, 1.41), (0.03, s * 0.14, 1.488), (-0.10, s * 0.14, 1.425)], [0.024] * 3, n=10, squash=(1.0, 0.45), ref=(0, 0, 1), round_ends=(False, False))   # shoulder straps
B.stack(gear, [(1.012, 0.008, 0, 0.152, 0.198, 3.2), (1.05, 0.008, 0, 0.154, 0.201, 3.2)], n=32)   # belt
B.box(metal, (0.16, 0, 1.03), (0.02, 0.05, 0.03), bevel=0.004)                      # buckle
for z in (1.25, 1.30, 1.36):                                                        # MOLLE rows
    for y in (-0.105, -0.07, -0.035, 0.0, 0.035, 0.07, 0.105):
        B.box(webbing, (0.203, y, z), (0.008, 0.03, 0.008), bevel=0.001, seg=1)


def pouch(size, c, flap=True, mat_=None, rot=(0, 0, 0)):
    B.box(mat_ or gear, c, size, bevel=0.012)
    if flap:
        B.box(mat_ or gear, (c[0] + size[0] * 0.14, c[1], c[2] + size[2] * 0.36), (size[0] * 1.06, size[1] * 1.02, size[2] * 0.32), bevel=0.006)
        B.box(metal, (c[0] + size[0] * 0.56, c[1], c[2] + size[2] * 0.26), (0.006, 0.014, 0.022), bevel=0.001, seg=1)


for y in (0.04, 0.095, 0.15):                                                       # triple mag pouch (left)
    pouch((0.05, 0.052, 0.13), (0.208, y, 1.17))
pouch((0.045, 0.085, 0.10), (0.208, -0.05, 1.19))                                    # admin
pouch((0.055, 0.07, 0.085), (0.192, -0.145, 1.09))                                    # dump pouch
B.box(gear, (0.07, -0.205, 1.11), (0.06, 0.05, 0.14), bevel=0.014)                  # holster
B.box(gear, (0.03, 0.208, 1.10), (0.06, 0.045, 0.12), bevel=0.014)                  # utility pouch
B.sphere(gear, (0.175, 0.205, 1.30), 0.032, 12, (1.0, 0.9, 1.4))                    # frag grenade

# ---- assault pack / radio -----------------------------------------------------------------------------------------
B.box(gear, (-0.245, 0, 1.28), (0.14, 0.30, 0.38), bevel=0.04, seg=3)              # pack
B.box(gear, (-0.29, 0, 1.25), (0.05, 0.26, 0.30), bevel=0.02)                      # rear pocket
B.box(gear, (-0.245, 0, 1.485), (0.15, 0.30, 0.05), bevel=0.02)                   # lid
for s_ in (-1, 1):
    B.box(gear, (-0.24, s_ * 0.165, 1.22), (0.09, 0.05, 0.20), bevel=0.018)       # side pockets
    B.box(webbing, (-0.24, s_ * 0.192, 1.22), (0.09, 0.006, 0.02), bevel=0.002, seg=1)
for z in (1.16, 1.28, 1.40):
    B.box(webbing, (-0.262, 0, z), (0.018, 0.30, 0.022), bevel=0.004)              # compression straps
B.cyl(gear, (-0.26, -0.16, 1.47), (-0.26, 0.16, 1.47), 0.06, verts=16)              # bedroll
for y in (-0.10, 0.10):
    B.cyl(webbing, (-0.26, y, 1.405), (-0.26, y, 1.535), 0.012, verts=8)
B.box(patch, (-0.3165, 0, 1.30), (0.010, 0.14, 0.05), bevel=0.003)                  # rear ID patch
B.box(gear, (-0.18, -0.165, 1.44), (0.085, 0.07, 0.13), bevel=0.012)                # radio
B.cyl(gear, (-0.18, -0.165, 1.50), (-0.20, -0.165, 1.77), 0.004, verts=6)           # whip antenna
B.cyl(metal, (-0.18, -0.165, 1.50), (-0.18, -0.165, 1.52), 0.011, verts=10)
B.sweep(gear, [(-0.11, 0.17, 1.44), (-0.05, 0.25, 1.42), (0.07, 0.27, 1.30)], [0.006] * 3, n=6, round_ends=(False, False))   # hydration hose

# ---- arms: two-handed rifle hold. right = -Y ----------------------------------------------------------------------
# The right hand sits on the pistol grip (the `weapon` empty). The left arm is its own node pivoting at the shoulder; the
# game swings and stretches it so the glove meets each weapon's grip_l (rifle, SMG, pistol). `armL_hand` marks its rest reach.
R_H = Vector((0.234, -0.06, 1.23))
L_T0 = Vector((0.626, -0.06, 1.30))            # rest target: fore-end of an assault rifle held in front of the chest
R_EL = Vector((0.05, -0.31, 1.14))
L_SH = Vector((0.0, 0.235, 1.45))
L_EL = L_SH + (L_T0 - L_SH) * 0.48 + Vector((0.0, 0.03, -0.05))


def arm(Bx, s, sh, el, hand):
    Bx.sphere(uniform, sh, 0.068, 14, (1, 1, 0.95))                                 # deltoid
    Bx.sphere(vest, (sh[0], s * 0.255, sh[2] + 0.02), 0.048, 12, (1.2, 1, 0.55))    # shoulder pad
    sh, el, hand = Vector(sh), Vector(el), Vector(hand)
    Bx.sweep(uniform, [sh, (sh + el) / 2, el], [0.06, 0.052, 0.046], n=16, round_ends=(False, False))
    Bx.sphere(uniform, el, 0.047, 12)
    d = (hand - el).normalized()
    wr = hand - d * 0.055                                                           # wrist
    Bx.sweep(uniform, [el, (el + wr) / 2, wr], [0.046, 0.042, 0.034], n=16, round_ends=(False, False))
    Bx.sweep(uniform, [wr - d * 0.03, wr + d * 0.006], [0.038, 0.036], n=16, round_ends=(False, False))   # rolled cuff
    Bx.sphere(gear, (el[0] - 0.03, el[1] + s * 0.03, el[2] - 0.005), 0.04, 12, (0.8, 0.8, 1.0))          # elbow pad
    Bx.box(patch, (sh[0], s * 0.3, sh[2] - 0.05), (0.05, 0.012, 0.04), bevel=0.004)                      # sleeve ID patch


arm(B, -1, (0.0, -0.235, 1.45), R_EL, R_H)
hx, hy, hz = R_H                                # right glove wraps the pistol grip: palm behind, fingers around the front, thumb across
B.box(glove, (hx - 0.005, hy - 0.022, hz), (0.05, 0.03, 0.09), bevel=0.01)
for dz in (0.032, 0.011, -0.011, -0.032):
    B.sweep(glove, [(hx - 0.01, hy - 0.03, hz + dz), (hx + 0.030, hy - 0.028, hz + dz), (hx + 0.042, hy + 0.0, hz + dz), (hx + 0.022, hy + 0.022, hz + dz)], [0.0115] * 4, n=8, ref=(0, 0, 1), round_ends=(False, True))
B.sweep(glove, [(hx - 0.02, hy + 0.0, hz + 0.045), (hx + 0.005, hy + 0.026, hz + 0.055), (hx + 0.03, hy + 0.03, hz + 0.040)], [0.0125, 0.011, 0.010], n=8, round_ends=(False, True))

B.empty('weapon', tuple(R_H))
B.empty('head_top', (0.0, 0, 1.79))
body = B.finish(smooth_angle=50)

A = Builder('armL')                              # built in body space, then re-centred on the shoulder pivot
arm(A, 1, tuple(L_SH), tuple(L_EL), tuple(L_T0))
lx, ly, lz = L_T0                               # glove cups the fore-end from the left and below, thumb along the top
A.box(glove, (lx - 0.005, ly + 0.036, lz - 0.012), (0.085, 0.03, 0.07), bevel=0.012)
for dx in (0.032, 0.011, -0.011, -0.032):
    A.sweep(glove, [(lx + dx, ly + 0.048, lz - 0.012), (lx + dx, ly + 0.034, lz - 0.046), (lx + dx, ly - 0.008, lz - 0.050), (lx + dx, ly - 0.040, lz - 0.022)], [0.0112] * 4, n=8, ref=(1, 0, 0), round_ends=(False, True))
A.sweep(glove, [(lx - 0.03, ly + 0.045, lz + 0.005), (lx - 0.012, ly + 0.034, lz + 0.040), (lx + 0.025, ly + 0.0, lz + 0.046)], [0.0125, 0.011, 0.010], n=8, round_ends=(False, True))
armL = A.finish(smooth_angle=50)
for v in armL.data.vertices:
    v.co -= L_SH
armL.location = L_SH
hand_rest = bpy.data.objects.new('armL_hand', None)
hand_rest.empty_display_size = 0.02
bpy.context.scene.collection.objects.link(hand_rest)
hand_rest.parent = armL
hand_rest.location = L_T0 - L_SH


def leg(name, side):
    L = Builder(name)
    o = side      # +1 left (+Y), -1 right (-Y); local y = 0 is the leg centre line
    L.sweep(pants, [(0.0, 0, -0.02), (0.022, 0, -0.24), (0.042, 0, -0.46)], [0.098, 0.088, 0.066], n=18, squash=(1.0, 1.06), round_ends=(False, False))   # thigh
    L.sweep(pants, [(0.042, 0, -0.46), (0.022, 0, -0.64), (0.008, 0, -0.80)], [0.066, 0.058, 0.052], n=18, squash=(1.0, 1.06), round_ends=(False, False))   # shin
    L.sphere(pants, (0.042, 0, -0.46), 0.068, 14)
    L.box(gear, (0.10, 0, -0.47), (0.04, 0.10, 0.12), bevel=0.014)                  # knee pad
    L.box(gear, (0.105, 0, -0.47), (0.012, 0.05, 0.07), bevel=0.004)
    L.box(pants, (0.004, o * 0.091, -0.235), (0.09, 0.028, 0.15), bevel=0.012)      # cargo pocket
    L.box(pants, (0.004, o * 0.095, -0.17), (0.095, 0.028, 0.04), bevel=0.008)      # pocket flap
    L.box(metal, (0.05, o * 0.095, -0.17), (0.01, 0.012, 0.022), bevel=0.001, seg=1)
    L.box(pants, (-0.085, o * 0.0, -0.27), (0.02, 0.10, 0.12), bevel=0.008)         # rear pocket
    # boot: sole, upper, shaft and laces
    L.stack(boots, [(-0.920, 0.06, 0, 0.152, 0.057, 3.6), (-0.905, 0.06, 0, 0.154, 0.059, 3.6)], n=24)                                        # sole
    L.stack(boots, [(-0.905, 0.058, 0, 0.148, 0.055, 3.2), (-0.875, 0.056, 0, 0.148, 0.056, 3.0), (-0.835, 0.045, 0, 0.12, 0.054, 2.6),
                    (-0.795, 0.024, 0, 0.08, 0.052, 2.4), (-0.74, 0.012, 0, 0.062, 0.05, 2.2)], n=24)                                          # upper
    L.stack(boots, [(-0.74, 0.012, 0, 0.062, 0.05, 2.2), (-0.70, 0.008, 0, 0.056, 0.048, 2.2)], n=24, cap_top=False, cap_bot=False)
    L.stack(pants, [(-0.76, 0.008, 0, 0.066, 0.056, 2.2), (-0.72, 0.008, 0, 0.069, 0.058, 2.2), (-0.64, 0.012, 0, 0.066, 0.056, 2.2)], n=24, cap_top=False, cap_bot=False)
    for k in range(4):
        L.box(webbing, (0.062 + k * 0.012, 0, -0.8 - k * 0.0152), (0.006, 0.052, 0.008), bevel=0.001, seg=1)
    L.box(boots, (-0.092, 0, -0.875), (0.025, 0.09, 0.05), bevel=0.006)              # heel counter
    for x in (-0.06, -0.01, 0.04, 0.09, 0.14, 0.19):
        L.box(gear, (x, 0, -0.9235), (0.022, 0.108, 0.008), bevel=0.002, seg=1)      # tread lugs
    o_ = L.finish(smooth_angle=50)
    o_.location = (0, side * 0.10, 0.92)
    return o_


legL, legR = leg('legL', 1), leg('legR', -1)
root = group('soldier', [body, armL, legL, legR])
if prev:
    preview('soldier_side', (0.3, -3.6, 1.0), (0.0, 0, 0.88), w=520, h=760, lens=60)
    preview('soldier_front', (3.6, -1.4, 1.2), (0.0, 0, 0.88), w=520, h=760, lens=60)
    preview('soldier_head', (1.2, -0.7, 1.68), (0.0, 0, 1.6), w=620, h=620, lens=70)
    for o in [o for o in bpy.data.objects if o.type in ('CAMERA', 'LIGHT')]:
        bpy.data.objects.remove(o)
export(os.path.join(OUT, 'soldier.glb'), [root] + list(root.children_recursive))
if '--save-blend' in sys.argv:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'output', 'soldier.blend'))
