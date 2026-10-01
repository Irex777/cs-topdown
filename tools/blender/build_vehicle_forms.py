"""Recreate vehicles-v2.png as articulated, textured Blender models."""
import os
import sys
import math
import importlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib
importlib.reload(lib)
import build_vehicles as V
importlib.reload(V)
import world_v2_lib as W
importlib.reload(W)
import vehicle_surfaces as surfaces
importlib.reload(surfaces)
Bld = lib.Builder

original_materials = V.materials

def materials():
    m = original_materials()
    for key,color in [('paint','#7d856e'),('paint2','#656f59')]:
        tint=(*lib.srgb(color),1)
        next(n for n in m[key].node_tree.nodes if n.type=='MIX_RGB').inputs[2].default_value=tint
        m[key]['frontline_base_color_factor']=list(tint)
    m['rubber'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*lib.srgb('#252723'), 1)
    m['metal'].node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = .45
    m['steel'].node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = .55
    m['glass'] = lib.mat('armored_glass', lib.srgb('#33464b'), metal=.45, rough=.14)
    m['mud'] = lib.mat('tire_dust', lib.srgb('#66634e'), rough=1)
    m['edge'] = lib.mat('edge_wear', lib.srgb('#8e9480'), metal=.2, rough=.82)
    m['panel'] = lib.image_mat('armor_panels', 'skins/field-metal-runtime.jpg', lib.srgb('#858d72'), metal=.12, rough=.86)
    m['recess'] = lib.mat('panel_seams', lib.srgb('#414637'), rough=.98)
    m['dust'] = lib.mat('hull_dust', lib.srgb('#86816a'), rough=.97)
    m['light'].node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = .8
    return m


def wheel(builder, m, x, y, z, r, width, hub=True, articulate=True):
    if articulate:
        b = Bld('wheel_' + str(len(V.WHEELS)))
        wheel(b, m, 0, 0, 0, r, width, hub, False)
        node = b.finish(uv_size=.6)
        node.location = (x, y, z)
        V.WHEELS.append(node)
        return
    profile = [(-width * .5, r * .53), (-width * .54, r * .75), (-width * .42, r * .96), (-width * .3, r), (width * .3, r), (width * .42, r * .96), (width * .54, r * .75), (width * .5, r * .53)]
    n = 28 if m.get('tracked') else 40
    verts = [(x + math.cos(i * math.tau / n) * rad, y + axial, z + math.sin(i * math.tau / n) * rad) for axial, rad in profile for i in range(n)]
    polys = [[j * n + i, j * n + (i + 1) % n, (j + 1) * n + (i + 1) % n, (j + 1) * n + i] for j in range(len(profile) - 1) for i in range(n)]
    W.faces(builder, m['rubber'], verts, polys)
    for side in (-1, 1):
        ax = y + side * width * .51
        builder.cyl(m['paint2'], (x, ax - .008, z), (x, ax + .008, z), r * .51, verts=20)
        builder.cyl(m['metal'], (x, ax - .015, z), (x, ax + .015, z), r * .33, verts=16)
        builder.cyl(m['edge'], (x, ax - .024, z), (x, ax + .024, z), r * .13, verts=12)
        for k in range(6):
            a = k * math.tau / 6
            bx, bz = x + math.cos(a) * r * .32, z + math.sin(a) * r * .32
            builder.cyl(m['steel'], (bx, ax - .023, bz), (bx, ax + .023, bz), r * .028, verts=6)
        for k in range(8):
            a = k * math.tau / 8
            builder.cyl(m['slot'], (x+math.cos(a)*r*.40,ax-side*.015,z+math.sin(a)*r*.40), (x+math.cos(a)*r*.40,ax+side*.017,z+math.sin(a)*r*.40),r*.047,verts=8)
        builder.tube(m['edge'],(x,ax-side*.009,z),(x,ax+side*.012,z),r*.51,r*.48,verts=32)
    for i in range(0 if m.get('tracked') else 36):
        for side in (-1,0,1):
            a = (i + (side==0)*.5) * math.tau / 36
            builder.box(m['rubber'] if i%9 else m['mud'], (x + math.cos(a) * (r + .012), y + side * width * .31, z + math.sin(a) * (r + .012)), (.065, width * .30, .032), bevel=.003,seg=1, rot=(0, 90-math.degrees(a), side * 15))


def bolts(b, m, xvalues, y, z, radius=.015):
    for x in xvalues:
        b.cyl(m['edge'], (x, y - .006, z), (x, y + .006, z), radius, verts=6)


def panel(b,m,profile,y,thickness=.024,fasteners=True):
    """Separate armor plate, narrow dark joint, bevelled perimeter and fixings."""
    W.prism(b,m['recess'],profile,thickness*1.15,y)
    cx=sum(p[0] for p in profile)/len(profile);cz=sum(p[1] for p in profile)/len(profile)
    inset=[(cx+(x-cx)*.965,cz+(z-cz)*.965) for x,z in profile]
    side=1 if y>=0 else -1
    W.prism(b,m['panel'],inset,thickness,y+side*thickness*.6)
    if fasteners:
        for (x,z),(xx,zz) in zip(inset,inset[1:]+inset[:1]):
            length=math.hypot(xx-x,zz-z);n=max(1,int(length/.27))
            for k in range(n+1):
                t=.08+.84*k/n
                bx,bz=x+(xx-x)*t,z+(zz-z)*t
                b.cyl(m['metal'],(bx,y+side*thickness,bz),(bx,y+side*(thickness+.009),bz),.014,verts=6)


