"""Rebuild open rifle sights and a dedicated Stinger through Blender MCP."""
import os
import sys
import runpy
base = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, base)
import importlib
import lib
import guns
importlib.reload(lib)
importlib.reload(guns)
sys.argv = ['build_weapons.py', 'ar7', 'br12', 'dmr14', 'vx9', 'sg4', 'mg60', 'p18', 'stinger']
runpy.run_path(os.path.join(base, 'build_weapons.py'), run_name='__main__')
sys.argv = ['build_attachments.py']
runpy.run_path(os.path.join(base, 'build_attachments.py'), run_name='__main__')
