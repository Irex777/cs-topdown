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
POLY_L = srgb('#32353d')
GUNM = srgb('#3b4048')
STEEL = srgb('#9aa0a9')
OLIVE = srgb('#55603f')
OLIVE_D = srgb('#3f4a2f')
WOOD = srgb('#8a5a32')
RUBBER = srgb('#101114')
BRASS = srgb('#b58a3c')


def M():
    return dict(
        tan=image_mat('cerakote_tan', 'skins/field-metal-runtime.jpg', TAN, 0.25, 0.64), tan_d=image_mat('cerakote_tan_dark', 'skins/field-metal-runtime.jpg', TAN_D, 0.25, 0.68),
        poly=mat('polymer_black', POLY, 0.0, 0.62), poly_l=mat('polymer_grey', POLY_L, 0.0, 0.58),
        steel=mat('steel', STEEL, 1.0, 0.28), gunm=image_mat('gunmetal', 'skins/field-metal-runtime.jpg', GUNM, 0.85, 0.46), rubber=mat('rubber', RUBBER, 0.0, 0.9),
        olive=image_mat('cerakote_olive', 'skins/field-metal-runtime.jpg', OLIVE, 0.25, 0.65), olive_d=image_mat('cerakote_olive_dark', 'skins/field-metal-runtime.jpg', OLIVE_D, 0.25, 0.7),
        wood=mat('wood', WOOD, 0.0, 0.55), brass=mat('brass', BRASS, 1.0, 0.3),
        slot=mat('slot', (0.008, 0.008, 0.009), 0.0, 0.9), red=mat('red_dot', (1.0, 0.05, 0.03), 0.0, 0.3, emit=(1, 0.05, 0.03), emit_strength=6),
    )


# ------------------------------------------------------------------------------------------------ shared parts
def rail(B, m, x0, x1, z, w=0.021, h=0.006, pitch=0.010):
    """Picatinny rail: base plate with cross slots"""
    B.box(m, ((x0 + x1) / 2, 0, z), (x1 - x0, w, h), bevel=0.0007, seg=1)
    x = x0 + pitch * 0.5
    while x < x1 - pitch * 0.4:
        B.box(m, (x, 0, z + h / 2 + 0.0008), (pitch * 0.42, w * 0.96, 0.0026), bevel=0.0004, seg=1)
        x += pitch


def mlok(B, slot, x0, x1, y, z, n=4, length=0.026, height=0.0065):
    """a row of M-LOK slots on a handguard face at lateral offset y (either sign)"""
    step = (x1 - x0) / n
    sgn = 1 if y >= 0 else -1
    for i in range(n):
        B.box(slot, (x0 + step * (i + 0.5), y + sgn * 0.0004, z), (length, 0.0012, height), bevel=0.0018, seg=2)


def grip(B, m, m_ridge, top, length, depth, width, tilt, ridges=7):
    """slanted pistol grip hanging from `top` (x,y,z); tilt degrees about Y (positive leans the bottom rearwards).
    Swept with a bowed backstrap, a front finger swell and a flared base instead of a slab."""
    t = math.radians(tilt)
    dx, dz = -math.sin(t), -math.cos(t)
    pts, radii = [], []
    for f, sw in ((0.0, 0.94), (0.2, 1.0), (0.45, 1.06), (0.72, 1.02), (1.0, 1.0)):
        pts.append((top[0] + dx * length * f + math.sin(math.pi * f) * 0.0035, top[1], top[2] + dz * length * f))
        radii.append(width / 2 * sw)
    B.sweep(m, pts, radii, n=18, squash=(1.0, depth / width), p=3.0, round_ends=(False, False))
    for i in range(ridges):                                                           # finger-grooves / front strap texture
        f = (i + 0.9) / (ridges + 0.6)
        zz = top[2] + dz * length * f
        xx = top[0] + dx * length * f + math.sin(math.pi * f) * 0.0035
        B.box(m_ridge, (xx + math.cos(t) * depth * 0.52, top[1], zz), (0.0018, width * 0.72, length / (ridges * 2.4)), bevel=0.0006, rot=(0, tilt, 0), seg=1)
    bx = top[0] + dx * length
    bz = top[2] + dz * length
    B.box(m, (bx, top[1], bz - 0.002), (depth + 0.006, width + 0.006, 0.010), bevel=0.0035, rot=(0, tilt, 0))


def curved_mag(B, m, m2, top, length, depth, width, curve_deg, n=8, base=True):
    """magazine hanging from `top` (x,y,z of its top centre); curve_deg = total forward bend. One smooth swept body with
    side ribs, feed lips and a floorplate."""
    x, z = top[0], top[2]
    seg = length / n
    ang = 0.0
    pts = [(x, top[1], z)]
    for i in range(n):
        am = math.radians(ang + curve_deg / n / 2)
        ang += curve_deg / n
        x += math.sin(am) * seg
        z -= math.cos(am) * seg
        pts.append((x, top[1], z))
    B.sweep(m, pts, [width / 2] * len(pts), n=20, squash=(1.0, depth / width), p=3.6, round_ends=(False, False))
    for i in range(1, n):
        px, py, pz = pts[i]
        am = math.radians(curve_deg * (i - 0.5) / n)
        B.box(m2, (px + math.cos(am) * depth * 0.5, py, pz), (0.0022, width * 0.62, seg * 0.32), bevel=0.0007, rot=(0, math.degrees(am), 0), seg=1)    # front ribs
        B.box(m2, (px, py + width * 0.5 + 0.0003, pz), (depth * 0.6, 0.0012, seg * 0.5), bevel=0.0004, rot=(0, math.degrees(am), 0), seg=1)
        B.box(m2, (px, py - width * 0.5 - 0.0003, pz), (depth * 0.6, 0.0012, seg * 0.5), bevel=0.0004, rot=(0, math.degrees(am), 0), seg=1)
    B.box(m2, (top[0] + 0.0, top[1], top[2] + 0.002), (depth + 0.002, width + 0.002, 0.008), bevel=0.0015)                     # feed lips
    if base:
        B.box(m2, (x + 0.001, top[1], z - 0.004), (depth + 0.008, width + 0.006, 0.010), bevel=0.003, rot=(0, curve_deg, 0))
    return x, z


def muzzle_device(B, mm, x0, kind, r=0.0108):
    steel, slot = mm['steel'], mm['slot']
    if kind == 'hider':
        B.cyl(steel, (x0, 0, 0), (x0 + 0.055, 0, 0), r, verts=20, bevel=0.0012)
        for k in range(4):
            a = k * math.pi / 2 + math.pi / 4
            B.box(slot, (x0 + 0.033, r * math.cos(a), r * math.sin(a)), (0.028, 0.0026, 0.0026), bevel=0.0005, rot=(math.degrees(a), 0, 0), seg=1)
        B.cyl(slot, (x0 + 0.0545, 0, 0), (x0 + 0.0558, 0, 0), r * 0.55, verts=12)
    elif kind == 'brake':
        B.cyl(steel, (x0, 0, 0), (x0 + 0.07, 0, 0), r * 1.2, verts=24, bevel=0.0015)
        for k in range(3):
            B.box(slot, (x0 + 0.024 + k * 0.014, 0, 0), (0.005, r * 2.6, r * 2.6), bevel=0.001, seg=1) if False else None
            B.cyl(slot, (x0 + 0.02 + k * 0.014, -r * 1.25, 0), (x0 + 0.02 + k * 0.014, r * 1.25, 0), 0.0036, verts=10)
        B.cyl(slot, (x0 + 0.0695, 0, 0), (x0 + 0.0708, 0, 0), r * 0.6, verts=12)
    return x0 + (0.055 if kind == 'hider' else 0.07)