def grille(b,m,x,y,z,width,height,front=True):
    b.box(m['slot'],(x,y,z),(.016,width,height) if front else(width,.016,height),bevel=.005)
    for k in range(8):
        zz=z-height*.44+k*height*.125
        b.box(m['edge'],(x+.01 if front else x,y if front else y+.01,zz),(.024,width*.96,.012) if front else(width*.96,.024,.012),bevel=.002,seg=1)


def stowage(b,m,x,y,z,size=(.52,.38,.22)):
    b.box(m['canvas'],(x,y,z),size,bevel=.045,seg=3)
    for xx in(-.16,.16):
        b.box(m['seat'],(x+xx,y,z+size[2]/2+.004),(.024,size[1],.008),bevel=.002)
        for side in(-1,1):b.box(m['seat'],(x+xx,y+side*size[1]/2,z),(.024,.008,size[2]),bevel=.002)


def guard_arch(b,m,x,y,z,r,width):
    # A shaped mudguard follows the tire, with a visible open wheel well.
    for i in range(9):
        a=math.pi*.06+i*math.pi*.88/8
        b.box(m['paint2'],(x+math.cos(a)*(r+.095),y,z+math.sin(a)*(r+.095)),(.20,width,.055),bevel=.007,seg=1,rot=(0,90-math.degrees(a),0))


def mounted_hmg(m):
    b=Bld('gun')
    b.cyl(m['metal'],(0,0,0),(0,0,.21),.042,verts=16)
    b.box(m['metal'],(-.10,0,.27),(.34,.105,.125),bevel=.018)
    b.box(m['gun'],(-.11,0,.34),(.24,.106,.022),bevel=.006)
    b.cyl(m['gun'],(.05,0,.27),(.82,0,.27),.024,verts=18)
    b.cyl(m['metal'],(.06,0,.27),(.31,0,.27),.050,verts=20)
    for x in(.08,.16,.24):
        for side in(-1,1):b.cyl(m['slot'],(x,side*.048,.27),(x,side*.053,.27),.014,verts=8)
    b.tube(m['steel'],(.77,0,.27),(.82,0,.27),.031,.021,verts=16)
    for side in(-1,1):
        W.pipe(b,m['metal'],[(-.25,side*.032,.24),(-.33,side*.12,.25),(-.38,side*.12,.23)],.012)
        b.cyl(m['rubber'],(-.38,side*.12,.18),(-.38,side*.12,.27),.025,verts=12)
    b.box(m['paint2'],(-.1,.23,.19),(.20,.19,.22),bevel=.015)
    for i in range(7):b.cyl(m['edge'],(-.18+i*.026,.12,.32),(-.18+i*.026,.20,.32),.008,verts=7)
    gun=b.finish(uv_size=.35)
    shield=Bld('gun_shield')
    for center,size in [((.22,0,.095),(.033,.70,.19)),((.22,0,.49),(.033,.70,.24)),((.22,-.235,.285),(.033,.23,.19)),((.22,.235,.285),(.033,.23,.19))]:shield.box(m['paint2'],center,size,bevel=.012,seg=2)
    for y in(-.30,.30):
        for z in(.05,.15,.43,.55):shield.cyl(m['metal'],(.238,y,z),(.249,y,z),.012,verts=6)
    for side in(-1,1):W.pipe(shield,m['metal'],[(.14,side*.30,.04),(.14,side*.30,.6)],.012)
    child=shield.finish(uv_size=.6);child.parent=gun
    return gun


