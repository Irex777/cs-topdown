"""Real window surrounds and roof details for the tiled building envelopes."""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *

reset()
brick = image_mat('building_brick', 'tex/brick-generated.jpg', rough=0.9)
stone = image_mat('building_stone', 'tex/concrete-generated.jpg', rough=0.9)
trim = mat('window_trim', srgb('#746d60'), rough=0.8)
glass = mat('window_glass', srgb('#51636b'), rough=0.14, alpha=0.48)
objs = []
B = Builder('window')
for side in (-1, 1):
    B.box(brick, (side * 0.93, 0, 1.625), (0.14, 2, 3.25), bevel=0.01)
B.box(brick, (0, 0, 0.4), (1.72, 2, 0.8), bevel=0.01)
B.box(brick, (0, 0, 3.0), (1.72, 2, 0.5), bevel=0.01)
for side in (-1, 1):
    y = side * 0.99
    B.box(stone, (0, y, 0.83), (1.88, 0.13, 0.12), bevel=0.015)
    B.box(stone, (0, y, 2.77), (1.9, 0.09, 0.13), bevel=0.015)
    for x in (-0.8, 0, 0.8):
        B.box(trim, (x, y, 1.78), (0.05, 0.06, 1.88), bevel=0.005)
    for z in (0.88, 1.78, 2.70):
        B.box(trim, (0, y, z), (1.65, 0.06, 0.05), bevel=0.005)
    B.box(glass, (0, y, 1.78), (1.58, 0.014, 1.78), bevel=0)
objs.append(B.finish(uv_size=2.0))
B = Builder('chimney')
B.box(brick, (0, 0, 0.55), (0.6, 0.65, 1.1), bevel=0.025)
B.box(stone, (0, 0, 1.13), (0.72, 0.76, 0.12), bevel=0.015)
B.box(mat('chimney_dark', srgb('#2b2925'), rough=1), (0, 0, 1.198), (0.43, 0.46, 0.01), bevel=0)
obj = B.finish(uv_size=2.0)
obj.location.x = 3
objs.append(obj)
export(os.path.join(OUT, 'architecture.glb'), objs)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'output', 'architecture.blend'))
