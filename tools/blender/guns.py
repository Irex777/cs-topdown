"""The nine weapons of the arsenal, modelled procedurally from bevelled primitives.  Each build_* function fills the current
Blender scene and returns the root node.  Layout: +X is the muzzle direction, bore axis at y=0 z=0, origin near the receiver.

Named empties (the game reads them from the glTF): muzzle, eject, ads (iron-sight eye point), mount_optic, mount_muzzle, mount_under,
grip_r (right hand), grip_l (left hand).  Magazine variants are separate nodes: mag_std, mag_ext and, where they fit, mag_drum.
"""
import math

from lib import *  # noqa: F401,F403

TAN = srgb('#b39257')
TAN_D = srgb('#8f7448')
POLY = srgb('#1f2126')
POLY_L = srgb('#2f323a')
GUNM = srgb('#3b4048')
STEEL = srgb('#9aa0a9')
OLIVE = srgb('#55603f')
OLIVE_D = srgb('#3f4a2f')
WOOD = srgb('#8a5a32')
RUBBER = srgb('#101114')
BRASS = srgb('#b58a3c')


def M():
    return dict(
        tan=mat('cerakote_tan', TAN, 0.35, 0.5), tan_d=mat('cerakote_tan_dark', TAN_D, 0.35, 0.55),
        poly=mat('polymer_black', POLY, 0.0, 0.62), poly_l=mat('polymer_grey', POLY_L, 0.0, 0.58),
        steel=mat('steel', STEEL, 1.0, 0.28), gunm=mat('gunmetal', GUNM, 1.0, 0.38), rubber=mat('rubber', RUBBER, 0.0, 0.9),
        olive=mat('cerakote_olive', OLIVE, 0.35, 0.55), olive_d=mat('cerakote_olive_dark', OLIVE_D, 0.35, 0.6),
        wood=mat('wood', WOOD, 0.0, 0.55), brass=mat('brass', BRASS, 1.0, 0.3),
        slot=mat('slot', (0.008, 0.008, 0.009), 0.0, 0.9), red=mat('red_dot', (1.0, 0.05, 0.03), 0.0, 0.3, emit=(1, 0.05, 0.03), emit_strength=6),
    )


# ------------------------------------------------------------------------------------------------ shared parts
def rail(B, m, slot, x0, x1, z, w=0.021, h=0.006, pitch=0.010):
    """Picatinny rail: base plate with cross slots"""
    B.box(m, ((x0 + x1) / 2, 0, z), (x1 - x0, w, h), bevel=0.0007, seg=1)
    x = x0 + pitch * 0.5
    while x < x1 - pitch * 0.4:
        B.box(m, (x, 0, z + h / 2 + 0.0008), (pitch * 0.42, w * 0.96, 0.0026), bevel=0.0004, seg=1)
        x += pitch


def mlok(B, slot, x0, x1, y, z, n=4, side=1, length=0.024, height=0.007):
    """rows of M-LOK slots on the side (side=+1 left, -1 right) of a handguard"""
    step = (x1 - x0) / n
    for i in range(n):
        B.box(slot, (x0 + step * (i + 0.5), y * side, z), (length, 0.0012, height), bevel=0.0018, seg=2)


def vents(B, slot, x0, x1, z, w, n, r=0.0035):
    """round cooling holes drawn as dark discs on both sides"""
    step = (x1 - x0) / n
    for i in range(n):
        for s in (1, -1):
            B.cyl(slot, (x0 + step * (i + 0.5), s * (w / 2 + 0.0004), z), (x0 + step * (i + 0.5), s * (w / 2 - 0.0002), z), r, verts=10)


def grip_ridges(B, m, c, size, rot, n=7):
    for i in range(n):
        z = c[2] - size[2] / 2 + (i + 0.6) * size[2] / (n + 0.2)
        B.box(m, (c[0], c[1], z), (size[0] + 0.0016, size[1] + 0.0016, 0.0022), bevel=0.0006, rot=rot, seg=1)


