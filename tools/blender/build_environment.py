"""Build and preview cover/vegetation through the running Blender MCP connection."""
import importlib
import os
import runpy
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lib
importlib.reload(lib)
lib.PREVIEW = os.path.join(lib.ROOT, 'output', 'qa')
runpy.run_path(os.path.join(HERE, 'build_generated_surfaces.py'), run_name='__main__')
runpy.run_path(os.path.join(HERE, 'build_architecture.py'), run_name='__main__')
sys.argv = ['build_props.py', '--preview']
runpy.run_path(os.path.join(HERE, 'build_props.py'), run_name='__main__')
lib.bpy.ops.file.pack_all()
from mathutils import Quaternion, Vector
for screen in lib.bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.shading.type = 'MATERIAL'
            region = area.spaces.active.region_3d
            region.view_location = Vector((4.5, 0, 4))
            region.view_distance = 20
            region.view_rotation = Quaternion((0.9239, 0.3827, 0, 0)).normalized()
lib.bpy.ops.wm.save_as_mainfile(filepath=os.path.join(lib.ROOT, 'output', 'environment.blend'))
