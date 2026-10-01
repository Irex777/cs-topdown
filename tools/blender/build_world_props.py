"""Recreate props-v2.png: filled sacks, plank crates, ribbed drums and steel cargo."""
import os
import sys
import math
import random
import importlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib
importlib.reload(lib)
from lib import *
import world_v2_lib as W
importlib.reload(W)
reset()
wood = image_mat('crate_wood', 'tex/wood_c.jpg', srgb('#c6c1ac'), rough=.93)
wood2 = image_mat('crate_wood_dark', 'tex/wood_c.jpg', srgb('#a9a994'), rough=.96)
steel = mat('prop_steel', srgb('#72776e'), metal=.35, rough=.72)
dark = mat('prop_recess', srgb('#252b24'), rough=.94)
fabric = image_mat('bag_fabric', 'tex/burlap-v2.jpg', rough=1)
seam = mat('bag_seam', srgb('#6c7050'), rough=1)
paint = image_mat('drum_paint', 'skins/field-metal-runtime.jpg', srgb('#9da58c'), metal=.10, rough=.85)
rust = mat('prop_rust', srgb('#74604c'), rough=.98)
container = image_mat('container_paint', 'skins/field-metal-runtime.jpg', rough=.82, metal=.08)
concrete = image_mat('barrier_concrete', 'tex/concrete-generated.jpg', srgb('#b4b2a9'), rough=.97)
objects=[]

def place(node, x):
    node.location=(x,0,0)
    objects.append(node)

# Individual boards, metal corners and real lifting handles.
b=Builder('crate')
for side in(-1,1):
    for layer in range(5):
        z=.145+layer*.238
        b.box(wood if layer%2 else wood2,(0,side*.856,z),(1.64,.055,.226),bevel=.004)
        b.box(wood if layer%2 else wood2,(side*.856,0,z),(.055,1.64,.226),bevel=.004)
    for x in(-.78,.78):
        b.box(wood2,(x,side*.893,.62),(.105,.055,1.20),bevel=.006)
        for z in(.08,1.17):
            b.box(steel,(x,side*.925,z),(.125,.014,.13),bevel=.004)
            b.cyl(steel,(x,side*.92,z),(x,side*.943,z),.016,verts=6)
    for y in(-.78,.78):b.box(wood2,(side*.894,y,.62),(.055,.10,1.2),bevel=.006)
    W.pipe(b,steel,[(-.12,side*.924,.75),(-.12,side*.965,.66),(.12,side*.965,.66),(.12,side*.924,.75)],.015)
    b.box(steel,(0,side*.91,.79),(.30,.018,.15),bevel=.008)
for i in range(7):b.box(wood if i%2 else wood2,(-.72+i*.24,0,1.212),(.228,1.74,.075),bevel=.003)
b.box(dark,(0,0,.6),(1.6,1.6,1.1),bevel=.008)
place(b.finish(uv_size=.8),0)

# Round drums with real ribs, recessed lids and restrained wear.
b=Builder('barrels')
for k,(x,y) in enumerate([(-.36,-.36),(.36,-.36),(-.36,.36),(.36,.36)]):
    b.cyl(paint,(x,y,.02),(x,y,1.08),.32,verts=28,bevel=.012)
    for z in(.035,.35,.72,1.06):
        b.cyl(steel if z in(.035,1.06) else paint,(x,y,z-.015),(x,y,z+.015),.337,verts=28)
    b.cyl(paint,(x,y,1.065),(x,y,1.074),.296,verts=28)
    b.cyl(steel,(x+.13,y-.1,1.075),(x+.13,y-.1,1.093),.03,verts=12)
    b.cyl(dark,(x+.13,y-.1,1.09),(x+.13,y-.1,1.098),.017,verts=10)
    for i in range(10):
        a=i*2.399+k
        xx,yy=x+math.cos(a)*.321,y+math.sin(a)*.321
        b.box(rust,(xx,yy,.13+(i%5)*.16),(.018,.008,.027+(i%3)*.014),bevel=0,rot=(0,0,math.degrees(a)-90))
place(b.finish(uv_size=.65),3)