def jeep(m):
    b = Bld('jeep_body')
    W.prism(b, m['paint2'], [(-2.05,.53),(2.1,.53),(2.2,.8),(1.7,1.08),(-1.75,1.05),(-2.05,.87)], 1.76)
    # Four door armored cab with sloped windscreen and gently tapered hood.
    W.shell(b,m['paint'],[(-1.88,.87,.91,1.60),(-1.72,.87,.91,1.84),(.40,.87,.91,1.84),(.85,.84,.91,1.28),(.95,.82,.91,1.21)])
    W.prism(b, m['paint'], [(.84,.93),(2.1,.93),(2.0,1.21),(.84,1.36)], 1.64)
    for side in (-1,1):
        yy = side * .886
        for x in (-1.18,-.22):
            b.box(m['paint2'], (x, yy, 1.25), (.86,.025,.73), bevel=.028, seg=1)
            W.prism(b, m['glass'], [(x-.31,1.42),(x+.31,1.42),(x+.28,1.73),(x-.31,1.73)], .022, yy + side * .019)
            b.box(m['metal'], (x+.27, yy+side*.026, 1.33), (.12,.032,.023), bevel=.005)
            for hinge in (1.05,1.30): b.box(m['metal'], (x-.39,yy+side*.02,hinge),(.05,.028,.06),bevel=.004)
            bolts(b,m,[x-.3,x+.3],yy+side*.015,1.0)
            panel(b,m,[(x-.40,.97),(x+.40,.97),(x+.40,1.38),(x-.40,1.38)],yy+side*.038)
            W.pipe(b,m['edge'],[(x-.37,yy+side*.042,1.41),(x-.37,yy+side*.042,1.78),(x+.34,yy+side*.042,1.78),(x+.34,yy+side*.042,1.41)],.010,6)
            for z in(1.01,1.27):b.box(m['metal'],(x-.42,yy+side*.056,z),(.10,.027,.064),bevel=.006)
            for z in(1.06,1.25):b.cyl(m['steel'],(x-.39,yy+side*.056,z),(x-.39,yy+side*.077,z),.016,verts=6)
            b.box(m['metal'],(x+.22,yy+side*.065,1.345),(.135,.037,.025),bevel=.006)
        for x in (-1.3,1.3):
            for a0,a1 in [(-.60,.15),(.15,.9)]:
                xa,xb=x+a0,x+a1
                W.prism(b,m['paint2'],[(xa,.88),(xb,.88),(xb,.99),(xa,.99)],.30,side*.96)
            b.box(m['rubber'], (x-.5,side*.96,.65),(.05,.30,.4),bevel=.006)
            wheel(b,m,x,side*.985,.46,.445,.34)
            guard_arch(b,m,x,side*.965,.46,.445,.36)
        b.box(m['metal'],(-.45,side*.99,.61),(1.5,.22,.08),bevel=.012)
        b.box(m['metal'],(2.115,side*.59,1.035),(.05,.31,.25),bevel=.025)
        b.cyl(m['steel'],(2.14,side*.59,1.065),(2.16,side*.59,1.065),.086,verts=24)
        b.cyl(m['light'],(2.16,side*.59,1.065),(2.166,side*.59,1.065),.069,verts=24)
        b.box(m['tail'],(2.162,side*.60,.958),(.017,.11,.035),bevel=.006)
        b.box(m['tail'],(-2.075,side*.63,.93),(.024,.12,.16),bevel=.008)
        W.pipe(b,m['metal'],[(.34,side*.88,1.55),(.64,side*1.04,1.53),(.7,side*1.04,1.55)],.015)
        b.box(m['metal'],(.70,side*1.055,1.56),(.09,.08,.14),bevel=.018)
    # Glass follows the actual slope rather than floating between two poles.
    for side in (-1,1):
        y0,y1=side*.06,side*.76
        W.faces(b,m['glass'],[(.864,y0,1.308),(.864,y1,1.308),(.425,y1,1.824),(.425,y0,1.824)],[[0,1,2,3]])
        W.pipe(b,m['metal'],[(.86,side*.72,1.3),(.72,side*.38,1.44)],.012)
        W.pipe(b,m['edge'],[(.87,side*.79,1.30),(.43,side*.79,1.82),(.43,side*.025,1.82),(.87,side*.025,1.30)],.012,8)
        b.box(m['metal'],(.52,side*.92,1.81),(.19,.03,.17),bevel=.015)
        panel(b,m,[(.90,1.02),(1.88,1.02),(1.86,1.18),(.90,1.31)],side*.846)
        W.pipe(b,m['metal'],[(1.84,side*.62,1.23),(1.88,side*.62,1.30),(1.68,side*.62,1.33),(1.64,side*.62,1.27)],.011)
        stowage(b,m,-1.67,side*.94,1.05,(.28,.13,.44))
        b.box(m['metal'],(-1.90,side*.91,1.05),(.12,.04,.11),bevel=.007)
        b.cyl(m['metal'],(-1.94,side*.93,1.48),(-1.94,side*.93,1.90),.026,verts=10)
        for x in(-1.55,-.55):
            b.box(m['edge'],(x,side*.89,1.865),(.06,.07,.03),bevel=.006)
    for y in(-.59,.59):
        b.box(m['panel'],(1.45,y,1.269),(.66,.32,.028),bevel=.014,rot=(0,7,0))
        for x in(1.2,1.7):b.cyl(m['metal'],(x,y,1.273),(x,y,1.305),.013,verts=6)
    b.box(m['slot'],(2.116,0,.98),(.023,.72,.27),bevel=.016)
    for z in (.9,.98,1.06): b.box(m['metal'],(2.134,0,z),(.018,.72,.018),bevel=0)
    b.box(m['paint2'],(2.2,0,.61),(.16,1.91,.14),bevel=.025)
    b.box(m['paint2'],(-2.14,0,.61),(.12,1.84,.13),bevel=.018)
    W.pipe(b,m['metal'],[(2.21,-.76,.63),(2.21,-.76,1.22),(2.21,.76,1.22),(2.21,.76,.63)],.022)
    b.cyl(m['metal'],(2.27,-.27,.64),(2.27,.27,.64),.073,verts=16)
    b.box(m['edge'],(2.33,0,.68),(.025,.28,.095),bevel=.014)
    for side in(-1,1):
        W.pipe(b,m['steel'],[(2.23,side*.56,.63),(2.3,side*.56,.47),(2.22,side*.56,.43),(2.16,side*.56,.53)],.025)
    b.cyl(m['rubber'],(-2.27,0,1.14),(-2.08,0,1.14),.405,verts=28,bevel=.025)
    b.cyl(m['paint2'],(-2.28,0,1.14),(-2.295,0,1.14),.205,verts=20)
    for x in (-1.45,-.50): b.cyl(m['paint2'],(x,0,1.84),(x,0,1.9),.32,verts=20)
    stowage(b,m,-1.45,.5,1.96,(.58,.36,.22))
    stowage(b,m,-1.70,-.49,1.95,(.39,.32,.20))
    for y in(-.64,.64):W.pipe(b,m['metal'],[(-1.8,y,1.87),(-1.8,y,2.12),(-.70,y,2.12),(-.70,y,1.87)],.016)
    b.cyl(m['metal'],(-1.77,-.67,1.8),(-1.82,-.70,2.8),.009,verts=6)
    b.empty('gun_mount',(-1.2,0,1.9)); b.empty('turret_mount',(0,0,1.2))
    return [b.finish(uv_size=1.1),V.mg(m)]


