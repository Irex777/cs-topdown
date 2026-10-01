"""Export open, separately hideable HMG shields through the running Blender MCP."""
import os
import sys
import runpy
import importlib
base = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, base)
import lib
importlib.reload(lib)
sys.argv = ['build_vehicles.py', 'jeep', 'tank', 'apc', 'boat']
runpy.run_path(os.path.join(base, 'build_vehicles.py'), run_name='__main__')