# Superellipsoid sacks: bulging middles, soft corners, stitched side seams, tied ends.
rng=random.Random(71)
b=Builder('sandbags')
for layer in range(3):
    for row in range(3):
        for col in range(4):
            x=-.73+col*.49+(layer%2-.5)*.035+rng.uniform(-.012,.012)
            y=-.57+row*.57+rng.uniform(-.015,.015)
            z=.142+layer*.278
            angle=rng.uniform(-.08,.08)
            W.pillow(b,fabric,(x,y,z),(.50,.565,.29),angle,col+row*3+layer*7)
            for side in(-1,1):
                points=[]
                for i in range(5):
                    a=-math.pi/2+i*math.pi/4
                    points.append((x+math.sin(a)*.235,y+side*.282*math.cos(a)**.3,z-.014))
                W.pipe(b,seam,points,.0035,3)
            b.cyl(fabric,(x+.23,y,z),(x+.265,y,z),.031,r2=.017,verts=7)
            b.cyl(seam,(x+.245,y-.016,z),(x+.245,y+.016,z),.007,verts=5)
place(b.finish(uv_size=.24,smooth_angle=65),6)

# A 2 m segment tiles into existing container footprints; actual doors and hardware.
b=Builder('container')
b.box(container,(0,0,1.31),(1.93,1.93,2.62),bevel=.02)
for side in(-1,1):
    for i in range(13):b.box(container,(-.9+i*.15,side*.984,1.31),(.035,.039,2.38),bevel=.007,seg=1)
    for z in(.065,2.55):b.box(steel,(0,side*.99,z),(2.0,.045,.10),bevel=.008)
    for x in(-.94,.94):b.box(steel,(x,side*.98,1.31),(.095,.07,2.59),bevel=.009)
    # Locking bars are fitted to both end panels of the modular segment.
    for x in(-.49,.49):
        b.box(container,(side*.985,x,1.31),(.04,.92,2.37),bevel=.014)
        for y in(x-.24,x+.24):
            b.cyl(steel,(side*1.02,y,.19),(side*1.02,y,2.4),.012,verts=8)
            for z in(.3,1.16,2.3):b.box(steel,(side*1.029,y,z),(.03,.11,.045),bevel=.006)
        b.box(steel,(side*1.044,x,1.17),(.03,.27,.03),bevel=.006)
place(b.finish(uv_size=.8),9)

b=Builder('barrier')
W.prism(b,concrete,[(-1,0),(1,0),(1,.17),(.76,.48),(.73,.875),(-.73,.875),(-.76,.48),(-1,.17)],.74)
for x in(-.62,.62):
    b.cyl(steel,(x,-.10,.86),(x,-.10,.94),.012,verts=6)
    b.cyl(steel,(x,.10,.86),(x,.10,.94),.012,verts=6)
    b.cyl(steel,(x,-.10,.94),(x,.10,.94),.012,verts=6)
place(b.finish(uv_size=1),12)

b=Builder('rubble')
for i in range(9):
    a=i*2.399
    x,y=math.cos(a)*(.2+i*.025),math.sin(a)*(.2+i*.025)
    b.sphere(concrete,(x,y,.07+(i%2)*.025),.13+(i%3)*.025,seg=7,squash=(1.3,.9,.65))
for i in range(3):b.box(wood2,(i*.16-.18,.1-i*.12,.07),(.7,.08,.04),bevel=.005,rot=(3,8,i*33))
place(b.finish(uv_size=.8),15)

# Preserve the photo-cutout oak geometry, which already has physical bark/leaf cards.
source=os.path.join(OUT,'foliage','oak-source.glb')
before=set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=source)
imported=set(bpy.data.objects)-before
tree=next(o for o in imported if o.name=='tree')
keep={tree,*tree.children_recursive}
for node in imported-keep:bpy.data.objects.remove(node,do_unlink=True)
tree.parent=None
tree.location=(18,0,0)
objects.append(tree)
export(os.path.join(OUT,'props.glb'),objects+[child for node in objects for child in node.children_recursive])
W.reference_and_save('props','battlefield-props')