def sights(B, mm, x_rear, x_front, z_rail, front_h=0.034, aperture=True):
    # Separate foldable sights with an actual opening, aligned above the receiver.
    S = Builder('iron_sights')
    gunm, steel = mm['gunm'], mm['steel']
    aim_z = z_rail + 0.036
    S.box(gunm, (x_rear, 0, z_rail + 0.010), (0.016, 0.020, 0.018), bevel=0.0015)
    if aperture:
        for i in range(20):
            a, b = i * math.tau / 20, (i + 1) * math.tau / 20
            S.cyl(gunm, (x_rear, math.cos(a) * 0.0075, aim_z - 0.001 + math.sin(a) * 0.0075),
                  (x_rear, math.cos(b) * 0.0075, aim_z - 0.001 + math.sin(b) * 0.0075), 0.0011, verts=8)
        S.box(gunm, (x_rear, 0, aim_z - 0.014), (0.012, 0.010, 0.012), bevel=0.001)
    else:
        for side in [-1, 1]:
            S.box(gunm, (x_rear, side * 0.007, aim_z - 0.003), (0.009, 0.004, 0.010), bevel=0.0008)
    h = aim_z - z_rail - 0.0015
    S.box(gunm, (x_front, 0, z_rail + h / 2), (0.009, 0.003, h), bevel=0.0006)
    S.box(steel, (x_front, 0, aim_z - 0.002), (0.004, 0.0015, 0.002), bevel=0.0003)
    if not hasattr(B, 'children'):
        B.children = []
    B.children.append(S.finish())
    return aim_z


def add_empties(B, muzzle_x, ads, mount_optic, mount_under, grip_r, grip_l, eject=(0.03, -0.02, 0.02)):
    for name, loc in (('muzzle', (muzzle_x, 0, 0)), ('eject', eject), ('ads', ads), ('mount_optic', mount_optic), ('mount_muzzle', (muzzle_x, 0, 0)),
                      ('mount_under', mount_under), ('grip_r', grip_r), ('grip_l', grip_l)):
        B.empty(name, loc)


def mags(mm, root_name, body, specs, extra=()):
    """specs: dict tag -> callable(Builder) that draws the magazine; returns the group"""
    kids = [body] + list(extra)
    for tag, fn in specs.items():
        MB = Builder(tag)
        fn(MB)
        kids.append(MB.finish())
    return group(root_name, kids)


def drum(MB, mm, cx, cz, r=0.075, w=0.076, neck_top=None):
    MB.cyl(mm['poly'], (cx, -w / 2, cz), (cx, w / 2, cz), r, verts=40, bevel=0.005)
    MB.cyl(mm['poly_l'], (cx, -w / 2 - 0.0015, cz), (cx, w / 2 + 0.0015, cz), r * 0.42, verts=24)
    MB.cyl(mm['steel'], (cx, -w / 2 - 0.003, cz), (cx, w / 2 + 0.003, cz), 0.008, verts=12)
    for k in range(10):
        a = k * math.pi / 5
        MB.box(mm['poly_l'], (cx + math.cos(a) * r * 0.78, 0, cz + math.sin(a) * r * 0.78), (0.012, w + 0.004, 0.006), bevel=0.001, rot=(0, -math.degrees(a), 0), seg=1)
    if neck_top is not None:
        MB.box(mm['poly'], (cx, 0, (cz + r + neck_top) / 2), (0.036, 0.03, abs(neck_top - cz - r) + 0.01), bevel=0.003)


