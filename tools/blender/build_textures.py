"""Tileable PBR texture set baked in Blender (Cycles) -> src/client/assets/tex/<name>_{c,n,r}.jpg  (albedo, tangent normal, roughness).
Every pattern is procedural and seamless: noise is sampled on a 4D torus so the edges match.
    python3 tools/blender/build_textures.py [name ...] [--size=512]"""
import math
import os
import sys

import bpy

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'src', 'client', 'assets', 'tex')
os.makedirs(OUT, exist_ok=True)
TAU = math.tau


def lin(hexstr):
    h = hexstr.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple((v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c) + (1.0,)


class G:
    """tiny node-graph helper"""

    def __init__(self, nt):
        self.nt = nt
        self.n = nt.nodes
        self.uv = self.n.new('ShaderNodeTexCoord').outputs['UV']
        sep = self.n.new('ShaderNodeSeparateXYZ')
        nt.links.new(self.uv, sep.inputs[0])
        self.u, self.v = sep.outputs['X'], sep.outputs['Y']

    def link(self, sock, target):
        self.nt.links.new(sock, target)

    def put(self, target, val):
        if hasattr(val, 'node'):
            self.link(val, target)
        else:
            target.default_value = val

    def math(self, op, a, b=None, c=None, clamp=False):
        m = self.n.new('ShaderNodeMath')
        m.operation = op
        m.use_clamp = clamp
        self.put(m.inputs[0], a)
        if b is not None:
            self.put(m.inputs[1], b)
        if c is not None:
            self.put(m.inputs[2], c)
        return m.outputs[0]

    def vec(self, op, a, b=None):
        m = self.n.new('ShaderNodeVectorMath')
        m.operation = op
        self.put(m.inputs[0], a)
        if b is not None:
            self.put(m.inputs[1], b)
        return m.outputs[0]

    def combine(self, x, y, z=0.0):
        c = self.n.new('ShaderNodeCombineXYZ')
        self.put(c.inputs[0], x); self.put(c.inputs[1], y); self.put(c.inputs[2], z)
        return c.outputs[0]

    def ramp(self, fac, stops, interp='LINEAR'):
        r = self.n.new('ShaderNodeValToRGB')
        r.color_ramp.interpolation = interp
        el = r.color_ramp.elements
        while len(el) > 1:
            el.remove(el[-1])
        for i, (pos, col) in enumerate(stops):
            e = el[0] if i == 0 else el.new(pos)
            e.position = pos
            e.color = col if len(col) == 4 else tuple(col) + (1.0,)
        self.link(fac, r.inputs['Fac'])
        return r.outputs['Color']

    def mix(self, fac, a, b):
        m = self.n.new('ShaderNodeMix')
        m.data_type = 'RGBA'
        self.put(m.inputs['Factor'], fac)
        self.put(m.inputs['A'], a)
        self.put(m.inputs['B'], b)
        return m.outputs['Result']

    def noise(self, freq, detail=4.0, rough=0.55, seed=0.0, fx=1.0, fy=1.0):
        """seamless fBm noise, `freq` cells across the tile (fx/fy stretch it per axis)"""
        r = freq / TAU
        a = self.math('MULTIPLY', self.u, TAU * 1.0)
        b = self.math('MULTIPLY', self.v, TAU * 1.0)
        ca, sa = self.math('COSINE', a), self.math('SINE', a)
        cb, sb = self.math('COSINE', b), self.math('SINE', b)
        x = self.math('MULTIPLY', ca, r * fx)
        y = self.math('MULTIPLY', sa, r * fx)
        z = self.math('ADD', self.math('MULTIPLY', cb, r * fy), seed)
        w = self.math('ADD', self.math('MULTIPLY', sb, r * fy), seed * 0.7)
        nz = self.n.new('ShaderNodeTexNoise')
        nz.noise_dimensions = '4D'
        nz.inputs['Detail'].default_value = detail
        nz.inputs['Roughness'].default_value = rough
        nz.inputs['Scale'].default_value = 1.0
        self.link(self.combine(x, y, z), nz.inputs['Vector'])
        self.link(w, nz.inputs['W'])
        return nz.outputs['Fac']

    def bumpy(self, fac, lo, hi):
        return self.math('ADD', self.math('MULTIPLY', fac, hi - lo), lo)


# ---------------------------------------------------------------------------------------------------- patterns
# each returns (colour socket, height socket in 0..1, roughness socket/float, bump strength)

def p_brick(g):
    b = g.n.new('ShaderNodeTexBrick')
    b.offset = 0.5; b.offset_frequency = 2; b.squash = 1.0; b.squash_frequency = 2
    b.inputs['Scale'].default_value = 1.0
    b.inputs['Brick Width'].default_value = 1 / 6
    b.inputs['Row Height'].default_value = 1 / 12
    b.inputs['Mortar Size'].default_value = 0.008
    b.inputs['Mortar Smooth'].default_value = 0.12
    b.inputs['Bias'].default_value = 0.0
    b.inputs['Color1'].default_value = lin('#a4523a')
    b.inputs['Color2'].default_value = lin('#7e3b2b')
    b.inputs['Mortar'].default_value = lin('#a9a294')
    g.link(g.uv, b.inputs['Vector'])
    grain = g.noise(48, 5, 0.6, 1.3)
    blot = g.noise(5, 3, 0.5, 4.1)
    col = g.mix(0.32, b.outputs['Color'], g.ramp(grain, [(0.3, lin('#3a2a24')), (0.7, lin('#d6c6b6'))]))
    col = g.mix(g.math('MULTIPLY', g.math('SUBTRACT', blot, 0.3, clamp=True), 0.8), col, lin('#4a3a32'))
    fac = b.outputs['Fac']   # 1 on brick, 0 in mortar
    hgt = g.math('ADD', g.math('MULTIPLY', fac, 0.7), g.math('MULTIPLY', grain, 0.3))
    rough = g.bumpy(grain, 0.72, 0.95)
    return col, hgt, rough, 0.9


def p_concrete(g):
    big = g.noise(6, 3, 0.5, 0.0)
    fine = g.noise(90, 5, 0.7, 2.2)
    pits = g.noise(40, 2, 0.5, 7.7)
    cracks = g.n.new('ShaderNodeTexVoronoi')
    cracks.feature = 'DISTANCE_TO_EDGE'
    cracks.voronoi_dimensions = '2D'
    cracks.inputs['Scale'].default_value = 3.0
    g.link(g.uv, cracks.inputs['Vector'])
    crack = g.math('SUBTRACT', 1.0, g.math('MULTIPLY', cracks.outputs['Distance'], 22.0, clamp=True), clamp=True)
    crack = g.math('MULTIPLY', crack, g.math('GREATER_THAN', g.noise(4, 2, 0.5, 3.3), 0.55))
    col = g.ramp(g.math('ADD', g.math('MULTIPLY', big, 0.5), g.math('MULTIPLY', fine, 0.5)),
                 [(0.25, lin('#7c7d7a')), (0.6, lin('#9a9a94')), (0.8, lin('#aeaea6'))])
    col = g.mix(g.math('MULTIPLY', crack, 0.55), col, lin('#33332f'))
    col = g.mix(g.math('MULTIPLY', g.math('SUBTRACT', pits, 0.62, clamp=True), 2.0, clamp=True), col, lin('#54554f'))
    hgt = g.math('SUBTRACT', g.math('ADD', g.math('MULTIPLY', fine, 0.6), g.math('MULTIPLY', big, 0.4)), g.math('MULTIPLY', crack, 0.5))
    return col, hgt, g.bumpy(fine, 0.8, 0.98), 0.7


def p_rock(g):
    v = g.n.new('ShaderNodeTexVoronoi')
    v.feature = 'DISTANCE_TO_EDGE'
    v.voronoi_dimensions = '2D'
    v.inputs['Scale'].default_value = 4.0
    # warp the vector with seamless noise so the plates are irregular but still tile (scale 5 is an integer)
    g.link(g.uv, v.inputs['Vector'])
    plates = g.math('MULTIPLY', v.outputs['Distance'], 9.0, clamp=True)
    grain = g.noise(60, 5, 0.65, 1.5)
    strata = g.noise(9, 4, 0.55, 5.0, 1.0, 3.0)
    col = g.ramp(g.math('ADD', g.math('MULTIPLY', strata, 0.55), g.math('MULTIPLY', grain, 0.45)),
                 [(0.25, lin('#4b4640')), (0.55, lin('#6e675d')), (0.8, lin('#8a8377'))])
    col = g.mix(g.math('MULTIPLY', g.math('SUBTRACT', 1.0, plates), 0.55), col, lin('#2a2723'))
    hgt = g.math('ADD', g.math('MULTIPLY', plates, 0.55), g.math('MULTIPLY', g.math('ADD', grain, strata), 0.22))
    return col, hgt, g.bumpy(grain, 0.75, 1.0), 1.4


def p_metal(g):
    """corrugated container steel: 16 ribs across the tile, painted, scuffed"""
    ribs = g.math('ADD', g.math('MULTIPLY', g.math('SINE', g.math('MULTIPLY', g.u, TAU * 16.0)), 0.5), 0.5)
    scuff = g.noise(40, 5, 0.6, 1.0, 0.4, 5.0)
    dirt = g.noise(6, 4, 0.55, 9.0, 1.0, 2.0)
    rust = g.math('MULTIPLY', g.math('SUBTRACT', g.noise(14, 4, 0.6, 3.0), 0.55, clamp=True), 2.2, clamp=True)
    col = g.ramp(g.math('ADD', g.math('MULTIPLY', scuff, 0.4), g.math('MULTIPLY', dirt, 0.4)),
                 [(0.2, lin('#b9bbbb')), (0.55, lin('#d4d5d4')), (0.85, lin('#e6e6e2'))])
    col = g.mix(g.math('MULTIPLY', ribs, 0.12), col, lin('#8a8c8e'))          # paint pooling in the valleys
    col = g.mix(g.math('MULTIPLY', rust, 0.8), col, lin('#7a3f1f'))
    hgt = g.math('ADD', g.math('MULTIPLY', ribs, 0.85), g.math('MULTIPLY', scuff, 0.08))
    rough = g.math('ADD', g.bumpy(scuff, 0.42, 0.62), g.math('MULTIPLY', rust, 0.3))
    return col, hgt, rough, 0.6


def p_wood(g):
    """crate planks: 4 boards across the tile with grain, gaps and nail heads"""
    board = g.math('MULTIPLY', g.u, 4.0)
    frac = g.math('FRACT', board)
    gap = g.math('SUBTRACT', 1.0, g.math('MULTIPLY', g.math('MINIMUM', frac, g.math('SUBTRACT', 1.0, frac)), 60.0, clamp=True), clamp=True)
    idx = g.math('FLOOR', board)
    warp = g.noise(4, 3, 0.5, 2.0, 1.0, 1.0)
    grain = g.n.new('ShaderNodeTexWave')
    grain.wave_type = 'BANDS'; grain.bands_direction = 'Y'; grain.wave_profile = 'SAW'
    grain.inputs['Scale'].default_value = 26.0
    grain.inputs['Distortion'].default_value = 3.5
    grain.inputs['Detail'].default_value = 3.0
    grain.inputs['Detail Scale'].default_value = 1.4
    g.link(g.combine(g.math('MULTIPLY', g.u, 4.0), g.math('MULTIPLY', g.v, 0.5), g.math('MULTIPLY', idx, 1.7)), grain.inputs['Vector'])
    tone = g.math('ADD', g.math('MULTIPLY', grain.outputs['Fac'], 0.55), g.math('MULTIPLY', g.noise(30, 4, 0.6, 1.0, 3.0, 0.5), 0.45))
    board_tint = g.math('MULTIPLY', g.math('ADD', g.math('MODULO', g.math('MULTIPLY', idx, 0.37), 1.0), 0.0), 0.3)
    col = g.ramp(g.math('ADD', tone, board_tint), [(0.2, lin('#6f4a26')), (0.55, lin('#a2703c')), (0.95, lin('#c79a5f'))])
    col = g.mix(g.math('MULTIPLY', gap, 0.9), col, lin('#1c120a'))
    hgt = g.math('SUBTRACT', g.math('ADD', g.math('MULTIPLY', tone, 0.25), 0.7), g.math('MULTIPLY', gap, 0.8))
    return col, hgt, g.bumpy(tone, 0.6, 0.9), 0.8


def p_sandbag(g):
    """rows of stuffed canvas bags"""
    b = g.n.new('ShaderNodeTexBrick')
    b.offset = 0.5; b.offset_frequency = 2; b.squash = 1.0; b.squash_frequency = 2
    b.inputs['Scale'].default_value = 1.0
    b.inputs['Brick Width'].default_value = 1 / 3
    b.inputs['Row Height'].default_value = 1 / 6
    b.inputs['Mortar Size'].default_value = 0.05
    b.inputs['Mortar Smooth'].default_value = 1.0
    b.inputs['Bias'].default_value = 0.0
    b.inputs['Color1'].default_value = lin('#b4a172')
    b.inputs['Color2'].default_value = lin('#9a8a5e')
    b.inputs['Mortar'].default_value = lin('#3c3320')
    g.link(g.uv, b.inputs['Vector'])
    weave = g.n.new('ShaderNodeTexChecker')
    weave.inputs['Scale'].default_value = 128.0
    g.link(g.uv, weave.inputs['Vector'])
    fibre = g.noise(110, 3, 0.7, 4.0)
    col = g.mix(0.25, b.outputs['Color'], g.ramp(fibre, [(0.3, lin('#5b4f34')), (0.75, lin('#d2c08c'))]))
    dirt = g.math('MULTIPLY', g.math('SUBTRACT', g.noise(7, 4, 0.55, 2.2), 0.45, clamp=True), 1.4, clamp=True)
    col = g.mix(g.math('MULTIPLY', dirt, 0.6), col, lin('#4a3f2a'))
    hgt = g.math('ADD', g.math('MULTIPLY', b.outputs['Fac'], 0.85), g.math('MULTIPLY', g.math('ADD', weave.outputs['Fac'], fibre), 0.06))
    return col, hgt, g.bumpy(fibre, 0.85, 1.0), 1.3


def p_ground(g):
    """detail normal + roughness for the terrain (albedo comes from the per-map painted canvas)"""
    grain = g.noise(70, 5, 0.65, 0.5)
    clump = g.noise(14, 5, 0.6, 3.5)
    pebble = g.n.new('ShaderNodeTexVoronoi')
    pebble.feature = 'F1'; pebble.voronoi_dimensions = '2D'
    pebble.inputs['Scale'].default_value = 24.0
    g.link(g.uv, pebble.inputs['Vector'])
    peb = g.math('MULTIPLY', g.math('SUBTRACT', 1.0, pebble.outputs['Distance'], clamp=True), g.math('GREATER_THAN', g.noise(6, 2, 0.5, 8.0), 0.55))
    hgt = g.math('ADD', g.math('ADD', g.math('MULTIPLY', grain, 0.5), g.math('MULTIPLY', clump, 0.4)), g.math('MULTIPLY', peb, 0.5))
    col = g.ramp(g.math('ADD', g.math('MULTIPLY', grain, 0.5), g.math('MULTIPLY', clump, 0.5)), [(0.2, (0.72, 0.72, 0.72, 1)), (0.8, (1.0, 1.0, 1.0, 1))])
    return col, hgt, g.bumpy(grain, 0.9, 1.0), 1.5


PATTERNS = {'brick': p_brick, 'concrete': p_concrete, 'rock': p_rock, 'metal': p_metal, 'wood': p_wood, 'sandbag': p_sandbag, 'ground': p_ground}
ONLY_NORMAL = {'ground'}


# ---------------------------------------------------------------------------------------------------- baking
def bake_pass(scene, obj, mat, kind, size, path, colorspace):
    nt = mat.node_tree
    img = bpy.data.images.new(os.path.basename(path), size, size, alpha=False)
    img.colorspace_settings.name = colorspace
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    for n in nt.nodes:
        n.select = False
    tex.select = True
    nt.nodes.active = tex
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.bake(type=kind, margin=4)
    img.filepath_raw = path
    img.file_format = 'JPEG'
    scene.render.image_settings.quality = 90
    img.save()
    nt.nodes.remove(tex)
    bpy.data.images.remove(img)


def build(name, size):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 1
    scene.cycles.use_denoising = False
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    scene.render.bake.normal_space = 'TANGENT'
    bpy.ops.mesh.primitive_plane_add(size=1.0)
    obj = bpy.context.active_object
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    obj.data.materials.append(mat)
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    g = G(nt)
    col, hgt, rough, strength = PATTERNS[name](g)
    out = nt.nodes.new('ShaderNodeOutputMaterial')

    def surface(sock):
        e = nt.nodes.new('ShaderNodeEmission')
        if hasattr(sock, 'node'):
            nt.links.new(sock, e.inputs['Color'])
        else:
            e.inputs['Color'].default_value = (sock, sock, sock, 1)
        for l in list(out.inputs['Surface'].links):
            nt.links.remove(l)
        nt.links.new(e.outputs[0], out.inputs['Surface'])

    if name not in ONLY_NORMAL:
        surface(col)
        bake_pass(scene, obj, mat, 'EMIT', size, os.path.join(OUT, name + '_c.jpg'), 'sRGB')
    surface(rough)
    bake_pass(scene, obj, mat, 'EMIT', size, os.path.join(OUT, name + '_r.jpg'), 'Non-Color')
    # normal: principled + bump from the height field
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = strength
    bump.inputs['Distance'].default_value = 0.02
    nt.links.new(hgt, bump.inputs['Height'])
    pr = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bump.outputs['Normal'], pr.inputs['Normal'])
    for l in list(out.inputs['Surface'].links):
        nt.links.remove(l)
    nt.links.new(pr.outputs[0], out.inputs['Surface'])
    bake_pass(scene, obj, mat, 'NORMAL', size, os.path.join(OUT, name + '_n.jpg'), 'Non-Color')
    print('baked', name)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    size = 512
    for a in sys.argv[1:]:
        if a.startswith('--size='):
            size = int(a.split('=')[1])
    for n in (args or list(PATTERNS)):
        build(n, size)
