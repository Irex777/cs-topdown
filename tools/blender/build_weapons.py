"""Builds the weapon models and writes src/client/assets/weapons/*.glb.   python3 tools/blender/build_weapons.py [name ...] [--preview]"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *  # noqa: E402,F401,F403
import guns  # noqa: E402

BUILDERS = {'ar7': guns.build_ar7}
args = [a for a in sys.argv[1:] if not a.startswith('--')]
want = args or list(BUILDERS)
prev = '--preview' in sys.argv

for name in want:
    reset()
    root = guns.build_weapon(name) if hasattr(guns, 'build_weapon') else BUILDERS[name](guns.M())
    if prev:
        preview(name + '_side', (0.13, -0.95, 0.03), (0.12, 0, -0.03), lens=70)
        preview(name + '_persp', (0.55, -0.55, 0.28), (0.12, 0, -0.03), lens=60)
        # remove render-only objects before export
        for o in [o for o in bpy.data.objects if o.type in ('CAMERA', 'LIGHT')]:
            bpy.data.objects.remove(o)
    kids = [root] + list(root.children_recursive)
    export(os.path.join(OUT, 'weapons', name + '.glb'), kids)