# ------------------------------------------------------------------------------------------------ rifle family: AR-7 / BR-12 / DMR-14
def build_rifle(name, mm, P):
    """One parametric carbine/rifle; P picks colours, lengths, magazine and furniture."""
    B = Builder(name + '_body')
    S = Builder(name + '_stock')
    rec, rec_d, furn, steel, gunm, slot, rubber = mm[P['rec']], mm[P['rec_d']], mm[P['furn']], mm['steel'], mm['gunm'], mm['slot'], mm['rubber']
    up_len, up_h, hg_len, hg_h = P['up_len'], P['up_h'], P['hg_len'], P['hg_h']
    up_x0 = -0.105
    up_x1 = up_x0 + up_len
    zc = 0.014
    # ---- receivers with a sloped rear and chamfered front
    B.loft(rec, [((up_x0, 0, zc + 0.004), 0.027, up_h - 0.010, 0.008), ((up_x0 + 0.03, 0, zc + 0.002), 0.031, up_h - 0.003, 0.010),
                 ((up_x0 + up_len * 0.55, 0, zc), 0.033, up_h, 0.011), ((up_x1 - 0.012, 0, zc), 0.033, up_h, 0.011),
                 ((up_x1 + 0.012, 0, zc - 0.002), 0.030, up_h - 0.008, 0.009)])            # sculpted upper receiver
    B.loft(rec_d, [((-0.10, 0, -0.030), 0.028, 0.044, 0.008), ((-0.05, 0, -0.029), 0.030, 0.050, 0.009),
                   ((0.04, 0, -0.030), 0.031, 0.052, 0.009), ((0.080, 0, -0.031), 0.029, 0.046, 0.008)])   # lower receiver
    B.loft(rec, [((0.022, 0, -0.076), 0.030, 0.056, 0.007), ((0.052, 0, -0.078), 0.034, 0.058, 0.007), ((0.082, 0, -0.078), 0.034, 0.058, 0.007)])   # flared magwell
    B.box(rec_d, (0.087, 0, -0.012), (0.012, 0.024, 0.030), bevel=0.004)                     # upper/lower blend
    B.box(slot, (0.03, -0.0166, 0.020), (0.052, 0.0012, 0.021), bevel=0.003)                 # ejection port
    B.box(rec_d, (0.004, -0.0183, 0.020), (0.010, 0.004, 0.024), bevel=0.0015)               # brass deflector
    B.box(rec, (0.03, -0.0176, 0.020), (0.052, 0.0012, 0.004), bevel=0.001, seg=1)
    B.cyl(gunm, (0.055, -0.0165, 0.006), (0.055, -0.0225, 0.006), 0.0055, verts=14, bevel=0.001)   # forward assist
    B.box(furn, (-0.103, 0, 0.038), (0.024, 0.02, 0.012), bevel=0.002)                       # charging handle
    B.box(furn, (-0.113, 0, 0.038), (0.008, 0.032, 0.014), bevel=0.002)
    rail_end = up_x1 + hg_len
    rail(B, rec, up_x0, rail_end, 0.0435, w=0.022)
    ads_z = sights(B, mm, -0.085, rail_end - 0.012, 0.0435, front_h=P.get('front_h', 0.034))
    # ---- trigger group
    B.sweep(furn, [(0.052, 0, -0.046), (0.054, 0, -0.063), (0.040, 0, -0.071), (0.0, 0, -0.072), (-0.032, 0, -0.066), (-0.05, 0, -0.053)], [0.0030] * 6,
            n=10, squash=(1.4, 1.0), round_ends=(False, False))                              # trigger guard
    B.box(gunm, (-0.006, 0, -0.052), (0.006, 0.006, 0.02), bevel=0.001, rot=(0, -18, 0), seg=1)
    B.cyl(steel, (-0.045, 0.0165, -0.022), (-0.045, 0.0235, -0.022), 0.0045, verts=12)
    B.box(steel, (-0.045, 0.0225, -0.018), (0.016, 0.003, 0.004), bevel=0.0008, seg=1)
    B.cyl(steel, (0.045, -0.0172, -0.062), (0.045, -0.0225, -0.062), 0.0045, verts=12)
    B.box(steel, (0.0, 0.0163, -0.04), (0.02, 0.0024, 0.006), bevel=0.001, seg=1)
    grip(B, furn, mm['poly_l'], (-0.062, 0, -0.05), 0.108, 0.034, 0.034, 16, 8)
    # ---- handguard
    hg_x0 = up_x1 - 0.01
    hg_cx = hg_x0 + hg_len / 2
    hz, hh = (0.0405 - hg_h / 2) / 2, 0.0405 + hg_h / 2                           # top of the handguard runs flush with the rail
    B.loft(furn, [((hg_x0, 0, hz), hg_h + 0.008, hh + 0.004, 0.011), ((hg_x0 + 0.03, 0, hz), hg_h + 0.002, hh, 0.010),
                  ((hg_cx, 0, hz), hg_h + 0.002, hh, 0.010), ((hg_x0 + hg_len - 0.014, 0, hz), hg_h - 0.002, hh - 0.003, 0.010)])
    B.loft(furn, [((hg_x0 - 0.002, 0, hz), hg_h + 0.010, hh + 0.006, 0.012), ((hg_x0 + 0.020, 0, hz), hg_h + 0.010, hh + 0.006, 0.012)])   # receiver collar
    B.loft(gunm, [((hg_x0 + hg_len - 0.012, 0, hz), hg_h + 0.003, hh + 0.001, 0.010), ((hg_x0 + hg_len + 0.002, 0, hz), hg_h + 0.003, hh + 0.001, 0.010)])  # end cap
    n = max(3, int(hg_len / 0.05))
    for zz in (hz + 0.015, hz - 0.012):
        mlok(B, slot, hg_x0 + 0.03, hg_x0 + hg_len - 0.02, hg_h / 2 + 0.001, zz, n)
        mlok(B, slot, hg_x0 + 0.03, hg_x0 + hg_len - 0.02, -(hg_h / 2 + 0.001), zz, n)
    for i in range(n):
        B.box(slot, (hg_x0 + 0.03 + (hg_len - 0.05) / n * (i + 0.5), 0, -hg_h / 2 - 0.0004), (0.026, 0.0065, 0.0012), bevel=0.0018, seg=2)
    # ---- barrel
    bx0 = hg_x0 + hg_len
    b_len = P['barrel']
    B.cyl(gunm, (bx0 - 0.02, 0, 0), (bx0 + b_len, 0, 0), P.get('barrel_r', 0.0078), verts=20)
    if P.get('fluted'):
        for k in range(6):
            a = k * math.pi / 3
            B.box(slot, (bx0 + 0.02 + b_len * 0.4, 0.0078 * math.cos(a), 0.0078 * math.sin(a)), (b_len * 0.6, 0.0016, 0.0016), bevel=0.0004, rot=(math.degrees(a), 0, 0), seg=1)
    B.cyl(gunm, (bx0 - 0.028, 0, 0), (bx0 + 0.004, 0, 0), 0.0122, verts=20, bevel=0.0015)        # gas block
    B.cyl(steel, (bx0 + 0.006, 0, 0), (bx0 + 0.012, 0, 0), 0.0098, verts=20)                      # barrel nut / crush washer
    mx = muzzle_device(B, mm, bx0 + b_len, P['muzzle'], r=P.get('muzzle_r', 0.0108))
    # ---- stock
    st = P['stock']
    if st == 'coll':
        S.cyl(furn, (-0.112, 0, 0.004), (-0.262, 0, 0.004), 0.0155, verts=20)
        S.loft(furn, [((-0.165, 0, 0.002), 0.030, 0.050, 0.010), ((-0.22, 0, 0.0), 0.037, 0.064, 0.012), ((-0.28, 0, -0.004), 0.040, 0.078, 0.013),
                      ((-0.328, 0, -0.011), 0.040, 0.092, 0.012)])                            # collapsible stock body
        S.loft(furn, [((-0.19, 0, 0.032), 0.026, 0.010, 0.004), ((-0.30, 0, 0.040), 0.028, 0.012, 0.005)])                              # cheek riser
        S.box(furn, (-0.337, 0, -0.011), (0.020, 0.042, 0.098), bevel=0.007, rot=(0, -6, 0))
        S.box(rubber, (-0.349, 0, -0.011), (0.008, 0.040, 0.094), bevel=0.003, rot=(0, -6, 0), seg=1)
        S.box(steel, (-0.19, 0, -0.03), (0.02, 0.006, 0.012), bevel=0.002)                   # adjustment latch
        for k in range(4):
            S.box(mm['poly_l'], (-0.215 - k * 0.022, 0, -0.038 - k * 0.0015), (0.010, 0.030, 0.003), bevel=0.001, seg=1)             # adjustment ribs
        stock_end = -0.354
    else:   # fixed / sniper style: one-piece stock with a raised cheek and a hooked butt
        L = P.get('stock_len', 0.27)
        xe = -0.105 - L
        S.loft(furn, [((-0.115, 0, -0.004), 0.030, 0.058, 0.010), ((-0.16, 0, -0.010), 0.033, 0.064, 0.012), ((-0.205, 0, -0.012), 0.038, 0.072, 0.013),
                      ((xe * 0.72 + -0.105 * 0.28, 0, -0.016), 0.040, 0.084, 0.014), ((xe + 0.012, 0, -0.026), 0.042, 0.106, 0.015)])
        S.loft(furn, [((-0.15, 0, 0.030), 0.028, 0.012, 0.005), ((xe * 0.7, 0, 0.040), 0.032, 0.016, 0.006), ((xe + 0.03, 0, 0.040), 0.030, 0.012, 0.005)])      # cheek piece
        S.box(rubber, (xe - 0.004, 0, -0.028), (0.008, 0.043, 0.106), bevel=0.003, rot=(0, -10, 0), seg=1)
        stock_end = xe - 0.008
    B.cyl(steel, (-0.06, 0.0, -0.058), (-0.06, 0.0, -0.062), 0.006, verts=12)
    add_empties(B, mx, (-0.085, 0, ads_z), (0.02, 0, 0.0465), (hg_x0 + hg_len * 0.75, 0, -hg_h / 2 - 0.002), (-0.086, 0, -0.095), (hg_x0 + hg_len * 0.62, 0, -hg_h / 2))
    body = B.finish()
    stock = S.finish()
    mag_d, mag_w = P['mag_d'], P['mag_w']
    ext = P['mag_len'] * 1.32

    def m_std(MB):
        curved_mag(MB, mm['poly'], mm['poly_l'], (0.052, 0, -0.1), P['mag_len'], mag_d, mag_w, P['curve'], 8)

    def m_ext(MB):
        curved_mag(MB, mm['poly'], mm['poly_l'], (0.052, 0, -0.1), ext, mag_d, mag_w, P['curve'] * 1.25, 10)

    def m_drum(MB):
        curved_mag(MB, mm['poly'], mm['poly_l'], (0.052, 0, -0.1), 0.03, mag_d, mag_w, 0, 2, False)
        drum(MB, mm, 0.06, -0.19, neck_top=-0.1)
    return mags(mm, name, body, {'mag_std': m_std, 'mag_ext': m_ext, 'mag_drum': m_drum}, [stock])