def tank(m):
    m['tracked']=True
    b = Bld('tank_body')
    W.prism(b,m['paint'],[(-3.45,.63),(-3.25,1.45),(1.40,1.45),(3.50,.97),(3.38,.56)],2.76)
    for side in (-1,1):
        yy = side*1.73
        # A real open track loop, with road wheels visible inside it.
        path=[]
        path += [(-2.8+i*5.6/31,1.03,0) for i in range(32)]
        path += [(2.8+.49*math.cos(a),.54+.49*math.sin(a),-a+math.pi/2) for a in [math.pi/2-i*math.pi/11 for i in range(12)]]
        path += [(2.8-i*5.6/31,.05,0) for i in range(32)]
        path += [(-2.8+.49*math.cos(a),.54+.49*math.sin(a),-a+math.pi/2) for a in [-math.pi/2-i*math.pi/11 for i in range(12)]]
        for x,z,a in path:
            b.box(m['metal'],(x,yy,z),(.165,.56,.07),bevel=0,rot=(0,math.degrees(a),0))
            b.box(m['rubber'],(x,yy,z+.017),(.12,.33,.066),bevel=.005,seg=1,rot=(0,math.degrees(a),0))
            b.cyl(m['edge'],(x,yy-side*.285,z),(x,yy+side*.294,z),.023,verts=6)
        for i in range(7): wheel(b,m,-2.55+i*.85,yy,.49,.355,.32)
        for x in (-2.85,2.85): b.cyl(m['paint2'],(x,yy-.15,.55),(x,yy+.15,.55),.35,verts=20)
        for i in range(7):
            x=-2.55+i*.85
            b.box(m['paint2'],(x,side*1.76,1.14),(.78,.43,.24),bevel=.018)
            bolts(b,m,[x-.23,x+.23],side*1.989,1.18)
            panel(b,m,[(x-.37,1.01),(x+.37,1.01),(x+.37,1.26),(x-.37,1.26)],side*1.984)
        b.box(m['light'],(3.31,side*.95,1.04),(.07,.20,.1),bevel=.015)
        W.pipe(b,m['metal'],[(-2.9,side*1.2,1.46),(-1.7,side*1.28,1.48),(.4,side*1.26,1.47)],.035)
        for x in(-2.55,-1.75):b.box(m['panel'],(x,side*.94,1.49),(.67,.56,.10),bevel=.018)
        for x in(-2.55,-1.75):
            for xx in(-.22,.22):b.box(m['metal'],(x+xx,side*.94,1.555),(.03,.5,.018),bevel=.003)
        for x in(2.85,3.20):b.box(m['panel'],(x,side*1.5,1.13),(.33,.56,.055),bevel=.014,rot=(0,14,0))
        W.pipe(b,m['steel'],[(3.33,side*1.09,.81),(3.49,side*1.09,.65),(3.38,side*1.09,.56),(3.26,side*1.09,.68)],.03)
    for side in(-1,1):
        # Separate glacis plates sit on the sloped bow, with panel seams and bolts.
        W.faces(b,m['panel'],[(1.48,side*.05,1.45),(1.48,side*1.28,1.45),(3.35,side*1.28,1.04),(3.35,side*.05,1.04)],[[0,1,2,3]])
        for x in(1.6,2.2,2.8,3.25):
            z=1.46-(x-1.4)*.228
            for y in(.1,1.18):b.cyl(m['metal'],(x,side*y,z),(x+.006,side*y,z+.022),.016,verts=6)
    for i in range(11): b.box(m['slot'],(-3.15+i*.12,0,1.46),(.04,1.62,.012),bevel=0)
    b.empty('cannon_mount',(2.2,0,1.92));b.empty('turret_mount',(0,0,1.5));b.empty('gun_mount',(-.2,.65,2.2))
    t=Bld('tank_turret')
    W.prism(t,m['paint'],[(-2.02,.05),(-2.1,.48),(-1.55,.78),(.60,.82),(2.04,.42),(1.88,.12)],2.2)
    for side in (-1,1):
        W.prism(t,m['paint2'],[(-1.8,.22),(-1.3,.72),(.58,.77),(1.88,.44),(1.82,.18)],.20,side*1.17)
        for i in range(4):
            x=-1.1+i*.67
            panel(t,m,[(x-.31,.26),(x+.31,.26),(x+.31,.66),(x-.31,.69)],side*1.29)
        for x in [-1.35,-.65,.05,.7]: bolts(t,m,[x],side*1.28,.45)
        for i in range(3): t.cyl(m['metal'],(.75,side*1.20,.37+i*.14),(1.0,side*1.37,.42+i*.14),.06,verts=8)
        stowage(t,m,-1.9,side*.65,.85,(.74,.42,.22))
        W.pipe(t,m['metal'],[(-2.29,side*.95,.31),(-2.29,side*.95,.94),(-1.73,side*.95,.94)],.022)
        t.cyl(m['paint2'],(-1.62,side*.78,.77),(-1.62,side*.78,.85),.21,verts=20)
    t.box(m['paint2'],(-2.1,0,.45),(.45,1.8,.55),bevel=.025)
    t.cyl(m['paint2'],(-.3,.6,.82),(-.3,.6,.96),.37,verts=24)
    for k in range(8):
        a=k*math.tau/8
        t.box(m['glass'],(-.3+math.cos(a)*.35,.6+math.sin(a)*.35,.91),(.11,.065,.075),bevel=.005,rot=(0,0,math.degrees(a)+90))
    t.box(m['panel'],(.55,-.52,.81),(.64,.63,.055),bevel=.022)
    W.pipe(t,m['metal'],[(.40,-.52,.86),(.40,-.52,.92),(.71,-.52,.92),(.71,-.52,.86)],.016)
    t.box(m['metal'],(1.86,0,.42),(.30,.82,.47),bevel=.065,seg=3)
    t.box(m['glass'],(.52,-.52,.86),(.20,.16,.12),bevel=.012)
    t.cyl(m['metal'],(-1.66,-.8,.77),(-1.73,-.8,2.4),.01,verts=6)
    c=Bld('cannon');c.cyl(m['gun'],(0,0,0),(4.5,0,0),.104,r2=.082,verts=24)
    c.cyl(m['paint2'],(.0,0,0),(1.70,0,0),.132,verts=20)
    c.cyl(m['paint2'],(1.85,0,0),(2.45,0,0),.16,verts=20)
    for x in (.25,.9,1.55,2.65,3.35,4.25):c.cyl(m['metal'],(x,0,0),(x+.035,0,0),.11,verts=20)
    c.tube(m['steel'],(4.35,0,0),(4.5,0,0),.106,.079,verts=20)
    return [b.finish(uv_size=1.2),t.finish(uv_size=1.2),V.mg(m),c.finish()]


