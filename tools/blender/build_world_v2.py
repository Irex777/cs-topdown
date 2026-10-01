"""Recreate the checked-in 2D references through Blender MCP or Blender CLI."""
import os
import runpy
import sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
for script in ('build_world_materials.py', 'build_vehicle_forms.py', 'build_world_props.py', 'build_world_architecture.py'):
    sys.argv = [script]
    runpy.run_path(os.path.join(HERE, script), run_name='__main__')
    print('WORLD V2 BUILD COMPLETE:', script)
