"""The soldier model -> src/client/assets/soldier.glb.  Feet on z=0, facing +X, right side is -Y (glTF: +Z after export).
Named nodes: legL / legR (pivot at the hip, the game swings them), weapon (empty where the gun's right-hand grip goes), head_top.
Materials the game re-tints per team and class: uniform, helmet, vest, accent.   python3 tools/blender/build_characters.py [--preview]"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *  # noqa: E402,F401,F403

prev = '--preview' in sys.argv
reset()
uniform = mat('uniform', srgb('#5a6a45'), 0.0, 0.85)
pants = mat('pants', srgb('#3a4030'), 0.0, 0.9)
vest = mat('vest', srgb('#474b40'), 0.0, 0.8)
helmet = mat('helmet', srgb('#4a5a3a'), 0.05, 0.6)
accent = mat('accent', srgb('#e0703a'), 0.0, 0.6)
skin = mat('skin', srgb('#c99a78'), 0.0, 0.55)
glove = mat('glove', srgb('#24262b'), 0.0, 0.75)
boots = mat('boots', srgb('#1b1c1f'), 0.0, 0.7)
gear = mat('gear', srgb('#2d3027'), 0.0, 0.8)
lens = mat('goggle', srgb('#0b1116'), 0.6, 0.15)
metal = mat('metal', srgb('#8a9099'), 1.0, 0.35)

B = Builder('soldier_body')
# torso
B.box(uniform, (0.0, 0, 1.27), (0.24, 0.40, 0.46), bevel=0.05)
B.box(vest, (0.015, 0, 1.28), (0.27, 0.43, 0.34), bevel=0.04)
B.box(accent, (0.16, 0, 1.36), (0.02, 0.30, 0.05), bevel=0.008)              # chest stripe = class colour
for y in (-0.13, 0.0, 0.13):
    B.box(gear, (0.155, y, 1.17), (0.07, 0.10, 0.12), bevel=0.018)             # magazine pouches
B.box(gear, (0.0, 0, 1.03), (0.25, 0.40, 0.09), bevel=0.02)                    # belt
B.box(gear, (0.02, -0.235, 1.03), (0.08, 0.05, 0.14), bevel=0.015)             # holster
B.box(pants, (0.0, 0, 0.93), (0.22, 0.36, 0.17), bevel=0.04)                   # pelvis
B.box(gear, (-0.19, 0, 1.30), (0.16, 0.32, 0.42), bevel=0.04)                  # backpack
B.cyl(gear, (-0.19, -0.14, 1.52), (-0.19, 0.14, 1.52), 0.06, verts=14)         # bedroll
B.cyl(metal, (-0.10, 0.10, 1.5), (-0.10, 0.16, 1.5), 0.012, verts=8)
# shoulders + neck + head
for s in (1, -1):
    B.sphere(uniform, (0.0, s * 0.235, 1.46), 0.075, 12)
    B.sphere(vest, (0.0, s * 0.245, 1.49), 0.055, 10, (1, 1, 0.7))
B.cyl(skin, (0.0, 0, 1.49), (0.01, 0, 1.58), 0.05, verts=14)
B.sphere(skin, (0.02, 0, 1.64), 0.105, 18, (1, 0.9, 1.05))
B.sphere(helmet, (0.0, 0, 1.685), 0.135, 20, (1.02, 0.98, 0.72))
B.box(helmet, (0.0, 0, 1.62), (0.28, 0.27, 0.03), bevel=0.012)                 # helmet rim
B.box(lens, (0.105, 0, 1.655), (0.04, 0.17, 0.05), bevel=0.012)               # goggles
B.box(gear, (0.105, 0, 1.655), (0.03, 0.19, 0.008), bevel=0.003, rot=(0, 0, 0))
B.box(gear, (0.09, 0.085, 1.73), (0.05, 0.03, 0.03), bevel=0.008)              # helmet NVG mount
B.cyl(gear, (0.03, -0.095, 1.60), (0.05, -0.095, 1.53), 0.006, verts=6)        # chin strap
# arms: two-handed rifle hold. right = -Y
R_H, L_H = (0.34, -0.09, 1.235), (0.60, 0.03, 1.30)
for s, hand in ((-1, R_H), (1, L_H)):
    sh = (0.0, s * 0.245, 1.44)
    el = (0.13, s * 0.27, 1.21) if s < 0 else (0.20, s * 0.24, 1.19)
    B.cyl(uniform, sh, el, 0.058, r2=0.05, verts=14)
    B.sphere(uniform, el, 0.052, 10)
    B.cyl(uniform, el, hand, 0.048, r2=0.042, verts=14)
    B.sphere(glove, hand, 0.05, 12, (1.3, 0.9, 0.9))
    B.box(gear, (el[0] * 0.85 + hand[0] * 0.15, el[1], el[2] + 0.02), (0.06, 0.10, 0.05), bevel=0.015, rot=(0, 0, 0))   # elbow pad
B.empty('weapon', (R_H[0] + 0.086, R_H[1], R_H[2] + 0.095))
B.empty('head_top', (0.0, 0, 1.78))
body = B.finish()


def leg(name, side):
    L = Builder(name)
    L.box(pants, (0.01, 0, -0.22), (0.17, 0.16, 0.46), bevel=0.05)                # thigh
    L.box(gear, (0.11, 0, -0.16), (0.04, 0.12, 0.13), bevel=0.012)                 # cargo pocket
    L.box(pants, (0.03, 0, -0.66), (0.135, 0.14, 0.42), bevel=0.04)                # shin
    L.box(gear, (0.10, 0, -0.45), (0.04, 0.12, 0.11), bevel=0.02)                  # knee pad
    L.box(boots, (0.07, 0, -0.85), (0.29, 0.14, 0.11), bevel=0.03)                 # boot
    L.box(boots, (0.03, 0, -0.78), (0.14, 0.145, 0.10), bevel=0.02)
    L.box(gear, (0.075, 0, -0.905), (0.30, 0.15, 0.025), bevel=0.005)              # sole
    o = L.finish()
    o.location = (0, side * 0.10, 0.92)
    return o


legL, legR = leg('legL', 1), leg('legR', -1)
root = group('soldier', [body, legL, legR])
if prev:
    preview('soldier_side', (0.3, -3.6, 1.0), (0.0, 0, 0.88), w=520, h=760, lens=60)
    preview('soldier_front', (3.6, -1.4, 1.2), (0.0, 0, 0.88), w=520, h=760, lens=60)
    for o in [o for o in bpy.data.objects if o.type in ('CAMERA', 'LIGHT')]:
        bpy.data.objects.remove(o)
export(os.path.join(OUT, 'soldier.glb'), [root] + list(root.children_recursive))