AR7 = dict(rec='tan', rec_d='tan_d', furn='poly', up_len=0.235, up_h=0.052, hg_len=0.30, hg_h=0.05, barrel=0.10, muzzle='hider', stock='coll',
           mag_len=0.115, mag_d=0.042, mag_w=0.027, curve=11)
BR12 = dict(rec='olive', rec_d='olive_d', furn='poly', up_len=0.26, up_h=0.058, hg_len=0.29, hg_h=0.056, barrel=0.13, muzzle='brake', stock='fixed', stock_len=0.27,
            mag_len=0.105, mag_d=0.048, mag_w=0.03, curve=4, barrel_r=0.0088, muzzle_r=0.0125, front_h=0.038)
DMR14 = dict(rec='tan', rec_d='tan_d', furn='poly', up_len=0.25, up_h=0.052, hg_len=0.34, hg_h=0.048, barrel=0.22, muzzle='brake', stock='fixed', stock_len=0.29,
             mag_len=0.1, mag_d=0.044, mag_w=0.028, curve=5, fluted=True, barrel_r=0.0095, muzzle_r=0.0125)


def build_ar7(mm):
    return build_rifle('ar7', mm, AR7)


def build_br12(mm):
    return build_rifle('br12', mm, BR12)


def build_dmr14(mm):
    return build_rifle('dmr14', mm, DMR14)


# ------------------------------------------------------------------------------------------------ VX-9 submachine gun
def build_vx9(mm):
    B = Builder('vx9_body')
    S = Builder('vx9_stock')
    poly, poly_l, tan, tan_d, steel, gunm, slot, rubber = mm['poly'], mm['poly_l'], mm['tan'], mm['tan_d'], mm['steel'], mm['gunm'], mm['slot'], mm['rubber']
    B.loft(poly, [((-0.108, 0, 0.006), 0.030, 0.052, 0.009), ((-0.06, 0, 0.005), 0.034, 0.060, 0.011), ((0.0, 0, 0.004), 0.036, 0.062, 0.011), ((0.108, 0, 0.003), 0.034, 0.058, 0.010)])    # receiver
    B.loft(poly_l, [((-0.095, 0, -0.030), 0.029, 0.028, 0.008), ((-0.02, 0, -0.03), 0.034, 0.032, 0.009), ((0.055, 0, -0.031), 0.031, 0.030, 0.008)])
    B.box(slot, (0.015, -0.0186, 0.012), (0.05, 0.0012, 0.02), bevel=0.003)
    rail(B, poly_l, -0.105, 0.21, 0.0385, w=0.02)
    ads_z = sights(B, mm, -0.09, 0.19, 0.0385, front_h=0.026)
    # tan handguard shroud with vents
    B.loft(tan, [((0.098, 0, 0.0), 0.046, 0.054, 0.011), ((0.155, 0, 0.0), 0.049, 0.058, 0.012), ((0.212, 0, 0.0), 0.046, 0.054, 0.011)])
    for i in range(5):
        for s in (1, -1):
            B.cyl(slot, (0.115 + i * 0.02, s * 0.0242, 0.006), (0.115 + i * 0.02, s * 0.0234, 0.006), 0.0052, verts=12)
    B.box(gunm, (0.215, 0, 0.0), (0.014, 0.05, 0.058), bevel=0.003)
    B.cyl(gunm, (0.21, 0, 0), (0.29, 0, 0), 0.012, verts=20)                            # integral suppressor
    B.cyl(steel, (0.29, 0, 0), (0.298, 0, 0), 0.0125, verts=20)
    B.cyl(slot, (0.2975, 0, 0), (0.2988, 0, 0), 0.006, verts=12)
    for i in range(6):
        B.cyl(gunm, (0.225 + i * 0.011, 0, 0), (0.228 + i * 0.011, 0, 0), 0.0138, verts=20)
    # trigger group and grip
    B.box(poly, (0.0, 0, -0.056), (0.09, 0.0035, 0.004), bevel=0.001, seg=1)
    B.box(poly, (0.043, 0, -0.045), (0.005, 0.0035, 0.022), bevel=0.001, seg=1)
    B.box(gunm, (-0.005, 0, -0.043), (0.006, 0.006, 0.018), bevel=0.001, rot=(0, -18, 0), seg=1)
    grip(B, tan, tan_d, (-0.06, 0, -0.04), 0.1, 0.034, 0.034, 14, 7)
    B.cyl(steel, (-0.04, 0.018, -0.02), (-0.04, 0.024, -0.02), 0.004, verts=12)
    B.loft(tan, [((0.02, 0, -0.07), 0.034, 0.048, 0.007), ((0.045, 0, -0.07), 0.037, 0.052, 0.007), ((0.07, 0, -0.07), 0.034, 0.048, 0.007)])                     # magwell
    # folding skeleton stock
    for s in (1, -1):
        S.sweep(tan, [(-0.105, s * 0.016, 0.005), (-0.2, s * 0.016, 0.005), (-0.29, s * 0.016, -0.002)], [0.0042] * 3, n=10, squash=(0.8, 1.2), p=3.5, round_ends=(False, False))
        S.sweep(tan, [(-0.125, s * 0.016, -0.048), (-0.2, s * 0.016, -0.05), (-0.295, s * 0.016, -0.046)], [0.0042] * 3, n=10, squash=(0.8, 1.2), p=3.5, round_ends=(False, False))
        S.sweep(tan, [(-0.293, s * 0.016, 0.0), (-0.297, s * 0.016, -0.045)], [0.0045] * 2, n=10, squash=(0.8, 1.3), p=3.5, round_ends=(False, False))
    S.box(rubber, (-0.303, 0, -0.022), (0.012, 0.04, 0.082), bevel=0.004, rot=(0, -5, 0))
    S.box(gunm, (-0.11, 0, 0.005), (0.02, 0.036, 0.024), bevel=0.003)
    B.cyl(steel, (-0.06, 0.0, -0.057), (-0.06, 0.0, -0.061), 0.006, verts=12)
    add_empties(B, 0.298, (-0.09, 0, ads_z), (0.03, 0, 0.041), (0.16, 0, -0.03), (-0.064, 0, -0.085), (0.14, 0, -0.03))
    body = B.finish()
    stock = S.finish()

    def m_std(MB):
        curved_mag(MB, poly, poly_l, (0.045, 0, -0.095), 0.14, 0.036, 0.027, 0, 6)

    def m_ext(MB):
        curved_mag(MB, poly, poly_l, (0.045, 0, -0.095), 0.19, 0.036, 0.027, 0, 8)

    def m_drum(MB):
        curved_mag(MB, poly, poly_l, (0.045, 0, -0.095), 0.03, 0.036, 0.027, 0, 2, False)
        drum(MB, mm, 0.05, -0.185, r=0.068, w=0.07, neck_top=-0.095)
    return mags(mm, 'vx9', body, {'mag_std': m_std, 'mag_ext': m_ext, 'mag_drum': m_drum}, [stock])


