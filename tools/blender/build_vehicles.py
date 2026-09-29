"""Vehicle models -> src/client/assets/vehicles/<id>.glb.  Forward +X, up +Z, origin on the ground under the middle of the hull.
Parts the game moves separately are their own nodes: body, turret (origin = turret ring), gun (origin = mount pivot), rotor (origin = hub).
Empties on `body` tell the game where mounts are: turret_mount, gun_mount, rotor_mount.  Material 'paint' / 'paint_dark' are re-tinted per team.
python3 tools/blender/build_vehicles.py [tank jeep apc quad heli boat] [--preview]"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *  # noqa: E402,F401,F403

prev = '--preview' in sys.argv
want = [a for a in sys.argv[1:] if not a.startswith('--')] or ['tank', 'jeep', 'apc', 'quad', 'heli', 'boat']


def materials():
    return dict(
        paint=mat('paint', srgb('#5d6650'), 0.15, 0.62), paint2=mat('paint_dark', srgb('#454c3b'), 0.15, 0.7),
        rubber=mat('tire', srgb('#131417'), 0.0, 0.92), metal=mat('metal_dark', srgb('#3a3e45'), 0.9, 0.45), steel=mat('steel_bright', srgb('#9aa0a9'), 1.0, 0.3),
        glass=mat('glass', srgb('#5a7f95'), 0.0, 0.05, alpha=0.5), light=mat('light', srgb('#fff2b8'), 0.0, 0.2, emit=(1, 0.92, 0.6), emit_strength=5),
        tail=mat('tail_light', srgb('#ff2a1a'), 0.0, 0.3, emit=(1, 0.1, 0.05), emit_strength=3), seat=mat('seat', srgb('#2a2a2c'), 0.0, 0.85),
        slot=mat('slot', (0.01, 0.01, 0.011), 0.0, 0.9), canvas=mat('canvas', srgb('#6f7355'), 0.0, 0.9), gun=mat('gunmetal', srgb('#2c3036'), 1.0, 0.4),
    )


def wheel(B, M, x, y, z, r, w, hub=True):
    B.cyl(M['rubber'], (x, y - w / 2, z), (x, y + w / 2, z), r, verts=28, bevel=0.03)
    if hub:
        s = 1 if y >= 0 else -1
        B.cyl(M['metal'], (x, y + s * (w / 2 - 0.02), z), (x, y + s * (w / 2 + 0.02), z), r * 0.55, verts=20)
        B.cyl(M['steel'], (x, y + s * (w / 2 + 0.02), z), (x, y + s * (w / 2 + 0.05), z), r * 0.18, verts=10)
    for k in range(10):                                                                   # tread blocks
        a = k * math.pi / 5
        B.box(M['rubber'], (x + math.cos(a) * (r + 0.006), y, z + math.sin(a) * (r + 0.006)), (0.07, w * 0.96, 0.05), bevel=0.01, rot=(0, -math.degrees(a), 0), seg=1)


def mg(M, name='gun', scale=1.0):
    """pintle-mounted machine gun, pivot at the mount"""
    B = Builder(name)
    B.cyl(M['gun'], (0, 0, 0), (0, 0, 0.16), 0.05, verts=14)
    B.box(M['gun'], (0.05, 0, 0.26), (0.34, 0.09, 0.12), bevel=0.02)
    B.cyl(M['gun'], (0.22, 0, 0.27), (0.75, 0, 0.27), 0.017, verts=10)
    B.cyl(M['steel'], (0.75, 0, 0.27), (0.82, 0, 0.27), 0.024, verts=10)
    B.box(M['paint2'], (0.16, 0, 0.29), (0.05, 0.42, 0.34), bevel=0.02)                  # shield
    B.box(M['gun'], (-0.18, 0, 0.22), (0.16, 0.06, 0.05), bevel=0.01)
    B.box(M['metal'], (0.02, 0.10, 0.20), (0.16, 0.07, 0.15), bevel=0.02)                # ammo box
    return B.finish()


# ------------------------------------------------------------------------------------------------ tank
def build_tank(M):
    B = Builder('tank_body')
    hull = [((-3.3, 0, 0.9), 2.7, 0.78, 0.15), ((-2.6, 0, 1.0), 3.0, 1.0, 0.18), ((1.4, 0, 1.0), 3.0, 1.0, 0.18), ((2.6, 0, 0.82), 2.7, 0.75, 0.15), ((3.5, 0, 0.62), 2.4, 0.42, 0.1)]
    B.loft(M['paint'], hull)
    B.box(M['paint2'], (-3.36, 0, 0.9), (0.12, 2.4, 0.6), bevel=0.03)                     # rear plate
    for s in (1, -1):
        B.box(M['metal'], (0.0, s * 1.62, 0.78), (6.9, 0.62, 0.95), bevel=0.16)          # track belts
        B.box(M['paint2'], (0.15, s * 1.62, 1.06), (6.4, 0.66, 0.1), bevel=0.02)         # side skirts
        for i in range(7):
            B.cyl(M['rubber'], (-2.7 + i * 0.9, s * 1.62, 0.42), (-2.7 + i * 0.9, s * 1.62 + s * 0.26, 0.42), 0.34, verts=22)
            B.cyl(M['metal'], (-2.7 + i * 0.9, s * 1.62 + s * 0.25, 0.42), (-2.7 + i * 0.9, s * 1.62 + s * 0.29, 0.42), 0.2, verts=14)
        B.cyl(M['metal'], (-3.25, s * 1.62, 0.66), (-3.25, s * 1.62 + s * 0.3, 0.66), 0.4, verts=22)      # sprocket
        B.cyl(M['metal'], (3.3, s * 1.62, 0.6), (3.3, s * 1.62 + s * 0.3, 0.6), 0.42, verts=22)          # idler
        for i in range(3):
            B.cyl(M['rubber'], (-1.6 + i * 1.5, s * 1.62, 1.16), (-1.6 + i * 1.5, s * 1.62 + s * 0.2, 1.16), 0.14, verts=12)
        for i in range(34):                                                                # track cleats
            x = -3.2 + i * 0.2
            B.box(M['metal'], (x, s * 1.9, 1.02), (0.09, 0.05, 0.05), bevel=0.01, seg=1)
        B.box(M['paint2'], (2.55, s * 1.62, 1.1), (1.2, 0.68, 0.06), bevel=0.02, rot=(0, -12, 0))    # fender front
    # deck details
    B.box(M['slot'], (-2.55, 0, 1.51), (1.3, 1.5, 0.03), bevel=0.01, seg=1)
    for i in range(7):
        B.box(M['paint2'], (-3.1 + i * 0.18, 0, 1.53), (0.05, 1.4, 0.03), bevel=0.008, seg=1)
    for s in (1, -1):
        B.cyl(M['metal'], (-1.4, s * 1.3, 1.6), (0.8, s * 1.3, 1.6), 0.05, verts=8)      # tow cable
        B.box(M['paint2'], (-1.0, s * 1.2, 1.56), (0.7, 0.35, 0.22), bevel=0.04)         # tool box
        B.box(M['light'], (3.4, s * 0.9, 0.78), (0.08, 0.18, 0.1), bevel=0.02)          # headlights
        B.box(M['tail'], (-3.4, s * 1.0, 0.95), (0.05, 0.16, 0.08), bevel=0.01)
    B.cyl(M['paint2'], (-3.0, 0.9, 1.6), (-3.0, 0.9, 2.0), 0.16, verts=12)               # fuel drum
    B.cyl(M['paint2'], (-3.0, 0.5, 1.6), (-3.0, 0.5, 2.0), 0.16, verts=12)
    B.empty('turret_mount', (0.0, 0, 1.5)); B.empty('gun_mount', (-0.2, 0.65, 2.2)); B.empty('ring', (0, 0, 1.5))
    body = B.finish()
    T = Builder('tank_turret')
    tur = [((-2.0, 0, 0.55), 2.0, 0.85, 0.18), ((-1.2, 0, 0.5), 2.5, 1.0, 0.25), ((0.6, 0, 0.5), 2.45, 1.0, 0.22), ((1.6, 0, 0.42), 1.9, 0.8, 0.2), ((2.0, 0, 0.42), 1.5, 0.66, 0.15)]
    T.loft(M['paint'], tur)
    T.box(M['paint2'], (-2.2, 0, 0.55), (0.9, 2.0, 0.75), bevel=0.12)                    # bustle
    T.box(M['paint2'], (2.0, 0, 0.42), (0.5, 1.2, 0.6), bevel=0.1)                       # gun mantlet
    T.cyl(M['gun'], (2.2, 0, 0.42), (6.6, 0, 0.42), 0.115, r2=0.095, verts=24)          # main gun
    T.cyl(M['gun'], (4.2, 0, 0.42), (4.75, 0, 0.42), 0.16, verts=20)                     # fume extractor
    T.cyl(M['steel'], (6.5, 0, 0.42), (6.7, 0, 0.42), 0.14, verts=20)
    T.box(M['metal'], (2.3, -0.28, 0.32), (0.4, 0.13, 0.13), bevel=0.03)                # coax MG housing
    T.cyl(M['paint2'], (-0.3, 0.6, 1.0), (-0.3, 0.6, 1.16), 0.42, verts=24)              # commander cupola
    T.cyl(M['glass'], (-0.3, 0.6, 1.12), (-0.3, 0.6, 1.16), 0.34, verts=20)
    T.box(M['paint2'], (0.5, -0.6, 1.02), (0.7, 0.7, 0.08), bevel=0.02)                  # loader hatch
    for s in (1, -1):
        for i in range(3):
            T.cyl(M['metal'], (1.15, s * 1.3, 0.6 + i * 0.13), (1.3, s * 1.4, 0.6 + i * 0.13), 0.05, verts=8, )
    T.cyl(M['metal'], (-1.9, -0.8, 1.0), (-1.9, -0.8, 2.6), 0.014, verts=6)              # antenna
    T.box(M['steel'], (0.9, 0.85, 1.05), (0.25, 0.22, 0.2), bevel=0.04)                  # sight
    turret = T.finish()
    return [body, turret, mg(M)]


# ------------------------------------------------------------------------------------------------ jeep
def build_jeep(M):
    B = Builder('jeep_body')
    B.loft(M['paint'], [((-2.0, 0, 0.72), 1.7, 0.42, 0.1), ((-0.6, 0, 0.72), 1.78, 0.5, 0.1), ((1.0, 0, 0.72), 1.78, 0.5, 0.1), ((2.05, 0, 0.72), 1.62, 0.42, 0.1)])
    B.box(M['paint'], (1.3, 0, 1.08), (1.3, 1.7, 0.32), bevel=0.08)                       # hood
    B.box(M['slot'], (2.1, 0, 0.95), (0.06, 1.1, 0.4), bevel=0.02)                        # grille
    for i in range(6):
        B.box(M['metal'], (2.135, 0, 0.8 + i * 0.065), (0.02, 1.05, 0.02), bevel=0.004, seg=1)
    for s in (1, -1):
        B.box(M['paint2'], (1.6, s * 0.95, 0.95), (1.5, 0.32, 0.12), bevel=0.05)          # fenders
        B.box(M['light'], (2.1, s * 0.55, 1.0), (0.07, 0.22, 0.2), bevel=0.04)
        B.box(M['tail'], (-2.05, s * 0.7, 0.85), (0.05, 0.16, 0.16), bevel=0.02)
    B.box(M['paint2'], (2.16, 0, 0.55), (0.14, 1.9, 0.2), bevel=0.05)                     # bumper
    B.box(M['paint2'], (-2.14, 0, 0.55), (0.14, 1.9, 0.2), bevel=0.05)
    # windshield frame + glass, cabin seats, roll bar
    B.box(M['glass'], (0.55, 0, 1.36), (0.05, 1.45, 0.5), bevel=0.01, rot=(0, 22, 0), seg=1)
    B.box(M['metal'], (0.55, 0, 1.63), (0.08, 1.6, 0.06), bevel=0.02, rot=(0, 22, 0))
    for s in (1, -1):
        B.cyl(M['metal'], (0.42, s * 0.75, 1.08), (0.66, s * 0.75, 1.64), 0.028, verts=8)
        B.box(M['seat'], (-0.45, s * 0.42, 1.05), (0.6, 0.6, 0.18), bevel=0.06)
        B.box(M['seat'], (-0.72, s * 0.42, 1.32), (0.12, 0.6, 0.55), bevel=0.05, rot=(0, -8, 0))
    B.box(M['paint2'], (-1.5, 0, 0.98), (1.2, 1.7, 0.08), bevel=0.02)                      # rear bed floor
    for x in (-1.0, -2.0):
        B.cyl(M['metal'], (x, -0.85, 0.98), (x, -0.85, 1.75), 0.03, verts=8); B.cyl(M['metal'], (x, 0.85, 0.98), (x, 0.85, 1.75), 0.03, verts=8)
    B.cyl(M['metal'], (-2.0, -0.85, 1.75), (-1.0, -0.85, 1.75), 0.03, verts=8); B.cyl(M['metal'], (-2.0, 0.85, 1.75), (-1.0, 0.85, 1.75), 0.03, verts=8)
    B.cyl(M['rubber'], (-2.22, -0.1, 0.9), (-2.22, -0.1, 0.9), 0.0, verts=6) if False else None
    B.cyl(M['rubber'], (-2.18, 0, 1.0), (-2.05, 0, 1.0), 0.4, verts=24)                    # spare wheel on the tailgate
    B.cyl(M['metal'], (-2.19, 0, 1.0), (-2.15, 0, 1.0), 0.2, verts=16)
    B.box(M['paint2'], (-1.3, -0.6, 1.16), (0.3, 0.2, 0.34), bevel=0.04)                   # jerry can
    B.box(M['canvas'], (-1.3, 0.55, 1.14), (0.7, 0.55, 0.26), bevel=0.08)                  # cargo bag
    for x, y in ((1.25, 0.95), (1.25, -0.95), (-1.25, 0.95), (-1.25, -0.95)):
        wheel(B, M, x, y * 1.02, 0.44, 0.44, 0.32)
    B.cyl(M['metal'], (-2.2, 0.55, 0.45), (-2.5, 0.55, 0.45), 0.04, verts=8)                # exhaust
    B.cyl(M['metal'], (-1.5, -0.9, 1.75), (-1.5, -0.9, 2.9), 0.012, verts=6)                # antenna
    B.empty('gun_mount', (-1.2, 0, 1.15)); B.empty('turret_mount', (0, 0, 1.2))
    return [B.finish(), mg(M)]


# ------------------------------------------------------------------------------------------------ quad bike
def build_quad(M):
    B = Builder('quad_body')
    B.loft(M['paint'], [((-0.85, 0, 0.62), 0.8, 0.22, 0.05), ((0.0, 0, 0.7), 0.85, 0.34, 0.08), ((0.75, 0, 0.66), 0.62, 0.28, 0.07)])
    B.box(M['paint'], (0.6, 0, 0.92), (0.6, 0.62, 0.22), bevel=0.06)
    B.box(M['seat'], (-0.3, 0, 0.9), (0.7, 0.36, 0.14), bevel=0.05)
    B.cyl(M['metal'], (0.3, -0.42, 1.05), (0.3, 0.42, 1.05), 0.022, verts=8)                # handlebar
    B.cyl(M['metal'], (0.3, 0, 0.9), (0.3, 0, 1.05), 0.03, verts=8)
    for s in (1, -1):
        B.box(M['rubber'], (0.3, s * 0.44, 1.05), (0.12, 0.06, 0.06), bevel=0.02)
        B.box(M['light'], (0.98, s * 0.2, 0.86), (0.05, 0.14, 0.1), bevel=0.02)
        B.box(M['paint2'], (0.8, s * 0.6, 0.72), (0.85, 0.16, 0.06), bevel=0.02)
        B.box(M['paint2'], (-0.7, s * 0.6, 0.72), (0.75, 0.16, 0.06), bevel=0.02)
    B.box(M['metal'], (-0.85, 0, 0.95), (0.5, 0.55, 0.05), bevel=0.02)                        # rack
    B.box(M['tail'], (-1.08, 0.15, 0.78), (0.03, 0.1, 0.06), bevel=0.01)
    for x, y in ((0.65, 0.58), (0.65, -0.58), (-0.7, 0.58), (-0.7, -0.58)):
        wheel(B, M, x, y, 0.32, 0.32, 0.26)
    B.cyl(M['metal'], (-1.0, 0.2, 0.4), (-1.35, 0.2, 0.4), 0.035, verts=8)
    return [B.finish()]


# ------------------------------------------------------------------------------------------------ APC
def build_apc(M):
    B = Builder('apc_body')
    B.loft(M['paint'], [((-3.4, 0, 1.2), 2.7, 1.5, 0.12), ((-2.8, 0, 1.3), 2.9, 1.8, 0.14), ((1.6, 0, 1.3), 2.9, 1.8, 0.14), ((2.9, 0, 1.0), 2.6, 1.0, 0.12), ((3.5, 0, 0.85), 2.3, 0.6, 0.1)])
    B.box(M['paint2'], (-0.6, 0, 2.27), (5.0, 2.7, 0.14), bevel=0.05)                        # roof plate
    B.box(M['paint2'], (3.2, 0, 1.45), (1.1, 2.4, 0.06), bevel=0.02, rot=(0, -28, 0))
    for s in (1, -1):
        for i in range(4):
            wheel(B, M, -2.4 + i * 1.6, s * 1.48, 0.55, 0.55, 0.42)
        B.box(M['paint2'], (0.0, s * 1.5, 0.55), (6.6, 0.12, 0.3), bevel=0.05)                # wheel guard
        B.box(M['light'], (3.45, s * 0.85, 1.0), (0.07, 0.2, 0.14), bevel=0.03)
        B.box(M['tail'], (-3.5, s * 1.1, 1.3), (0.05, 0.18, 0.12), bevel=0.02)
        B.box(M['paint2'], (0.0, s * 1.46, 1.55), (5.4, 0.08, 0.5), bevel=0.02)               # side armour
        B.cyl(M['metal'], (-3.2, s * 0.9, 2.4), (-3.2, s * 0.9, 2.8), 0.3, verts=14) if False else None
    B.box(M['seat'], (-2.3, 0, 2.4), (0.9, 0.9, 0.22), bevel=0.06)                           # rear hatch
    B.box(M['metal'], (-1.5, 0.9, 2.42), (0.5, 0.6, 0.1), bevel=0.03)
    for i in range(4):
        B.cyl(M['metal'], (2.5, -0.8 + i * 0.5, 1.7), (2.62, -0.8 + i * 0.5, 1.78), 0.06, verts=8)     # smoke launchers
    B.cyl(M['metal'], (-3.0, -1.0, 2.34), (-3.0, -1.0, 3.6), 0.012, verts=6)
    B.empty('turret_mount', (0.3, 0, 2.34)); B.empty('gun_mount', (-1.0, 0.9, 2.5))
    body = B.finish()
    T = Builder('apc_turret')
    T.loft(M['paint'], [((-0.9, 0, 0.35), 1.3, 0.55, 0.14), ((0.0, 0, 0.36), 1.6, 0.7, 0.2), ((0.8, 0, 0.33), 1.3, 0.55, 0.16)])
    T.box(M['paint2'], (1.0, 0, 0.32), (0.45, 0.8, 0.45), bevel=0.08)
    T.cyl(M['gun'], (1.1, 0, 0.32), (3.4, 0, 0.32), 0.055, verts=16)                          # autocannon
    T.cyl(M['steel'], (3.3, 0, 0.32), (3.5, 0, 0.32), 0.075, verts=16)
    T.box(M['metal'], (0.6, -0.5, 0.22), (0.5, 0.14, 0.18), bevel=0.04)
    T.cyl(M['metal'], (-0.3, 0.35, 0.62), (-0.3, 0.35, 0.7), 0.24, verts=18)
    T.box(M['steel'], (0.25, -0.45, 0.66), (0.2, 0.22, 0.16), bevel=0.04)
    return [body, T.finish(), mg(M)]


# ------------------------------------------------------------------------------------------------ attack helicopter
def build_heli(M):
    B = Builder('heli_body')
    B.loft(M['paint'], [((-1.6, 0, 1.55), 0.9, 0.9, 0.3), ((-0.6, 0, 1.6), 1.25, 1.45, 0.4), ((0.8, 0, 1.55), 1.15, 1.4, 0.4), ((2.0, 0, 1.4), 0.75, 0.95, 0.3), ((2.7, 0, 1.25), 0.4, 0.5, 0.15)])
    B.loft(M['glass'], [((0.9, 0, 1.95), 0.62, 0.34, 0.1), ((1.6, 0, 1.75), 0.55, 0.3, 0.1)])            # canopy
    B.box(M['glass'], (1.4, 0, 1.78), (1.4, 0.7, 0.05), bevel=0.02, rot=(0, -10, 0), seg=1)
    B.cyl(M['paint'], (-1.6, 0, 1.7), (-6.6, 0, 1.95), 0.32, r2=0.13, verts=18)                      # tail boom
    B.box(M['paint2'], (-6.5, 0, 2.6), (0.9, 0.08, 1.3), bevel=0.02, rot=(0, -18, 0))                   # tail fin
    B.box(M['paint2'], (-6.2, 0, 2.05), (0.6, 1.5, 0.06), bevel=0.015)                                  # stabiliser
    B.cyl(M['metal'], (-6.55, 0.09, 2.85), (-6.55, 0.14, 2.85), 0.5, verts=20)                        # tail rotor disc (hub)
    for k in range(4):
        a = k * math.pi / 2
        B.box(M['metal'], (-6.55, 0.15, 2.85), (0.08, 0.02, 0.9), bevel=0.005, rot=(0, math.degrees(a), 0), seg=1)
    for s in (1, -1):
        B.box(M['paint2'], (0.0, s * 1.0, 1.32), (1.8, 1.5, 0.12), bevel=0.04)                        # stub wings
        for i in range(2):
            for j in range(3):                                                                            # rocket pods
                B.cyl(M['metal'], (-0.35, s * (0.75 + i * 0.85), 1.05 + j * 0.0), (0.95, s * (0.75 + i * 0.85), 1.05), 0.16, verts=14) if j == 0 else None
            B.cyl(M['steel'], (0.94, s * (0.75 + i * 0.85), 1.05), (0.96, s * (0.75 + i * 0.85), 1.05), 0.14, verts=14)
        B.cyl(M['paint2'], (-0.7, s * 0.7, 2.05), (0.9, s * 0.7, 2.05), 0.3, verts=16)               # engine cowls
        B.cyl(M['slot'], (-0.7, s * 0.7, 2.05), (-0.68, s * 0.7, 2.05), 0.22, verts=12)
        B.cyl(M['metal'], (-0.9, s * 0.9, 0.52), (0.9, s * 0.9, 0.52), 0.05, verts=8)                 # skids
        B.cyl(M['metal'], (-0.5, s * 0.85, 0.5), (-0.5, s * 0.55, 1.2), 0.04, verts=8)
        B.cyl(M['metal'], (0.6, s * 0.85, 0.5), (0.6, s * 0.55, 1.2), 0.04, verts=8)
    B.box(M['paint2'], (0.0, 0, 2.55), (0.6, 0.6, 0.5), bevel=0.1)                                       # rotor mast housing
    B.box(M['light'], (2.6, 0, 1.0), (0.1, 0.2, 0.1), bevel=0.03)
    B.empty('rotor_mount', (0.0, 0, 3.05)); B.empty('gun_mount', (2.4, 0, 0.95)); B.empty('turret_mount', (0, 0, 0))
    body = B.finish()
    R = Builder('heli_rotor')
    R.cyl(M['metal'], (0, 0, 0), (0, 0, 0.16), 0.22, verts=16)
    R.cyl(M['steel'], (0, 0, 0.16), (0, 0, 0.24), 0.1, verts=12)
    for k in range(4):
        a = k * math.pi / 2
        R.box(M['metal'], (math.cos(a) * 3.9, math.sin(a) * 3.9, 0.06), (7.4, 0.2, 0.03), bevel=0.008, rot=(0, 0, math.degrees(a)), seg=1)
    rotor = R.finish()
    G = Builder('heli_gun')
    G.cyl(M['metal'], (0, 0, 0.1), (0, 0, -0.1), 0.14, verts=14)
    G.cyl(M['gun'], (0, 0, -0.12), (0.9, 0, -0.12), 0.04, verts=12)
    G.box(M['metal'], (0.0, 0, -0.12), (0.3, 0.2, 0.16), bevel=0.04)
    return [body, rotor, G.finish()]


# ------------------------------------------------------------------------------------------------ patrol boat
def build_boat(M):
    B = Builder('boat_body')
    B.loft(M['paint2'], [((-3.6, 0, 0.5), 2.5, 0.95, 0.3), ((-1.5, 0, 0.55), 2.9, 1.05, 0.35), ((1.0, 0, 0.6), 2.5, 1.0, 0.3), ((2.9, 0, 0.68), 1.4, 0.85, 0.25), ((4.0, 0, 0.78), 0.3, 0.55, 0.1)])
    B.loft(M['paint'], [((-3.5, 0, 1.07), 2.3, 0.14, 0.05), ((0.6, 0, 1.1), 2.5, 0.16, 0.05), ((3.2, 0, 1.06), 1.1, 0.14, 0.05)])           # deck
    B.box(M['paint'], (-1.0, 0, 1.75), (2.6, 1.9, 1.2), bevel=0.15)                                                                           # cabin
    B.box(M['glass'], (0.4, 0, 1.85), (0.06, 1.7, 0.6), bevel=0.02, rot=(0, 18, 0), seg=1)
    for s in (1, -1):
        B.box(M['glass'], (-1.0, s * 0.96, 1.85), (1.6, 0.05, 0.5), bevel=0.02, seg=1)
        B.cyl(M['metal'], (-3.4, s * 1.2, 1.15), (2.8, s * 1.2, 1.15), 0.03, verts=8)              # rail
        B.box(M['tail'], (-3.7, s * 0.9, 0.9), (0.04, 0.14, 0.1), bevel=0.01)
    B.box(M['paint2'], (-1.0, 0, 2.4), (1.6, 1.5, 0.1), bevel=0.03)                                  # roof
    B.cyl(M['metal'], (-1.6, 0, 2.45), (-1.6, 0, 3.4), 0.05, verts=8)                                # mast
    B.box(M['steel'], (-1.6, 0, 3.3), (0.6, 0.06, 0.06), bevel=0.01, rot=(0, 0, 25), seg=1)         # radar
    for s in (1, -1):
        B.box(M['metal'], (-3.75, s * 0.6, 0.7), (0.5, 0.5, 0.7), bevel=0.06)                        # outboards
        B.cyl(M['metal'], (-3.95, s * 0.6, 0.55), (-4.15, s * 0.6, 0.55), 0.2, verts=14)
    B.box(M['light'], (3.0, 0, 1.2), (0.1, 0.24, 0.1), bevel=0.03)
    B.empty('gun_mount', (2.4, 0, 1.15)); B.empty('turret_mount', (0, 0, 1.1))
    return [B.finish(), mg(M)]


BUILD = {'tank': build_tank, 'jeep': build_jeep, 'apc': build_apc, 'quad': build_quad, 'heli': build_heli, 'boat': build_boat}
SCENES = {'tank': ((14, -13, 6), (0.5, 0, 1.3)), 'jeep': ((8, -8, 3.5), (0, 0, 1.0)), 'apc': ((12, -11, 5), (0, 0, 1.3)), 'quad': ((4, -4.5, 2.2), (0, 0, 0.6)),
          'heli': ((16, -16, 8), (-1.2, 0, 2.0)), 'boat': ((14, -14, 6), (0, 0, 1.2))}
for name in want:
    reset()
    M = materials()
    parts = BUILD[name](M)
    names = {'tank': ['body', 'turret', 'gun'], 'jeep': ['body', 'gun'], 'apc': ['body', 'turret', 'gun'], 'quad': ['body'], 'heli': ['body', 'rotor', 'gun'], 'boat': ['body', 'gun']}[name]
    for o, n in zip(parts, names):
        o.name = n
    if name == 'heli':
        parts[1].location = (0, 0, 3.05)
    if name == 'tank':
        parts[1].location = (0, 0, 1.5)
    if name == 'apc':
        parts[1].location = (0.3, 0, 2.34)
    root = group(name, parts)
    if prev:
        cam, tgt = SCENES[name]
        preview(name, cam, tgt, w=900, h=560, lens=45, samples=20)
        for o in [o for o in bpy.data.objects if o.type in ('CAMERA', 'LIGHT')]:
            bpy.data.objects.remove(o)
    export(os.path.join(OUT, 'vehicles', name + '.glb'), [root] + list(root.children_recursive))
