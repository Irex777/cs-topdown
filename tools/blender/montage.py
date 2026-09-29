"""contact sheet of baked textures for eyeballing:  python3 tools/blender/montage.py out.png name:c name:n ...   (each tile shown 1x, tiled 2x2 with --tile)"""
import os, sys
import bpy
import numpy as np
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'client', 'assets', 'tex')
out = sys.argv[1]; names = [a for a in sys.argv[2:] if not a.startswith('--')]; tile = '--tile' in sys.argv
S = 256
tiles = []
for n in names:
    nm, k = n.split(':')
    img = bpy.data.images.load(os.path.join(D, f'{nm}_{k}.jpg'))
    w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    if tile: a = np.tile(a, (2, 2, 1)); w, h = w * 2, h * 2
    st = max(1, w // S)
    tiles.append(a[::st, ::st][:S * (2 if tile else 1), :S * (2 if tile else 1)])
Wt = tiles[0].shape[1]; Ht = tiles[0].shape[0]
cols = 4; rows = (len(tiles) + cols - 1) // cols
sheet = np.ones((rows * Ht, cols * Wt, 4), dtype=np.float32)
for i, t in enumerate(tiles):
    r, c = divmod(i, cols); sheet[r * Ht:(r + 1) * Ht, c * Wt:(c + 1) * Wt] = t
im = bpy.data.images.new('sheet', cols * Wt, rows * Ht)
im.pixels = sheet.ravel().tolist()
im.filepath_raw = out; im.file_format = 'PNG'; im.save()