# ------------------------------------------------------------------------------------------------ SG-4 pump shotgun
def build_sg4(mm):
    B = Builder('sg4_body')
    S = Builder('sg4_stock')
    poly, poly_l, tan, tan_d, steel, gunm, slot, rubber = mm['poly'], mm['poly_l'], mm['tan'], mm['tan_d'], mm['steel'], mm['gunm'], mm['slot'], mm['rubber']
    B.loft(gunm, [((-0.11, 0, 0.008), 0.030, 0.050, 0.009), ((-0.06, 0, 0.007), 0.034, 0.057, 0.011), ((0.03, 0, 0.006), 0.036, 0.058, 0.011), ((0.11, 0, 0.004), 0.033, 0.052, 0.010)])   # receiver
    B.loft(poly_l, [((-0.10, 0, -0.030), 0.029, 0.028, 0.008), ((-0.02, 0, -0.03), 0.034, 0.032, 0.009), ((0.06, 0, -0.031), 0.031, 0.030, 0.008)])
    B.box(slot, (0.03, -0.0186, 0.014), (0.05, 0.0012, 0.02), bevel=0.003)               # ejection port
    B.box(slot, (0.05, 0.0, -0.018), (0.045, 0.026, 0.001), bevel=0.001, seg=1)          # loading port
    rail(B, gunm, -0.09, 0.14, 0.0385, w=0.02)
    B.box(steel, (-0.02, 0.0186, 0.018), (0.022, 0.004, 0.02), bevel=0.001, seg=1)       # safety
    ads_z = sights(B, mm, -0.05, 0.64, 0.0385)
    # barrel + magazine tube + heat shield
    B.cyl(gunm, (0.11, 0, 0.012), (0.66, 0, 0.012), 0.0095, verts=20)
    B.cyl(gunm, (0.11, 0, -0.02), (0.6, 0, -0.02), 0.0115, verts=20)
    B.cyl(steel, (0.6, 0, -0.02), (0.612, 0, -0.02), 0.0122, verts=20)
    B.box(poly_l, (0.36, 0, 0.026), (0.22, 0.016, 0.006), bevel=0.0015)
    for i in range(8):
        B.box(slot, (0.27 + i * 0.026, 0, 0.0292), (0.014, 0.012, 0.001), bevel=0.0004, seg=1)
    B.box(steel, (0.655, 0, 0.026), (0.008, 0.005, 0.02), bevel=0.0015)                  # bead sight
    B.cyl(steel, (0.66, 0, 0.012), (0.668, 0, 0.012), 0.0102, verts=20)
    # pump forend
    B.loft(tan, [((0.195, 0, -0.02), 0.042, 0.042, 0.012), ((0.23, 0, -0.02), 0.050, 0.050, 0.014), ((0.31, 0, -0.02), 0.050, 0.050, 0.014), ((0.345, 0, -0.02), 0.043, 0.043, 0.012)])
    for i in range(7):
        B.box(tan_d, (0.21 + i * 0.02, 0, -0.0462), (0.006, 0.048, 0.003), bevel=0.001, seg=1)
    B.box(gunm, (0.36, 0, -0.02), (0.012, 0.042, 0.042), bevel=0.003)
    # trigger, grip and stock
    B.box(poly, (0.0, 0, -0.06), (0.09, 0.0035, 0.004), bevel=0.001, seg=1)
    B.box(poly, (0.043, 0, -0.048), (0.005, 0.0035, 0.024), bevel=0.001, seg=1)
    B.box(gunm, (-0.005, 0, -0.046), (0.006, 0.006, 0.018), bevel=0.001, rot=(0, -18, 0), seg=1)
    grip(B, tan, tan_d, (-0.07, 0, -0.045), 0.1, 0.034, 0.034, 15, 7)
    S.loft(tan, [((-0.085, 0, -0.004), 0.030, 0.058, 0.010), ((-0.15, 0, -0.012), 0.036, 0.066, 0.012), ((-0.23, 0, -0.018), 0.040, 0.076, 0.013), ((-0.308, 0, -0.026), 0.042, 0.100, 0.013)])
    S.loft(tan, [((-0.12, 0, 0.030), 0.026, 0.010, 0.004), ((-0.21, 0, 0.036), 0.030, 0.016, 0.006), ((-0.29, 0, 0.030), 0.028, 0.012, 0.005)])
    S.box(tan_d, (-0.32, 0, -0.026), (0.03, 0.042, 0.11), bevel=0.008, rot=(0, -10, 0))
    S.box(rubber, (-0.335, 0, -0.026), (0.008, 0.043, 0.108), bevel=0.003, rot=(0, -10, 0), seg=1)
    B.cyl(steel, (-0.06, 0.0, -0.062), (-0.06, 0.0, -0.066), 0.006, verts=12)
    for i in range(3):                                                                    # shell holder on the stock
        B.cyl(brass, (-0.16 + i * 0.024, -0.0208, 0.0), (-0.16 + i * 0.024, -0.0208, 0.0), 0.0) if False else None
    add_empties(B, 0.668, (-0.05, 0, ads_z), (0.02, 0, 0.0415), (0.27, 0, -0.048), (-0.075, 0, -0.09), (0.27, 0, -0.046))
    return group('sg4', [B.finish(), S.finish()])


