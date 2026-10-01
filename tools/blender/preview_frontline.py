"""Render the current generated soldier with its runtime AR-7 for art review."""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib
from mathutils import Vector

bpy = lib.bpy
existing = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=os.path.join(lib.OUT, 'weapons', 'ar7.glb'))
added = set(bpy.data.objects) - existing
for obj in added:
    if obj.name.startswith(('mag_ext', 'mag_drum')):
        obj.hide_render = True
bpy.context.view_layer.update()
grip = next(o for o in added if o.name.startswith('grip_r'))
delta = Vector((0.344, -0.09, 1.235)) - grip.matrix_world.translation
for obj in added:
    if obj.parent is None:
        obj.location += delta
lib.PREVIEW = os.path.join(lib.ROOT, 'output', 'qa')
lib.preview('soldier-model', (3.6, -2.6, 1.65), (0.12, 0, 0.89), w=720, h=960, lens=65, samples=12)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(lib.ROOT, 'output', 'soldier.blend'))