def curved_mag(B, m, top, length, width, depth, curve_deg, n=8, ribs=True, m2=None, cw=0.0):
    """magazine hanging from `top` (x,y,z of its top centre); curve_deg = total forward bend"""
    x, z = top[0], top[2]
    seg = length / n
    ang = 0.0
    for i in range(n):
        a0 = math.radians(ang)
        ang += curve_deg / n
        a1 = math.radians(ang)
        am = (a0 + a1) / 2
        cx = x + math.sin(am) * seg / 2
        cz = z - math.cos(am) * seg / 2
        B.box(m, (cx, top[1], cz), (depth, width, seg * 1.04), bevel=0.0015, rot=(0, math.degrees(am), 0), seg=1)
        if ribs and i % 2 == 1 and m2 is not None:
            B.box(m2, (cx + math.cos(am) * (depth / 2 + 0.0002), top[1], cz + math.sin(am) * 0.0), (0.0016, width * 0.8, seg * 0.55), bevel=0.0004, rot=(0, math.degrees(am), 0), seg=1)
        x += math.sin(am) * seg
        z -= math.cos(am) * seg
    # floor plate
    B.box(m2 or m, (x + 0.002, top[1], z - 0.004), (depth + 0.006, width + 0.004, 0.01), bevel=0.002, rot=(0, curve_deg, 0))
    return x, z


def scope_rings(B, m, x, z, r=0.0175, w=0.02):
    B.cyl(m, (x, -0.0, z), (x + w, 0.0, z), r, verts=24)