# ------------------------------------------------------------------------------------------------ MG-60 light machine gun
def build_mg60(mm):
    B = Builder('mg60_body')
    S = Builder('mg60_stock')
    olive, olive_d, poly, poly_l, steel, gunm, slot, rubber = mm['olive'], mm['olive_d'], mm['poly'], mm['poly_l'], mm['steel'], mm['gunm'], mm['slot'], mm['rubber']
    B.loft(olive, [((-0.12, 0, 0.012), 0.050, 0.062, 0.012), ((-0.05, 0, 0.012), 0.058, 0.070, 0.014), ((0.06, 0, 0.012), 0.060, 0.070, 0.014), ((0.16, 0, 0.010), 0.056, 0.066, 0.013)])   # receiver
    B.loft(olive_d, [((-0.11, 0, -0.036), 0.046, 0.036, 0.010), ((0.0, 0, -0.036), 0.056, 0.042, 0.011), ((0.12, 0, -0.036), 0.052, 0.038, 0.010)])
    B.loft(olive, [((-0.08, 0, 0.054), 0.044, 0.018, 0.007), ((0.02, 0, 0.058), 0.050, 0.024, 0.009), ((0.12, 0, 0.054), 0.044, 0.018, 0.007)])                      # feed tray cover
    B.box(slot, (0.05, -0.0304, 0.02), (0.06, 0.0012, 0.024), bevel=0.003)
    B.cyl(steel, (0.0, 0.0, 0.068), (0.0, 0.0, 0.074), 0.012, verts=16)
    rail(B, olive, -0.11, 0.16, 0.0685, w=0.022, h=0.006) if False else None
    B.box(poly, (0.0, 0, 0.079), (0.14, 0.014, 0.02), bevel=0.004)                       # carry handle
    for xx in (-0.06, 0.06):
        B.box(poly, (xx, 0, 0.069), (0.014, 0.014, 0.014), bevel=0.003)
    rail(B, olive_d, -0.12, 0.17, 0.0665, w=0.022) if False else None
    sights_z = sights(B, mm, -0.1, 0.575, 0.0705)
    # heat shroud with perforations, barrel
    B.cyl(olive_d, (0.16, 0, 0.004), (0.46, 0, 0.004), 0.034, verts=28, bevel=0.002)
    for i in range(8):
        for k in range(6):
            a = k * math.pi / 3 + (i % 2) * math.pi / 6
            B.cyl(slot, (0.19 + i * 0.033, 0.034 * math.cos(a) * 0.98, 0.004 + 0.034 * math.sin(a) * 0.98), (0.19 + i * 0.033, 0.034 * math.cos(a) * 1.01, 0.004 + 0.034 * math.sin(a) * 1.01), 0.0052, verts=8)
    B.cyl(gunm, (0.46, 0, 0.004), (0.62, 0, 0.004), 0.0125, verts=20)
    B.box(gunm, (0.605, 0, 0.004), (0.008, 0.008, 0.06), bevel=0.001, seg=1) if False else None
    # front sight is part of the foldable iron_sights node                     # front sight
    muzzle_device(B, mm, 0.62, 'hider', r=0.014)
    # bipod folded under the shroud
    for s in (1, -1):
        B.cyl(steel, (0.42, s * 0.026, -0.038), (0.30, s * 0.026, -0.052), 0.0048, verts=10)
        B.cyl(steel, (0.42, s * 0.026, -0.03), (0.42, s * 0.026, -0.04), 0.008, verts=12)
    B.box(poly_l, (0.43, 0, -0.03), (0.03, 0.06, 0.02), bevel=0.004)
    # trigger group + grip + stock
    B.box(poly, (0.0, 0, -0.068), (0.11, 0.0035, 0.004), bevel=0.001, seg=1)
    B.box(poly, (0.05, 0, -0.056), (0.005, 0.0035, 0.024), bevel=0.001, seg=1)
    B.box(gunm, (-0.005, 0, -0.056), (0.006, 0.006, 0.02), bevel=0.001, rot=(0, -18, 0), seg=1)
    grip(B, poly, poly_l, (-0.075, 0, -0.06), 0.105, 0.036, 0.036, 15, 7)
    S.loft(poly, [((-0.11, 0, 0.004), 0.040, 0.070, 0.012), ((-0.2, 0, 0.0), 0.046, 0.082, 0.014), ((-0.3, 0, -0.006), 0.048, 0.094, 0.014), ((-0.338, 0, -0.010), 0.048, 0.104, 0.013)])
    S.loft(poly, [((-0.14, 0, 0.040), 0.030, 0.014, 0.005), ((-0.23, 0, 0.046), 0.034, 0.018, 0.007), ((-0.31, 0, 0.040), 0.030, 0.012, 0.005)])
    S.box(rubber, (-0.352, 0, -0.012), (0.03, 0.05, 0.12), bevel=0.006, rot=(0, -8, 0))
    B.box(steel, (0.1, 0.031, 0.03), (0.03, 0.004, 0.012), bevel=0.001, seg=1)          # charging handle
    add_empties(B, 0.634, (-0.1, 0, sights_z), (0.0, 0, 0.0725), (0.36, 0, -0.03), (-0.078, 0, -0.105), (0.34, 0, -0.03), eject=(0.05, -0.032, 0.02))
    body = B.finish()
    stock = S.finish()

    def m_std(MB):                                                                       # belt box
        MB.box(olive_d, (0.02, 0, -0.105), (0.13, 0.078, 0.11), bevel=0.006)
        MB.box(olive, (0.02, 0, -0.049), (0.14, 0.086, 0.014), bevel=0.003)
        for i in range(4):
            MB.box(olive, (0.02, 0, -0.14 + i * 0.001), (0.13, 0.08, 0.001), bevel=0.0004, seg=1) if False else None
        MB.box(steel, (0.02, -0.0405, -0.09), (0.03, 0.002, 0.02), bevel=0.0008, seg=1)
        MB.box(mm['brass'], (0.085, 0, -0.07), (0.01, 0.06, 0.03), bevel=0.001, seg=1)

    def m_ext(MB):
        MB.box(olive_d, (0.02, 0, -0.125), (0.13, 0.078, 0.15), bevel=0.006)
        MB.box(olive, (0.02, 0, -0.049), (0.14, 0.086, 0.014), bevel=0.003)
        MB.box(steel, (0.02, -0.0405, -0.11), (0.03, 0.002, 0.02), bevel=0.0008, seg=1)

    def m_drum(MB):
        MB.box(olive_d, (0.02, 0, -0.06), (0.06, 0.05, 0.04), bevel=0.004)
        drum(MB, mm, 0.02, -0.17, r=0.095, w=0.09, neck_top=-0.055)
    return mags(mm, 'mg60', body, {'mag_std': m_std, 'mag_ext': m_ext, 'mag_drum': m_drum}, [stock])


