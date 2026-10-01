"""Build the generated-skin graphics pass inside Blender, including via MCP."""
import importlib
import os
import runpy
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lib
import guns

importlib.reload(lib)
importlib.reload(guns)

for script in ('build_generated_surfaces.py', 'build_weapons.py', 'build_attachments.py', 'build_characters.py', 'build_air_defense.py', 'build_world_v2.py'):
    sys.argv = [script] + (['--save-blend'] if script == 'build_characters.py' else [])
    runpy.run_path(os.path.join(HERE, script), run_name='__main__')
    print('FRONTLINE BUILD COMPLETE:', script)

# A useful material viewport for reviewing the final soldier in the open app.
from mathutils import Quaternion, Vector
for screen in lib.bpy.data.screens:
    for area in screen.areas:
        if area.type == 'VIEW_3D':
            area.spaces.active.shading.type = 'MATERIAL'
            region = area.spaces.active.region_3d
            region.view_location = Vector((0.1, 0, 0.9))
            region.view_distance = 3.4
            region.view_rotation = Quaternion((0.711, 0.441, 0.287, 0.466)).normalized()
# The individual builders save their packed editable sources. Keep the final
# modular-building scene under its own name rather than overwriting the soldier.
