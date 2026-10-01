"""Recreate architecture-v2.png as destructible storey modules and roof details."""
import os
import sys
import importlib
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import lib
importlib.reload(lib)
from lib import *
import world_v2_lib as W
importlib.reload(W)
reset()
brick=image_mat('facade_brick','tex/brick-generated.jpg',srgb('#c4b6a5'),rough=.96)
plaster=image_mat('facade_plaster','tex/plaster-v2.jpg',rough=.98)
stone=image_mat('facade_stone','tex/concrete-generated.jpg',srgb('#a6a59b'),rough=.97)
wood=image_mat('facade_timber','tex/wood_c.jpg',srgb('#929783'),rough=.93)
metal=mat('facade_gutter',srgb('#4a514e'),metal=.15,rough=.78)
glass=mat('facade_glass',srgb('#5d7b82'),metal=0.0,rough=.08,alpha=.22)      # see-through: the wall tile is open behind it
recess=mat('facade_recess',srgb('#26332e'),rough=1)
roof=image_mat('roof_slate','tex/roof-v2.jpg',rough=.92)
objects=[]


def place(node):
    objects.append(node)
    node.location.x=(len(objects)-1)*3.4


def bands(b):
    for side in(-1,1):
        b.box(stone,(0,side*1.013,.19),(2.0,.032,.38),bevel=.008)
        b.box(stone,(side*1.013,0,.19),(.032,2.0,.38),bevel=.008)
        b.box(stone,(0,side*1.013,3.18),(2.0,.025,.14),bevel=.004)
        b.box(stone,(side*1.013,0,3.18),(.025,2.0,.14),bevel=.004)

for family, material in [('brick',brick),('plaster',plaster),('stone',stone)]:
    b=Builder('wall_'+family)
    b.box(material,(0,0,1.625),(2,2,3.25),bevel=.003)
    bands(b)
    # Chipped exposed-brick patches, with several individually raised courses.
    if family=='plaster':
        for side in(-1,1):
            for row in range(3):
                for col in range(2+(row%2)):
                    b.box(brick,(-.89+col*.24+(row%2)*.08,side*1.017,.50+row*.115),(.215,.018,.09),bevel=.004)
    place(b.finish(uv_size=.9))

    b=Builder('window_'+family)
    for x in(-.84,.84):b.box(material,(x,0,1.625),(.32,2,3.25),bevel=.004)
    b.box(material,(0,0,.445),(1.36,2,.89),bevel=.004)
    b.box(material,(0,0,2.90),(1.36,2,.70),bevel=.004)
    bands(b)
    for side in(-1,1):
        y=side*1.02
        b.box(stone,(0,y,.91),(1.53,.19,.13),bevel=.015)
        b.box(stone,(0,y,2.58),(1.56,.12,.16),bevel=.012)
        for x in(-.68,.68):b.box(stone,(x,y,1.75),(.09,.10,1.69),bevel=.006)
        for x in(-.61,.61):b.box(wood,(x,side*.945,1.745),(.075,.10,1.58),bevel=.006)
        for z in(.98,2.5):b.box(wood,(0,side*.946,z),(1.25,.10,.075),bevel=.006)
        b.box(glass,(0,side*.862,1.745),(1.15,.012,1.46),bevel=0)
        for x in(-.30,0,.30):b.box(wood,(x,side*.908,1.745),(.026,.035,1.46),bevel=.003)
        b.box(wood,(0,side*.911,1.75),(1.16,.035,.031),bevel=.003)
        if family=='plaster':
            for x in(-.865,.865):
                b.box(wood,(x,side*1.027,1.75),(.235,.040,1.58),bevel=.01)
                for z in(1.03,2.45):b.box(metal,(x,side*1.055,z),(.20,.014,.025),bevel=.002)
    place(b.finish(uv_size=.9))

b=Builder('doorway')
for side in(-1,1):
    for x in(-1.023,1.023):b.box(stone,(x,side*.98,1.23),(.065,.19,2.46),bevel=.01)
    b.box(stone,(0,side*.98,2.59),(2.10,.22,.18),bevel=.01)
    for x in(-1.046,1.046):b.box(wood,(x,side*.925,1.24),(.03,.055,2.40),bevel=.004)
place(b.finish(uv_size=.9))

b=Builder('corner')
for row in range(10):
    z=.15+row*.315
    b.box(stone,(.05,0,z),(.34 if row%2 else .47,.12,.28),bevel=.012)
    b.box(stone,(0,.05,z),(.12,.47 if row%2 else .34,.28),bevel=.012)
place(b.finish(uv_size=.6))

b=Builder('chimney')
b.box(brick,(0,0,.50),(.66,.62,1.0),bevel=.01)
for z in(.14,.8):b.box(stone,(0,0,z),(.74,.7,.12),bevel=.008)
b.box(stone,(0,0,1.02),(.79,.76,.12),bevel=.013)
for x in(-.17,.17):
    b.cyl(brick,(x,0,1.04),(x,0,1.30),.094,verts=16)
    b.cyl(recess,(x,0,1.302),(x,0,1.307),.068,verts=16)
place(b.finish(uv_size=.7))

# A one-metre eaves segment: timber rafter tail and actual half-round gutter.
b=Builder('eaves')
b.box(wood,(0,0,-.075),(1,.08,.15),bevel=.005)
for x in(-.32,.32):b.box(wood,(x,.11,-.12),(.055,.32,.11),bevel=.005)
b.cyl(metal,(-.5,-.10,-.07),(.5,-.10,-.07),.05,verts=12)
place(b.finish(uv_size=.6))

b=Builder('downpipe')
W.pipe(b,metal,[(0,-.10,3.15),(0,-.10,2.98),(0,0,2.85),(0,0,.12),(0,-.10,.04)],.032,10)
for z in(.5,2.4):b.box(metal,(0,.02,z),(.09,.03,.05),bevel=.004)
place(b.finish(uv_size=.7))

# Physical roof tile lip / ridge cap modules complement the generated slate material.
b=Builder('ridge_cap')
W.prism(b,roof,[(-.15,0),(0,.075),(.15,0),(.15,-.025),(0,.05),(-.15,-.025)],1)
place(b.finish(uv_size=1))

# Compatibility name for existing callers; new rendering selects a facade family.
base=next(o for o in objects if o.name=='window_brick')
copy=base.copy();copy.data=base.data.copy();copy.name='window';bpy.context.scene.collection.objects.link(copy);place(copy)
export(os.path.join(OUT,'architecture.glb'),objects)
W.reference_and_save('architecture','modular-buildings')