# ------------------------------------------------------------------------------------------------ SR-50 bolt-action sniper rifle
def build_sr50(mm):
    B = Builder('sr50_body')
    S = Builder('sr50_stock')
    olive, olive_d, poly, poly_l, steel, gunm, slot, rubber = mm['olive'], mm['olive_d'], mm['poly'], mm['poly_l'], mm['steel'], mm['gunm'], mm['slot'], mm['rubber']
    B.loft(olive, [((-0.15, 0, 0.012), 0.030, 0.044, 0.008), ((-0.05, 0, 0.012), 0.034, 0.050, 0.010), ((0.1, 0, 0.012), 0.034, 0.050, 0.010), ((0.152, 0, 0.010), 0.030, 0.046, 0.008)])   # long action
    B.loft(olive_d, [((-0.135, 0, -0.026), 0.030, 0.046, 0.008), ((-0.04, 0, -0.026), 0.034, 0.052, 0.010), ((0.11, 0, -0.026), 0.033, 0.050, 0.010)])
    rail(B, olive, -0.13, 0.20, 0.0415, w=0.022)
    B.box(slot, (0.02, -0.0176, 0.016), (0.06, 0.0012, 0.014), bevel=0.003)
    # bolt handle on the right side with a knob
    B.cyl(steel, (-0.05, -0.016, 0.014), (-0.05, -0.048, 0.006), 0.0045, verts=12)
    B.sphere(steel, (-0.05, -0.052, 0.004), 0.011, 14)
    B.box(steel, (-0.05, 0, 0.016), (0.06, 0.02, 0.014), bevel=0.003)
    # chassis fore-end + free-floated heavy barrel
    B.loft(poly, [((0.15, 0, -0.008), 0.040, 0.046, 0.012), ((0.22, 0, -0.010), 0.050, 0.050, 0.013), ((0.37, 0, -0.010), 0.050, 0.050, 0.013)])
    mlok(B, slot, 0.17, 0.35, 0.0255, -0.008, 4, 0.024, 0.006)
    mlok(B, slot, 0.17, 0.35, -0.0255, -0.008, 4, 0.024, 0.006)
    B.cyl(gunm, (0.14, 0, 0.0), (0.86, 0, 0.0), 0.0115, verts=24)
    for k in range(6):
        a = k * math.pi / 3
        B.box(slot, (0.5, 0.0115 * math.cos(a), 0.0115 * math.sin(a)), (0.34, 0.0018, 0.0018), bevel=0.0004, rot=(math.degrees(a), 0, 0), seg=1)
    muzzle_device(B, mm, 0.86, 'brake', r=0.0125)
    # bipod
    for s in (1, -1):
        B.cyl(steel, (0.34, s * 0.02, -0.03), (0.28, s * 0.03, -0.06), 0.0045, verts=10)
    B.box(poly_l, (0.345, 0, -0.03), (0.024, 0.05, 0.016), bevel=0.003)
    # sniper stock: thumbhole style with adjustable cheek
    S.loft(poly, [((-0.10, 0, -0.002), 0.034, 0.070, 0.011), ((-0.18, 0, -0.010), 0.040, 0.078, 0.012), ((-0.3, 0, -0.016), 0.042, 0.090, 0.013), ((-0.385, 0, -0.024), 0.042, 0.108, 0.013)])
    S.loft(poly_l, [((-0.13, 0, 0.030), 0.030, 0.020, 0.008), ((-0.22, 0, 0.038), 0.034, 0.028, 0.010), ((-0.29, 0, 0.034), 0.030, 0.020, 0.008)])
    S.box(steel, (-0.21, 0, 0.018), (0.03, 0.006, 0.014), bevel=0.002)
    S.box(rubber, (-0.4, 0, -0.03), (0.03, 0.044, 0.13), bevel=0.006, rot=(0, -10, 0))
    grip(B, poly, poly_l, (-0.08, 0, -0.04), 0.1, 0.034, 0.034, 20, 6)
    B.box(poly, (0.0, 0, -0.056), (0.09, 0.0035, 0.004), bevel=0.001, seg=1)
    B.box(poly, (0.043, 0, -0.048), (0.005, 0.0035, 0.024), bevel=0.001, seg=1)
    B.box(gunm, (-0.005, 0, -0.046), (0.006, 0.006, 0.018), bevel=0.001, rot=(0, -18, 0), seg=1)
    B.box(gunm, (0.06, 0, -0.064), (0.06, 0.036, 0.04), bevel=0.004)                     # magwell
    # backup iron sights (folding)
    B.box(gunm, (-0.11, 0, 0.055), (0.014, 0.014, 0.02), bevel=0.002)
    add_empties(B, 0.93, (-0.11, 0, 0.066), (0.03, 0, 0.0445), (0.3, 0, -0.035), (-0.086, 0, -0.078), (0.28, 0, -0.03), eject=(0.02, -0.02, 0.016))
    body = B.finish()
    stock = S.finish()

    def m_std(MB):
        curved_mag(MB, poly, poly_l, (0.06, 0, -0.082), 0.07, 0.034, 0.028, 0, 5)

    def m_ext(MB):
        curved_mag(MB, poly, poly_l, (0.06, 0, -0.082), 0.105, 0.034, 0.028, 0, 7)
    return mags(mm, 'sr50', body, {'mag_std': m_std, 'mag_ext': m_ext}, [stock])


# ------------------------------------------------------------------------------------------------ P-18 pistol
def build_p18(mm):
    B = Builder('p18_body')
    poly, poly_l, tan, tan_d, steel, gunm, slot = mm['poly'], mm['poly_l'], mm['tan'], mm['tan_d'], mm['steel'], mm['gunm'], mm['slot']
    B.loft(gunm, [((-0.043, 0, 0.026), 0.024, 0.032, 0.006), ((0.0, 0, 0.026), 0.026, 0.034, 0.007), ((0.12, 0, 0.026), 0.026, 0.034, 0.007), ((0.153, 0, 0.025), 0.021, 0.030, 0.007)])                   # slide
    for i in range(7):                                                                    # rear serrations
        for s in (1, -1):
            B.box(slot, (-0.0235 + i * 0.0072, s * 0.0132, 0.026), (0.0034, 0.001, 0.028), bevel=0.0004, seg=1)
    B.box(slot, (0.075, -0.0132, 0.032), (0.05, 0.001, 0.008), bevel=0.002, seg=1)       # ejection port
    B.loft(poly, [((-0.04, 0, -0.002), 0.024, 0.024, 0.006), ((0.045, 0, -0.002), 0.026, 0.026, 0.007), ((0.130, 0, -0.004), 0.026, 0.024, 0.007)])                   # frame
    B.box(poly, (0.13, 0, -0.008), (0.05, 0.026, 0.02), bevel=0.003)                     # dust cover / accessory rail
    for i in range(3):
        B.box(slot, (0.12 + i * 0.014, 0, -0.019), (0.006, 0.024, 0.0014), bevel=0.0004, seg=1)
    # trigger guard and trigger
    B.box(poly, (0.075, 0, -0.026), (0.07, 0.022, 0.004), bevel=0.001, seg=1)
    B.box(poly, (0.108, 0, -0.016), (0.005, 0.022, 0.022), bevel=0.001, seg=1)
    B.box(gunm, (0.062, 0, -0.014), (0.006, 0.006, 0.02), bevel=0.001, rot=(0, -12, 0), seg=1)
    # grip with tan panels
    grip(B, poly, tan_d, (0.0, 0, -0.008), 0.105, 0.05, 0.028, 12, 6)
    B.box(tan, (-0.0195, 0.0155, -0.062), (0.03, 0.002, 0.07), bevel=0.001, rot=(0, 12, 0), seg=1)
    B.box(tan, (-0.0195, -0.0155, -0.062), (0.03, 0.002, 0.07), bevel=0.001, rot=(0, 12, 0), seg=1)
    sight_z = sights(B, mm, -0.036, 0.145, 0.024, aperture=False)
    B.cyl(gunm, (0.145, 0, 0.026), (0.175, 0, 0.026), 0.0072, verts=16)                  # barrel tip
    B.cyl(slot, (0.1749, 0, 0.026), (0.1752, 0, 0.026), 0.0035, verts=10)
    add_empties(B, 0.175, (-0.036, 0, sight_z), (0.04, 0, 0.0435), (0.14, 0, -0.02), (-0.02, 0, -0.06), (0.06, 0, -0.05), eject=(0.075, -0.014, 0.032))
    body = B.finish()

    def m_std(MB):
        MB.box(poly_l, (-0.03, 0, -0.118), (0.045, 0.026, 0.006), bevel=0.002)

    def m_ext(MB):
        MB.box(poly_l, (-0.03, 0, -0.118), (0.05, 0.028, 0.006), bevel=0.002)
        MB.box(poly, (-0.03, 0, -0.14), (0.04, 0.026, 0.04), bevel=0.003, rot=(0, 12, 0))
        MB.box(poly_l, (-0.036, 0, -0.16), (0.048, 0.028, 0.008), bevel=0.002, rot=(0, 12, 0))
    return mags(mm, 'p18', body, {'mag_std': m_std, 'mag_ext': m_ext})


