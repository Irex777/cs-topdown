"""Builds the weapon models and writes src/client/assets/weapons/*.glb.   python3 tools/blender/build_weapons.py [name ...] [--preview]"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *  # noqa: E402,F401,F403
import guns  # noqa: E402

BUILDERS = guns.BUILDERS
args = [a for a in sys.argv[1:] if not a.startswith('--')]
want = args or list(BUILDERS)
prev = '--preview' in sys.argv

for name in want:
    reset()
    root = BUILDERS[name](guns.M())
    if prev:
        for o in root.children_recursive:
            if o.name in ('mag_ext', 'mag_drum'):
                o.hide_render = True
        preview(name + '_side', (0.13, -1.7, 0.02), (0.13, 0, -0.03), lens=62)
        preview(name + '_persp', (0.95, -1.15, 0.5), (0.1, 0, -0.03), lens=55)
        for o in root.children_recursive:
            o.hide_render = False
        # remove render-only objects before export
        for o in [o for o in bpy.data.objects if o.type in ('CAMERA', 'LIGHT')]:
            bpy.data.objects.remove(o)
    kids = [root] + list(root.children_recursive)
    export(os.path.join(OUT, 'weapons', name + '.glb'), kids)
