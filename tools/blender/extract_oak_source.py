"""Keep the established generated oak as an independent, rebuildable source."""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
reset()
bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, 'props.glb'))
tree = bpy.data.objects.get('tree')
assert tree is not None
tree.parent = None
tree.location = (0, 0, 0)
export(os.path.join(OUT, 'foliage', 'oak-source.glb'), [tree, *tree.children_recursive])