# ------------------------------------------------------------------------------------------------ RL-80 rocket launcher
def build_rpg(mm):
    B = Builder('rpg_body')
    olive, olive_d, poly, poly_l, steel, gunm, slot, rubber = mm['olive'], mm['olive_d'], mm['poly'], mm['poly_l'], mm['steel'], mm['gunm'], mm['slot'], mm['rubber']
    B.cyl(olive, (-0.35, 0, 0.0), (0.72, 0, 0.0), 0.045, verts=32)                       # launch tube
    B.cyl(olive_d, (0.72, 0, 0.0), (0.80, 0, 0.0), 0.05, r2=0.062, verts=32)            # front flare
    B.cyl(slot, (0.80, 0, 0.0), (0.8012, 0, 0.0), 0.05, verts=28)
    B.cyl(olive_d, (-0.35, 0, 0.0), (-0.42, 0, 0.0), 0.045, r2=0.068, verts=32)         # rear venturi
    B.cyl(slot, (-0.4212, 0, 0.0), (-0.4205, 0, 0.0), 0.058, verts=28)
    for x in (-0.2, 0.05, 0.3, 0.55):
        B.cyl(steel, (x, 0, 0.0), (x + 0.012, 0, 0.0), 0.0475, verts=32)                # bands
    B.box(poly, (0.0, 0, 0.056), (0.16, 0.036, 0.024), bevel=0.005)                     # sight base
    B.box(gunm, (-0.02, 0, 0.078), (0.02, 0.02, 0.026), bevel=0.003)
    B.cyl(steel, (-0.03, 0, 0.09), (-0.01, 0, 0.09), 0.006, verts=12)
    B.cyl(slot, (-0.031, 0, 0.09), (-0.009, 0, 0.09), 0.0032, verts=10)
    B.box(gunm, (0.62, 0, 0.056), (0.014, 0.01, 0.032), bevel=0.002)
    B.box(steel, (-0.14, 0, -0.06), (0.06, 0.05, 0.03), bevel=0.005)                    # trigger housing
    grip(B, poly, poly_l, (-0.12, 0, -0.045), 0.1, 0.036, 0.034, 15, 6)
    B.box(poly, (0.0, 0, -0.06), (0.09, 0.0035, 0.004), bevel=0.001, seg=1)
    B.box(gunm, (-0.14, 0, -0.058), (0.006, 0.006, 0.02), bevel=0.001, rot=(0, -18, 0), seg=1)
    B.box(poly, (0.34, 0, -0.07), (0.05, 0.036, 0.05), bevel=0.006)                     # front grip
    grip(B, poly, poly_l, (0.34, 0, -0.045), 0.09, 0.032, 0.03, 5, 5)
    B.box(rubber, (-0.05, 0, 0.0), (0.14, 0.05, 0.03), bevel=0.01) if False else None
    B.box(poly, (-0.25, 0, -0.058), (0.16, 0.05, 0.026), bevel=0.008)                   # shoulder rest
    B.box(rubber, (-0.25, 0, -0.078), (0.15, 0.05, 0.008), bevel=0.003)
    B.box(steel, (0.12, 0.0455, 0.0), (0.05, 0.004, 0.02), bevel=0.001, seg=1)          # warning plate
    add_empties(B, 0.80, (-0.02, 0, 0.0905), (0.0, 0, 0.0685), (0.34, 0, -0.06), (-0.122, 0, -0.09), (0.34, 0, -0.07), eject=(-0.42, 0, 0))
    return group('rpg', [B.finish()])


BUILDERS = {'ar7': build_ar7, 'br12': build_br12, 'vx9': build_vx9, 'sg4': build_sg4, 'mg60': build_mg60, 'dmr14': build_dmr14, 'sr50': build_sr50,
            'p18': build_p18, 'rpg': build_rpg}


def build_stinger(mm):
    B = Builder('stinger_body')
    # Shoulder tube, replaceable canister, grip stock and battery/cooling unit.
    B.cyl(mm['olive'], (-0.42, 0, 0), (0.68, 0, 0), 0.046, verts=32)
    for x in [-0.38, -0.13, 0.29, 0.63]:
        B.cyl(mm['olive_d'], (x, 0, 0), (x + 0.024, 0, 0), 0.052, verts=32, bevel=0.001)
    B.cyl(mm['rubber'], (0.68, 0, 0), (0.695, 0, 0), 0.050, verts=32)
    B.cyl(mm['slot'], (0.695, 0, 0), (0.696, 0, 0), 0.037, verts=24)
    B.box(mm['poly'], (-0.08, 0, -0.064), (0.20, 0.075, 0.054), bevel=0.008)
    grip(B, mm['poly'], mm['poly_l'], (-0.09, 0, -0.070), 0.105, 0.044, 0.040, 10, 6)
    B.cyl(mm['gunm'], (-0.02, -0.043, -0.069), (0.14, -0.043, -0.069), 0.023, verts=24)
    B.box(mm['rubber'], (-0.29, 0, -0.055), (0.18, 0.072, 0.027), bevel=0.008)
    B.box(mm['poly'], (0.17, 0, -0.062), (0.055, 0.032, 0.046), bevel=0.004)
    B.box(mm['tan'], (0.30, -0.047, 0.007), (0.13, 0.0015, 0.023), bevel=0.0003)
    B.box(mm['poly'], (0, 0, 0.065), (0.085, 0.052, 0.018), bevel=0.003)
    for side in [-1, 1]:
        B.box(mm['poly'], (0, side * 0.025, 0.105), (0.052, 0.003, 0.060), bevel=0.001)
    B.box(mm['poly'], (0, 0, 0.135), (0.052, 0.053, 0.003), bevel=0.001)
    add_empties(B, 0.696, (-0.02, 0, 0.105), (0, 0, 0.065), (0.17, 0, -0.062), (-0.09, 0, -0.115), (0.17, 0, -0.073))
    return group('stinger', [B.finish()])

BUILDERS['stinger'] = build_stinger