def apc(m):
    b=Bld('apc_body')
    W.shell(b,m['paint'],[(-3.45,1.29,.55,1.91),(-2.85,1.375,.55,2.26),(1.45,1.375,.55,2.26),(3.50,1.20,.54,1.15)])
    for side in(-1,1):
        for i in range(4):
            wheel(b,m,-2.4+i*1.6,side*1.49,.565,.55,.4)
            guard_arch(b,m,-2.4+i*1.6,side*1.48,.565,.55,.42)
        W.prism(b,m['paint2'],[(-3.3,1.47),(-3.1,2.03),(1.52,2.03),(2.72,1.4)],.09,side*1.40)
        for i in range(5):
            x=-2.6+i*.85
            b.box(m['paint'],(x,side*1.47,1.62),(.78,.04,.50),bevel=.016)
            bolts(b,m,[x-.25,x+.25],side*1.50,1.78)
            panel(b,m,[(x-.40,1.39),(x+.40,1.39),(x+.40,2.04),(x-.40,2.04)],side*1.50)
            W.pipe(b,m['metal'],[(x-.16,side*1.54,1.96),(x-.16,side*1.57,2.03),(x+.16,side*1.57,2.03),(x+.16,side*1.54,1.96)],.013)
        b.box(m['light'],(3.46,side*.96,1.2),(.034,.24,.14),bevel=.016)
        W.pipe(b,m['metal'],[(3.51,side*.96,.99),(3.51,side*.96,1.32),(3.2,side*.96,1.44)],.018)
        stowage(b,m,-2.7,side*.7,2.37,(.65,.4,.18))
        W.pipe(b,m['metal'],[(-3.42,side*.93,1.97),(-3.17,side*.93,2.38),(-1.86,side*.93,2.38),(-1.73,side*.93,2.28)],.019)
        b.cyl(m['metal'],(-2.6,side*1.05,2.20),(-2.6,side*1.05,3.65),.009,verts=6)
        for x in(.75,1.10):b.box(m['glass'],(x,side*.65,2.285),(.21,.15,.064),bevel=.009)
        for z in(.76,.96,1.16):W.pipe(b,m['metal'],[(-3.49,side*1.10,z),(-3.56,side*1.10,z),(-3.56,side*.65,z)],.015)
    for x in(-1.5,-.3):
        b.box(m['panel'],(x,0,2.28),(.77,.68,.04),bevel=.015)
        W.pipe(b,m['metal'],[(x-.16,0,2.31),(x-.16,0,2.39),(x+.16,0,2.39),(x+.16,0,2.31)],.016)
    for y in(-.54,.54):
        W.faces(b,m['panel'],[(1.53,y-.4,2.23),(1.53,y+.4,2.23),(3.40,y+.4,1.21),(3.40,y-.4,1.21)],[[0,1,2,3]])
        for x in(1.7,2.3,2.9):
            z=2.25-(x-1.45)*.54
            for yy in(y-.35,y+.35):b.cyl(m['metal'],(x,yy,z),(x+.01,yy,z+.018),.014,verts=6)
    b.box(m['paint2'],(-3.51,0,1.20),(.036,1.5,1.20),bevel=.03)
    for z in(.7,1.65):b.box(m['metal'],(-3.54,0,z),(.025,1.55,.05),bevel=.004)
    for x in(-2.45,-1.5):b.cyl(m['paint2'],(x,0,2.26),(x,0,2.31),.37,verts=20)
    for side in(-1,1):b.box(m['glass'],(1.50,side*.64,2.27),(.40,.22,.075),bevel=.012)
    b.empty('cannon_mount',(1.4,0,2.66));b.empty('turret_mount',(.3,0,2.34));b.empty('gun_mount',(-1,.9,2.5))
    t=Bld('apc_turret');W.prism(t,m['paint'],[(-.95,.03),(-.85,.48),(.30,.65),(.95,.38),(.95,.03)],1.36)
    t.box(m['glass'],(.2,-.57,.58),(.20,.1,.13),bevel=.01)
    t.cyl(m['paint2'],(-.35,.25,.49),(-.35,.25,.59),.22,verts=20)
    for side in(-1,1):
        panel(t,m,[(-.75,.1),(.57,.1),(.66,.42),(-.66,.50)],side*.69)
        for i in range(3):t.cyl(m['metal'],(.3,side*.72,.18+i*.12),(.5,side*.83,.22+i*.12),.039,verts=10)
        t.box(m['metal'],(-.38,side*.41,.54),(.18,.12,.17),bevel=.015)
    c=Bld('cannon');c.cyl(m['gun'],(0,0,0),(2.4,0,0),.055,verts=18)
    c.tube(m['steel'],(2.22,0,0),(2.4,0,0),.075,.045,verts=16)
    return [b.finish(uv_size=1.2),t.finish(uv_size=1.2),V.mg(m),c.finish()]


