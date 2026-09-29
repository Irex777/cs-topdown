"""Attachments (optics, muzzle devices, rail/grip accessories) and the first-person hands -> src/client/assets/attachments.glb, hands.glb.
Every attachment node has its origin at its mount point; optics carry a `sight` empty (where the eye lines up), muzzle devices a `muzzle` empty.
python3 tools/blender/build_attachments.py [--preview]"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *  # noqa: E402,F401,F403
import guns  # noqa: E402

prev = '--preview' in sys.argv
reset()
mm = guns.M()
poly, poly_l, steel, gunm, slot, rubber = mm['poly'], mm['poly_l'], mm['steel'], mm['gunm'], mm['slot'], mm['rubber']
glass = mat('glass', (0.35, 0.6, 0.75), 0.0, 0.05, alpha=0.32)
glass_dark = mat('glass_dark', (0.02, 0.05, 0.08), 0.0, 0.05, alpha=0.55)
lens_amber = mat('lens_amber', (0.6, 0.35, 0.05), 0.0, 0.1, alpha=0.6)
led_white = mat('led_white', (1, 1, 0.9), 0.0, 0.3, emit=(1, 0.97, 0.85), emit_strength=8)
laser_red = mat('laser_red', (1, 0.1, 0.05), 0.0, 0.3, emit=(1, 0.05, 0.03), emit_strength=8)
nodes = []


def optic_reddot():
    B = Builder('optic_reddot')
    B.box(gunm, (0, 0, 0.004), (0.05, 0.03, 0.008), bevel=0.0015)                          # rail clamp
    B.box(poly, (0.0, 0, 0.011), (0.06, 0.036, 0.007), bevel=0.002)                       # base
    for s in (1, -1):
        B.box(poly, (0.002, s * 0.0175, 0.028), (0.056, 0.004, 0.03), bevel=0.0018)      # side walls
    B.box(poly, (0.0, 0, 0.0455), (0.056, 0.038, 0.005), bevel=0.0018)                    # hood
    B.box(gunm, (0.026, 0, 0.0275), (0.006, 0.028, 0.026), bevel=0.001) if False else None
    B.box(glass, (0.022, 0, 0.0285), (0.0012, 0.03, 0.026), bevel=0.0003, seg=1)          # lens
    B.cyl(mm['red'], (0.021, 0, 0.029), (0.0225, 0, 0.029), 0.0016, verts=8)             # the dot
    B.box(steel, (0.012, 0.0195, 0.014), (0.006, 0.002, 0.006), bevel=0.0005, seg=1)      # adjustment screw
    B.empty('sight', (0.0, 0, 0.029))
    return B.finish()


def optic_holo():
    B = Builder('optic_holo')
    B.box(gunm, (0, 0, 0.004), (0.06, 0.03, 0.008), bevel=0.0015)
    B.box(poly, (0.0, 0, 0.011), (0.085, 0.042, 0.008), bevel=0.002)
    for s in (1, -1):
        B.box(poly, (0.0, s * 0.0205, 0.033), (0.078, 0.005, 0.045), bevel=0.002)
    B.box(poly, (-0.0, 0, 0.0575), (0.078, 0.046, 0.006), bevel=0.002)
    B.box(poly, (0.0385, 0, 0.038), (0.005, 0.04, 0.02), bevel=0.0015)                   # front lower bar
    B.box(glass, (0.022, 0, 0.0345), (0.0012, 0.036, 0.038), bevel=0.0003, seg=1)
    B.cyl(mm['red'], (0.02, 0, 0.034), (0.0225, 0, 0.034), 0.0017, verts=8)
    for k in range(8):
        a = k * math.pi / 4
        B.cyl(mm['red'], (0.0205, 0.0085 * math.cos(a), 0.034 + 0.0085 * math.sin(a)), (0.0218, 0.0085 * math.cos(a), 0.034 + 0.0085 * math.sin(a)), 0.0006, verts=6)
    B.empty('sight', (0.0, 0, 0.034))
    return B.finish()


def optic_acog():
    B = Builder('optic_acog')
    B.box(gunm, (0, 0, 0.004), (0.06, 0.03, 0.008), bevel=0.0015)
    B.box(poly, (0.0, 0, 0.0115), (0.1, 0.032, 0.007), bevel=0.002)
    B.cyl(poly, (-0.055, 0, 0.033), (0.06, 0, 0.033), 0.0205, verts=28)                   # main tube
    B.cyl(poly_l, (0.06, 0, 0.033), (0.098, 0, 0.033), 0.0205, r2=0.0295, verts=28)      # objective bell
    B.cyl(poly_l, (-0.055, 0, 0.033), (-0.085, 0, 0.033), 0.0205, r2=0.0165, verts=28)   # eyepiece
    B.cyl(glass_dark, (0.0985, 0, 0.033), (0.0992, 0, 0.033), 0.0265, verts=28)
    B.cyl(glass_dark, (-0.0855, 0, 0.033), (-0.0862, 0, 0.033), 0.014, verts=24)
    B.box(steel, (0.0, 0, 0.0555), (0.02, 0.008, 0.006), bevel=0.001, seg=1)             # turret cap
    B.box(mm['tan'], (0.0, 0, 0.0595), (0.09, 0.012, 0.008), bevel=0.002)                # tan fibre-optic housing
    B.box(steel, (0.0, 0.0215, 0.033), (0.018, 0.005, 0.014), bevel=0.001, seg=1)
    B.cyl(mm['red'], (0.0985, 0, 0.033), (0.0995, 0, 0.033), 0.0012, verts=6)
    for x in (-0.03, 0.035):
        B.cyl(gunm, (x, 0, 0.033), (x + 0.008, 0, 0.033), 0.0222, verts=28)
    B.empty('sight', (-0.06, 0, 0.033))
    return B.finish()


def optic_sniper():
    B = Builder('optic_sniper')
    for x in (-0.07, 0.07):
        B.box(gunm, (x, 0, 0.007), (0.04, 0.034, 0.014), bevel=0.002)
        B.cyl(gunm, (x - 0.008, 0, 0.0475), (x + 0.008, 0, 0.0475), 0.0285, verts=28)
        B.box(gunm, (x, 0, 0.022), (0.02, 0.026, 0.03), bevel=0.002)
    B.cyl(poly, (-0.14, 0, 0.0475), (0.14, 0, 0.0475), 0.0225, verts=28)                  # main tube
    B.cyl(poly_l, (0.14, 0, 0.0475), (0.2, 0, 0.0475), 0.0225, r2=0.0345, verts=28)      # objective bell
    B.cyl(poly_l, (-0.14, 0, 0.0475), (-0.185, 0, 0.0475), 0.0225, r2=0.0185, verts=28)
    B.cyl(rubber, (-0.185, 0, 0.0475), (-0.2, 0, 0.0475), 0.0185, r2=0.0215, verts=28)   # eye cup
    B.cyl(glass_dark, (0.2005, 0, 0.0475), (0.2012, 0, 0.0475), 0.031, verts=28)
    B.cyl(glass_dark, (-0.2, 0, 0.0475), (-0.2008, 0, 0.0475), 0.017, verts=24)
    B.cyl(poly, (0.0, 0, 0.0475), (0.05, 0, 0.0475), 0.0265, verts=28)                     # turret cluster
    B.cyl(steel, (0.025, 0, 0.0475), (0.025, 0, 0.0765), 0.011, verts=20, bevel=0.001)   # elevation turret
    B.cyl(steel, (0.025, -0.0265, 0.0475), (0.025, -0.0545, 0.0475), 0.011, verts=20, bevel=0.001)   # windage turret
    B.cyl(poly_l, (0.025, 0.0265, 0.0475), (0.025, 0.045, 0.0475), 0.014, verts=20)     # parallax knob
    for k in range(10):
        a = k * math.pi / 5
        B.box(slot, (0.025 + 0.0116 * math.cos(a), 0.0, 0.0765 + 0.0) if False else (0.025, 0, 0.0765 - 0.002), (0.001, 0.001, 0.001), seg=1) if False else None
    B.empty('sight', (-0.2, 0, 0.0475))
    return B.finish()


def muzzle_supp():
    B = Builder('muzzle_supp')
    B.cyl(gunm, (0.0, 0, 0), (0.2, 0, 0), 0.0225, verts=32, bevel=0.002)
    B.cyl(steel, (0.0, 0, 0), (0.022, 0, 0), 0.0195, verts=28, bevel=0.001)              # rear mount
    for i in range(6):
        B.cyl(poly_l, (0.03 + i * 0.03, 0, 0), (0.036 + i * 0.03, 0, 0), 0.0238, verts=32)   # heat bands
    B.cyl(steel, (0.2, 0, 0), (0.207, 0, 0), 0.021, verts=28)
    B.cyl(slot, (0.2065, 0, 0), (0.2075, 0, 0), 0.0075, verts=16)
    B.empty('muzzle', (0.207, 0, 0))
    return B.finish()


def muzzle_comp():
    B = Builder('muzzle_comp')
    B.cyl(steel, (0.0, 0, 0), (0.07, 0, 0), 0.0165, verts=28, bevel=0.0015)
    for i in range(3):
        B.box(slot, (0.024 + i * 0.014, 0, 0.0), (0.005, 0.036, 0.008), bevel=0.001, seg=1)
        B.box(slot, (0.024 + i * 0.014, 0, 0.0), (0.005, 0.008, 0.036), bevel=0.001, seg=1)
    B.cyl(gunm, (0.0, 0, 0), (0.014, 0, 0), 0.0185, verts=28)
    B.cyl(slot, (0.0695, 0, 0), (0.0708, 0, 0), 0.0072, verts=14)
    B.empty('muzzle', (0.07, 0, 0))
    return B.finish()


def under_vgrip():
    B = Builder('under_vgrip')
    B.box(gunm, (0.0, 0, -0.004), (0.06, 0.03, 0.008), bevel=0.0015)
    B.box(poly, (0.0, 0, -0.012), (0.036, 0.03, 0.01), bevel=0.002)
    B.cyl(poly, (0.0, 0, -0.016), (0.0, 0, -0.105), 0.0155, r2=0.0175, verts=22, bevel=0.002)
    for i in range(7):
        B.cyl(poly_l, (0.0, 0, -0.03 - i * 0.0105), (0.0, 0, -0.0335 - i * 0.0105), 0.0185, verts=22)
    B.cyl(rubber, (0.0, 0, -0.1), (0.0, 0, -0.108), 0.0185, verts=22, bevel=0.002)
    return B.finish()


def under_agrip():
    B = Builder('under_agrip')
    B.box(gunm, (0.0, 0, -0.004), (0.07, 0.03, 0.008), bevel=0.0015)
    B.box(poly, (0.0, 0, -0.012), (0.07, 0.03, 0.01), bevel=0.002)
    B.box(poly, (0.04, 0, -0.05), (0.032, 0.03, 0.086), bevel=0.01, rot=(0, -36, 0))
    for i in range(5):
        B.box(poly_l, (0.0225 + i * 0.0068, 0, -0.03 - i * 0.0128), (0.0025, 0.026, 0.012), bevel=0.0007, rot=(0, -36, 0), seg=1) if False else None
    B.box(rubber, (0.062, 0, -0.088), (0.038, 0.03, 0.01), bevel=0.003, rot=(0, -36, 0))
    return B.finish()


def under_laser():
    B = Builder('under_laser')
    B.box(gunm, (0.0, 0, -0.004), (0.07, 0.03, 0.008), bevel=0.0015)
    B.box(poly_l, (0.0, 0, -0.022), (0.085, 0.034, 0.028), bevel=0.005)
    B.box(gunm, (0.045, 0, -0.022), (0.006, 0.03, 0.024), bevel=0.001)
    B.cyl(laser_red, (0.0475, 0.008, -0.0185), (0.0495, 0.008, -0.0185), 0.0048, verts=14)   # laser aperture
    B.cyl(steel, (0.0475, -0.008, -0.0185), (0.0495, -0.008, -0.0185), 0.0048, verts=14)     # IR illuminator
    B.box(poly, (-0.02, -0.0175, -0.02), (0.02, 0.004, 0.01), bevel=0.0015, seg=1)           # switch
    B.box(steel, (0.0, 0.0185, -0.022), (0.03, 0.002, 0.012), bevel=0.0008, seg=1)           # windage screws plate
    return B.finish()


def under_flash():
    B = Builder('under_flash')
    B.box(gunm, (0.0, 0, -0.004), (0.06, 0.03, 0.008), bevel=0.0015)
    B.box(gunm, (0.0, 0, -0.013), (0.05, 0.026, 0.01), bevel=0.002)
    B.cyl(poly, (-0.05, 0, -0.03), (0.05, 0, -0.03), 0.0175, verts=26, bevel=0.002)
    B.cyl(steel, (0.05, 0, -0.03), (0.076, 0, -0.03), 0.0175, r2=0.023, verts=26)         # bezel
    B.cyl(led_white, (0.0758, 0, -0.03), (0.0765, 0, -0.03), 0.019, verts=26)
    B.cyl(poly_l, (-0.02, 0, -0.03), (0.02, 0, -0.03), 0.0185, verts=26)
    B.box(rubber, (-0.05, -0.0175, -0.03), (0.016, 0.006, 0.01), bevel=0.002, seg=1)     # tail switch
    return B.finish()


made = [optic_reddot(), optic_holo(), optic_acog(), optic_sniper(), muzzle_supp(), muzzle_comp(), under_vgrip(), under_agrip(), under_laser(), under_flash()]
# lay them side by side (only for the preview; the game positions each node itself)
xs = 0.0
for o in made:
    o.location = (xs, 0, 0)
    xs += 0.28
root = group('attachments', made)
if prev:
    preview('attachments', (1.2, -1.5, 0.5), (1.0, 0, 0.0), w=1400, h=500, lens=42)
    for o in [o for o in bpy.data.objects if o.type in ('CAMERA', 'LIGHT')]:
        bpy.data.objects.remove(o)
for o in made:
    o.location = (0, 0, 0)
export(os.path.join(OUT, 'attachments.glb'), [root] + list(root.children_recursive))

# ------------------------------------------------------------------------------------------------ hands and forearms
reset()
mm = guns.M()
glove = mat('glove', srgb('#2a2c31'), 0.0, 0.75)
glove_l = mat('glove_light', srgb('#3c3f47'), 0.0, 0.7)
sleeve = mat('sleeve', srgb('#5a6a45'), 0.0, 0.85)
skin = mat('skin', srgb('#c99a78'), 0.0, 0.6)
steel = mm['steel']


def hand(name, grip_mode):
    B = Builder(name)
    # palm + back of hand
    B.box(glove, (0.0, 0, 0.0), (0.085, 0.09, 0.036), bevel=0.01)
    B.box(glove_l, (0.0, 0, 0.0195), (0.05, 0.05, 0.004), bevel=0.002)                 # knuckle pad
    # fingers: curled around the grip (fist) or extended under the handguard (support hand)
    for i in range(4):
        y = -0.033 + i * 0.022
        if grip_mode == 'fist':
            B.box(glove, (0.05, y, -0.012), (0.026, 0.02, 0.026), bevel=0.006)
            B.box(glove, (0.062, y, -0.035), (0.022, 0.02, 0.026), bevel=0.006, rot=(0, -50, 0))
        else:
            B.box(glove, (0.062, y, 0.0), (0.05, 0.02, 0.026), bevel=0.006)
            B.box(glove, (0.096, y, -0.014), (0.03, 0.02, 0.024), bevel=0.006, rot=(0, -35, 0))
    B.box(glove, (0.02, -0.056, -0.006), (0.05, 0.02, 0.026), bevel=0.007, rot=(0, 0, -25))   # thumb
    B.box(glove, (0.05, -0.066, -0.0), (0.03, 0.02, 0.022), bevel=0.007, rot=(0, 0, -35))
    B.box(mat('cuff', srgb('#1c1e22'), 0.0, 0.8), (-0.05, 0, 0.0), (0.03, 0.098, 0.05), bevel=0.008)   # wrist strap
    B.empty('wrist', (-0.06, 0, 0))
    return B.finish()


def forearm():
    B = Builder('forearm')
    B.cyl(sleeve, (0.0, 0, 0), (1.0, 0, 0), 0.05, r2=0.062, verts=20)                   # unit-length sleeve, scaled by the game
    B.cyl(mat('cuff2', srgb('#3c4630'), 0.0, 0.9), (0.0, 0, 0), (0.06, 0, 0), 0.0525, verts=20)
    return B.finish()


hr = hand('hand_r', 'fist')
hl = hand('hand_l', 'open')
fa = forearm()
hl.location = (0, 0.3, 0)
fa.location = (0, -0.3, 0)
root2 = group('hands', [hr, hl, fa])
if prev:
    preview('hands', (0.45, -0.7, 0.3), (0.0, 0.1, 0.0), w=900, h=500, lens=50)
    for o in [o for o in bpy.data.objects if o.type in ('CAMERA', 'LIGHT')]:
        bpy.data.objects.remove(o)
for o in (hl, fa, hr):
    o.location = (0, 0, 0)
export(os.path.join(OUT, 'hands.glb'), [root2] + list(root2.children_recursive))
