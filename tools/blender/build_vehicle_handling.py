"""Export independently animated wheels through the running Blender MCP."""
import os
import sys
import runpy
HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = ['build_vehicles.py', 'tank', 'jeep', 'apc', 'quad']
runpy.run_path(os.path.join(HERE, 'build_vehicles.py'), run_name='__main__')