def quad(m):
    b=Bld('quad_body')
    W.prism(b,m['paint'],[(-1.05,.38),(.95,.38),(1.04,.72),(.35,.90),(-.58,.86),(-1.05,.68)],.64)
    b.box(m['metal'],(-.1,0,.50),(.48,.42,.28),bevel=.03)
    for i in range(7):b.box(m['edge'],(-.10,0,.39+i*.027),(.38,.45,.012),bevel=.003)
    for side in(-1,1):
        for x in(-.70,.65):
            W.prism(b,m['paint2'],[(x-.4,.57),(x-.27,.83),(x+.26,.83),(x+.43,.58)],.28,side*.49)
            wheel(b,m,x,side*.59,.32,.31,.29)
            guard_arch(b,m,x,side*.50,.32,.31,.35)
        W.pipe(b,m['metal'],[(.24,0,.8),(.27,side*.25,1.06),(.22,side*.43,1.05)],.023)
        b.box(m['rubber'],(.22,side*.44,1.05),(.13,.05,.05),bevel=.016)
        b.box(m['light'],(1.045,side*.23,.70),(.023,.19,.1),bevel=.016)
        W.pipe(b,m['metal'],[(-1.03,side*.35,.75),(-1.03,side*.35,.93),(-.58,side*.35,.93)],.015)
        W.pipe(b,m['metal'],[(.58,side*.43,.85),(1.13,side*.43,.85),(1.13,side*.43,.64),(1.0,side*.43,.50)],.018)
        b.cyl(m['metal'],(-.43,side*.27,.51),(-.65,side*.43,.31),.037,verts=12)
        for i in range(7):b.cyl(m['steel'],(-.47-i*.023,side*(.30+i*.016),.47-i*.021),(-.48-i*.023,side*(.30+i*.016),.46-i*.021),.049,verts=10)
        for x in(-.7,.65):b.cyl(m['metal'],(x,side*.08,.35),(x,side*.50,.32),.035,verts=10)
        for x in(-.14,.04):b.box(m['rubber'],(x,side*.35,.46),(.08,.18,.035),bevel=.009)
    b.box(m['seat'],(-.35,0,.91),(.7,.40,.14),bevel=.055)
    stowage(b,m,-.85,0,1.05,(.38,.5,.22))
    for x in(.67,.83,1.0):W.pipe(b,m['metal'],[(x,-.38,.865),(x,.38,.865)],.012)
    b.box(m['glass'],(.25,0,1.025),(.10,.12,.055),bevel=.012,rot=(0,15,0))
    return [b.finish(uv_size=.7)]