# ------------------------------------------------------------------------------------------------ AR-7 assault rifle
def build_ar7(mm):
    B = Builder('ar7_body')
    tan, tan_d, poly, gunm, steel, slot, rubber = mm['tan'], mm['tan_d'], mm['poly'], mm['gunm'], mm['steel'], mm['slot'], mm['rubber']
    # receivers
    B.box(tan, (0.01, 0, 0.014), (0.235, 0.032, 0.052), bevel=0.004)
    B.box(tan_d, (-0.012, 0, -0.030), (0.175, 0.031, 0.052), bevel=0.004)
    B.box(tan, (0.052, 0, -0.078), (0.056, 0.034, 0.058), bevel=0.004)            # magwell
    B.box(slot, (0.03, -0.0166, 0.020), (0.052, 0.0012, 0.021), bevel=0.003)      # ejection port (right side)
    B.box(tan, (0.03, -0.0176, 0.020), (0.052, 0.0012, 0.004), bevel=0.001, seg=1)
    B.cyl(gunm, (0.055, -0.0165, 0.006), (0.055, -0.0225, 0.006), 0.0055, verts=14, bevel=0.001)    # forward assist
    B.box(poly, (-0.103, 0, 0.038), (0.024, 0.02, 0.012), bevel=0.002)             # charging handle
    B.box(poly, (-0.113, 0, 0.038), (0.008, 0.032, 0.014), bevel=0.002)
    # top rail + iron sights
    rail(B, tan, slot, -0.105, 0.44, 0.043, w=0.022)
    B.box(gunm, (-0.085, 0, 0.056), (0.016, 0.024, 0.02), bevel=0.002)             # rear sight body
    B.cyl(steel, (-0.093, 0, 0.0655), (-0.077, 0, 0.0655), 0.0055, verts=16)       # aperture ring
    B.cyl(slot, (-0.094, 0, 0.0655), (-0.076, 0, 0.0655), 0.0028, verts=12)
    B.box(gunm, (0.43, 0, 0.060), (0.012, 0.008, 0.038), bevel=0.0015)            # front sight post
    B.box(steel, (0.43, 0, 0.083), (0.003, 0.0028, 0.012), bevel=0.0005, seg=1)
    # trigger group
    B.box(poly, (0.0, 0, -0.064), (0.10, 0.0035, 0.004), bevel=0.001, seg=1)       # guard bottom
    B.box(poly, (0.048, 0, -0.052), (0.005, 0.0035, 0.024), bevel=0.001, seg=1)    # guard front
    B.box(gunm, (-0.006, 0, -0.049), (0.006, 0.006, 0.02), bevel=0.001, rot=(0, -18, 0), seg=1)   # trigger
    B.cyl(steel, (-0.045, 0.0165, -0.022), (-0.045, 0.0235, -0.022), 0.0045, verts=12)            # selector lever
    B.box(steel, (-0.045, 0.0225, -0.018), (0.016, 0.003, 0.004), bevel=0.0008, seg=1)
    B.cyl(steel, (0.045, -0.0172, -0.062), (0.045, -0.0225, -0.062), 0.0045, verts=12)            # mag release
    B.box(steel, (0.0, 0.0163, -0.04), (0.02, 0.0024, 0.006), bevel=0.001, seg=1)    # bolt release
    # pistol grip
    B.box(poly, (-0.083, 0, -0.105), (0.034, 0.034, 0.100), bevel=0.006, rot=(0, 16, 0))
    grip_ridges(B, poly, (-0.083, 0, -0.105), (0.034, 0.034, 0.09), (0, 16, 0), 8)
    B.box(poly, (-0.08, 0, -0.156), (0.036, 0.036, 0.008), bevel=0.003, rot=(0, 16, 0))
    # handguard (black polymer, M-LOK, vents)
    B.box(poly, (0.285, 0, 0.0), (0.29, 0.046, 0.05), bevel=0.007)
    B.box(poly, (0.124, 0, 0.0), (0.03, 0.05, 0.056), bevel=0.004)                 # delta ring / nut
    B.box(gunm, (0.437, 0, 0.0), (0.014, 0.048, 0.052), bevel=0.003)               # end cap
    for zz, side_z in ((0.014, 0.0), (-0.014, 0.0)):
        for side in (1, -1):
            mlok(B, slot, 0.17, 0.42, 0.0234, zz, 5, side, 0.026, 0.0065)
    mlok(B, slot, 0.17, 0.42, 0.0, -0.0254, 5, 1, 0.026, 0.0065) if False else None
    rail_under = 0.025
    for i in range(5):
        B.box(slot, (0.17 + (0.25 / 5) * (i + 0.5), 0, -rail_under), (0.026, 0.0065, 0.0012), bevel=0.0018, seg=2)
    # barrel, gas block, flash hider
    B.cyl(gunm, (0.44, 0, 0), (0.545, 0, 0), 0.0078, verts=18)
    B.box(gunm, (0.425, 0, 0.0), (0.03, 0.02, 0.022), bevel=0.003)
    B.cyl(steel, (0.545, 0, 0), (0.60, 0, 0), 0.0108, verts=20, bevel=0.0012)
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        B.box(slot, (0.578, 0.0108 * math.cos(a), 0.0108 * math.sin(a)), (0.028, 0.0026, 0.0026), bevel=0.0005, rot=(math.degrees(a), 0, 0), seg=1)
    B.cyl(slot, (0.599, 0, 0), (0.6005, 0, 0), 0.0058, verts=12)
    # stock
    B.cyl(poly, (-0.112, 0, 0.004), (-0.262, 0, 0.004), 0.0155, verts=20)         # buffer tube
    B.box(poly, (-0.245, 0, -0.004), (0.16, 0.040, 0.066), bevel=0.008)
    B.box(poly, (-0.245, 0, 0.032), (0.14, 0.03, 0.006), bevel=0.002)             # cheek riser
    B.box(poly, (-0.337, 0, -0.008), (0.024, 0.042, 0.098), bevel=0.006, rot=(0, -6, 0))
    B.box(rubber, (-0.351, 0, -0.008), (0.006, 0.040, 0.094), bevel=0.002, rot=(0, -6, 0), seg=1)
    for k in range(6):
        B.box(rubber, (-0.352, 0, -0.045 + k * 0.0165), (0.0058, 0.041, 0.005), bevel=0.001, rot=(0, -6, 0), seg=1)
    B.box(steel, (-0.19, 0, -0.03), (0.02, 0.006, 0.012), bevel=0.002)             # stock lock lever
    B.cyl(steel, (-0.06, 0.0, -0.058), (-0.06, 0.0, -0.062), 0.006, verts=12)     # sling loop
    for name, loc in (('muzzle', (0.60, 0, 0)), ('eject', (0.03, -0.02, 0.02)), ('ads', (-0.085, 0, 0.0655)), ('mount_optic', (0.02, 0, 0.0505)),
                      ('mount_muzzle', (0.60, 0, 0)), ('mount_under', (0.32, 0, -0.027)), ('grip_r', (-0.086, 0, -0.095)), ('grip_l', (0.30, 0, -0.03))):
        B.empty(name, loc)
    body = B.finish()

    mags = {}
    for tag, length, n, curve in (('mag_std', 0.115, 8, 11), ('mag_ext', 0.155, 10, 14)):
        MB = Builder(tag)
        curved_mag(MB, mm['poly'], (0.052, 0, -0.106), length, 0.0245, 0.026, curve, n, True, mm['poly_l'])
        mags[tag] = MB.finish()
    MB = Builder('mag_drum')
    curved_mag(MB, mm['poly'], (0.052, 0, -0.106), 0.03, 0.0245, 0.026, 0, 2, False, mm['poly_l'])
    MB.cyl(mm['poly'], (0.06, -0.038, -0.185), (0.06, 0.038, -0.185), 0.075, verts=36, bevel=0.005)
    MB.cyl(mm['poly_l'], (0.06, -0.0395, -0.185), (0.06, 0.0395, -0.185), 0.030, verts=24)
    MB.cyl(mm['steel'], (0.06, -0.041, -0.185), (0.06, 0.041, -0.185), 0.007, verts=12)
    mags['mag_drum'] = MB.finish()
    return group('ar7', [body] + list(mags.values()))