def heli(m):
    b=Bld('heli_body')
    W.shell(b,m['paint'],[(-1.7,.44,.95,1.94),(-.9,.54,.74,2.18),(-.4,.63,.69,2.25),(.8,.56,.65,2.07),(1.76,.42,.78,1.42),(2.8,.26,.90,1.26)])
    for xa,za,wa,xb,zb,wb in [(-.63,2.23,.44,.35,2.155,.46),(.73,2.12,.44,1.70,1.49,.32)]:
        for side in(-1,1):
            verts=[(xa,side*.018,za),(xa,side*wa,za),(xb,side*wb,zb),(xb,side*.018,zb)]
            W.faces(b,m['glass'],verts,[[0,1,2,3]])
            W.pipe(b,m['metal'],verts+[verts[0]],.018)
    # Two faceted canopy stations, framed and separate from the fuselage.
    for side in(-1,1):
        yy=side*.553
        for pts in [[(-.70,1.35),(-.65,2.14),(.35,1.98),(.37,1.31)],[(.49,1.3),(.48,1.96),(1.76,1.39),(1.76,1.07)]]:
            W.prism(b,m['glass'],pts,.018,yy)
            for p,q in zip(pts,pts[1:]+pts[:1]):W.pipe(b,m['metal'],[(p[0],yy+side*.018,p[1]),(q[0],yy+side*.018,q[1])],.019)
        for x in(-.9,-.3,.3,1.0,1.7,2.3):
            z=.87 if x<1.5 else .98
            panel(b,m,[(x-.21,z),(x+.21,z),(x+.21,z+.27),(x-.21,z+.27)],side*(.54 if x<1.5 else .30))
        b.box(m['metal'],(2.52,side*.15,1.175),(.20,.11,.12),bevel=.024)
        b.cyl(m['glass'],(2.65,side*.15,1.175),(2.675,side*.15,1.175),.043,verts=16)
        b.box(m['metal'],(-.18,side*.72,1.51),(.15,.025,.037),bevel=.006)
        b.cyl(m['paint2'],(-1.10,side*.63,2.08),(.65,side*.63,2.08),.285,verts=20)
        b.cyl(m['slot'],(-1.115,side*.63,2.08),(-1.145,side*.63,2.08),.22,verts=16)
        for x in[-.9,-.7,-.5]:b.box(m['slot'],(x,side*.90,2.09),(.08,.014,.18),bevel=.006)
        for x in(-.8,-.4,0,.4):
            for z in(1.94,2.23):b.cyl(m['metal'],(x,side*.90,z),(x,side*.925,z),.011,verts=6)
        b.cyl(m['metal'],(-1.22,side*.63,2.08),(-1.67,side*.63,2.09),.19,verts=24)
        b.tube(m['steel'],(-1.66,side*.63,2.09),(-1.74,side*.63,2.09),.20,.155,verts=24)
        W.prism(b,m['paint2'],[(-.50,1.14),(.95,1.14),(.67,1.32),(-.48,1.32)],1.18,side*.85)
        b.cyl(m['metal'],(-.20,side*1.39,1.04),(.9,side*1.39,1.04),.20,verts=18)
        for a in range(7):
            angle=a*math.tau/7
            y,z=side*1.39+.12*math.cos(angle),1.04+.12*math.sin(angle)
            b.cyl(m['slot'],(.904,y,z),(.925,y,z),.045,verts=8)
        W.pipe(b,m['metal'],[(-1.4,side*.86,.10),(-.8,side*.92,.03),(.95,side*.92,.03),(1.3,side*.91,.18)],.048,10)
        for x in(-.65,.65):W.pipe(b,m['metal'],[(x,side*.9,.05),(x-.12,side*.48,.77)],.045,10)
    b.cyl(m['paint'],(-1.5,0,1.5),(-6.5,0,1.96),.31,r2=.12,verts=16)
    for x in(-2,-3,-4,-5):
        radius=.31-(abs(x)-1.5)*.038
        b.cyl(m['panel'],(x,0,1.5+(abs(x)-1.5)*.092),(x-.035,0,1.5+(abs(x)-1.5)*.092),radius+.008,verts=16)
    W.prism(b,m['paint2'],[(-6.7,1.95),(-6.62,3.0),(-6.12,2.72),(-5.93,1.98)],.08)
    b.box(m['paint2'],(-5.5,0,1.99),(.7,1.45,.055),bevel=.014)
    b.cyl(m['metal'],(-6.48,-.06,2.47),(-6.48,.14,2.47),.1,verts=12)
    for i in range(4):b.box(m['metal'],(-6.48,.16,2.47),(.075,.025,1.03),bevel=.003,rot=(0,i*90,0))
    b.cyl(m['paint2'],(0,0,2.20),(0,0,2.72),.2,verts=16)
    b.cyl(m['metal'],(0,0,2.65),(0,0,3.05),.08,verts=14)
    for side in(-1,1):W.pipe(b,m['metal'],[(0,side*.26,2.21),(.10,side*.32,2.68),(.04,side*.15,2.87)],.025)
    b.empty('rotor_mount',(0,0,3.05));b.empty('gun_mount',(2.4,0,.95));b.empty('turret_mount',(0,0,0))
    r=Bld('heli_rotor');r.cyl(m['metal'],(0,0,0),(0,0,.16),.19,verts=18)
    for i in range(4):
        a=i*math.pi/2
        r.box(m['metal'],(math.cos(a)*3.5,math.sin(a)*3.5,.035),(6.8,.18,.025),bevel=.004,rot=(0,0,i*90))
        r.box(m['edge'],(math.cos(a)*6.7,math.sin(a)*6.7,.037),(.13,.18,.03),bevel=0,rot=(0,0,i*90))
        r.cyl(m['metal'],(math.cos(a)*.12,math.sin(a)*.12,.10),(math.cos(a)*.47,math.sin(a)*.47,.04),.036,verts=12)
    g=Bld('heli_gun');g.cyl(m['metal'],(0,0,.15),(0,0,-.12),.12,verts=14)
    for a in range(6):
        angle=a*math.tau/6
        yy,zz=.06*math.cos(angle),-.12+.06*math.sin(angle)
        g.cyl(m['gun'],(0,yy,zz),(.82,yy,zz),.016,verts=8)
    g.cyl(m['metal'],(.56,0,-.12),(.62,0,-.12),.092,verts=14)
    return [b.finish(uv_size=1.1),r.finish(),g.finish()]


def boat(m):
    b=Bld('boat_body')
    b.loft(m['paint2'],[((-3.7,0,.46),2.35,.80,.12),((-2.8,0,.47),2.75,.82,.15),((1.3,0,.55),2.7,.88,.14),((3.2,0,.67),1.35,.80,.09),((4,0,.73),.13,.64,.025)])
    b.loft(m['paint'],[((-3.6,0,.98),2.1,.08,.02),((1.25,0,1.04),2.2,.08,.02),((3.3,0,1.09),.8,.06,.02)])
    for side in(-1,1):
        W.pipe(b,m['rubber'],[(-3.6,side*1.25,.98),(-2.5,side*1.39,.98),(1.4,side*1.35,1.05),(3.2,side*.74,1.09),(3.8,side*.15,1.10)],.17,12)
        W.pipe(b,m['metal'],[(-3.4,side*1.10,1.12),(-3.4,side*1.10,1.30),(1.8,side*1.10,1.30),(2.6,side*.8,1.23)],.025)
        for x in(-2.6,-1.75):
            b.box(m['seat'],(x,side*.48,1.18),(.5,.48,.15),bevel=.055)
            b.box(m['seat'],(x-.17,side*.48,1.45),(.1,.48,.5),bevel=.035)
        W.pipe(b,m['metal'],[(-2.85,side*.85,1.06),(-2.52,side*.85,2.45),(-1.4,side*.85,2.45),(-1.2,side*.85,1.06)],.045)
        b.box(m['metal'],(-3.84,side*.57,.68),(.37,.46,.61),bevel=.07)
        b.box(m['paint2'],(-3.87,side*.57,1.03),(.43,.51,.37),bevel=.10,seg=3)
        grille(b,m,-3.84,side*.826,1.02,.26,.13,False)
        b.cyl(m['metal'],(-3.88,side*.57,.48),(-3.88,side*.57,-.03),.06,verts=10)
        b.cyl(m['steel'],(-3.92,side*.57,.12),(-3.97,side*.57,.12),.06,verts=12)
        for i in range(3):b.box(m['metal'],(-3.98,side*.57,.12),(.018,.29,.057),bevel=.009,rot=(i*120,0,0))
        for x in(-2.8,-1.8,-.8,.2,1.2):
            b.tube(m['edge'],(x-.025,side*1.385,.98),(x+.025,side*1.385,.98),.184,.172,verts=16)
            b.box(m['rubber'],(x,side*1.41,1.17),(.12,.10,.06),bevel=.02)
        stowage(b,m,-.8,side*.66,1.20,(.46,.36,.22))
    W.pipe(b,m['metal'],[(-2.52,-.85,2.45),(-2.52,.85,2.45)],.045)
    W.prism(b,m['paint'],[(-.5,1.04),(.3,1.04),(.24,1.64),(-.39,1.70)],1.10)
    b.box(m['glass'],(-.36,0,1.86),(.02,1.02,.4),bevel=.012,rot=(0,-10,0))
    for side in(-1,1):W.pipe(b,m['metal'],[(-.41,side*.54,1.63),(-.45,side*.54,2.09),(-.45,0,2.09)],.016)
    b.box(m['seat'],(-.40,0,1.70),(.04,.26,.15),bevel=.017)
    b.box(m['glass'],(-.375,0,1.71),(.018,.20,.10),bevel=.007)
    for y in(-.28,.28):b.cyl(m['metal'],(-.36,y,1.70),(-.33,y,1.73),.024,verts=12)
    b.box(m['paint2'],(2.4,0,1.12),(.45,.5,.06),bevel=.014)
    b.empty('gun_mount',(2.4,0,1.15));b.empty('turret_mount',(0,0,1.1))
    return [b.finish(uv_size=1.1),V.mg(m)]

V.materials=materials
V.mg=mounted_hmg
V.BUILD.update(jeep=jeep,tank=tank,apc=apc,quad=quad,heli=heli,boat=boat)
V.want=['jeep','tank','apc','quad','heli','boat']
V.prev=False
original_export=V.export

def export(path, objects):
    # Bake the actual assembled vehicle, including contact under rails, plate
    # edges, wheels and storage. glTF retains this per-vertex occlusion.
    body=lib.bpy.data.objects.get('body');gun=lib.bpy.data.objects.get('gun')
    mount=next((o for o in body.children if o.name=='gun_mount'),None) if body else None
    if gun and mount:gun.location=mount.location.copy()
    lib.bpy.context.view_layer.update()
    meshes=[o for o in objects if o.type=='MESH']
    if not lib.bake_ao(meshes,samples=12):raise RuntimeError('Vehicle contact bake failed')
    for obj in meshes:
        for vertex in obj.data.color_attributes['AO'].data:
            color=vertex.color
            v=.56+.44*max(0,min(1,(color[0]+color[1]+color[2])/3))
            vertex.color=(v,v,v,1)
    surfaces.bake(meshes,os.path.basename(path).replace('.glb',''))
    original_export(path, objects)
    W.reference_and_save('vehicles',os.path.basename(path).replace('.glb',''))
V.export=export
V.main()
