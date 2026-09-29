"""Small modelling toolkit on top of Blender's Python API (bpy), used to build the game's high-fidelity assets headlessly.

Run any script here with:  python3 tools/blender/build_weapons.py      (needs `pip install bpy`)

Conventions: metres, +X forward (muzzle), +Z up, +Y left. glTF export converts to three.js axes (X fwd, Y up, Z right).
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector, Euler, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'src', 'client', 'assets')
PREVIEW = os.environ.get('BLENDER_PREVIEW_DIR', '/tmp/bl_preview')


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)


MATS = {}


def mat(name, rgb, metal=0.0, rough=0.5, emit=None, emit_strength=1.0, alpha=1.0, clearcoat=0.0):
    """Principled PBR material; exported to glTF as metallicRoughness."""
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Roughness'].default_value = rough
    if clearcoat:
        bsdf.inputs['Coat Weight'].default_value = clearcoat
    if emit:
        bsdf.inputs['Emission Color'].default_value = (emit[0], emit[1], emit[2], 1.0)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    if alpha < 1.0:
        bsdf.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else None
    MATS[name] = m
    return m


def srgb(hexstr):
    """'#c2a06a' -> linear-ish rgb tuple (Blender colours are linear)."""
    h = hexstr.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple((v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c)


def _copy_into(target, src, m_index=0):
    """append the geometry of bmesh `src` to bmesh `target`"""
    vmap = {}
    for v in src.verts:
        vmap[v] = target.verts.new(v.co)
    for f in src.faces:
        try:
            nf = target.faces.new([vmap[v] for v in f.verts])
            nf.smooth = True
        except ValueError:
            pass


class Builder:
    """Collects primitives per material and turns them into ONE object with several material slots."""

    def __init__(self, name):
        self.name = name
        self.bms = {}
        self.mats = {}
        self.empties = []

    def _target(self, m):
        if m.name not in self.bms:
            self.bms[m.name] = bmesh.new()
            self.mats[m.name] = m
        return self.bms[m.name]

    # ---- primitives -------------------------------------------------------------------------------
    def box(self, m, c, s, bevel=0.0012, rot=(0, 0, 0), seg=2):
        """box centred on c with size s=(x,y,z); rot = Euler degrees applied about the centre"""
        t = bmesh.new()
        bmesh.ops.create_cube(t, size=1.0)
        bmesh.ops.scale(t, vec=Vector(s), verts=t.verts)
        if bevel > 0:
            b = min(bevel, min(s) * 0.45)
            bmesh.ops.bevel(t, geom=list(t.edges), offset=b, segments=seg, affect='EDGES', profile=0.6)
        if any(rot):
            bmesh.ops.rotate(t, cent=(0, 0, 0), matrix=Euler([math.radians(a) for a in rot], 'XYZ').to_matrix(), verts=t.verts)
        bmesh.ops.translate(t, vec=Vector(c), verts=t.verts)
        _copy_into(self._target(m), t)
        t.free()

    def cyl(self, m, a, b, r, r2=None, verts=20, caps=True, bevel=0.0):
        """cylinder / cone from point a to point b"""
        a = Vector(a); b = Vector(b)
        d = b - a
        L = d.length
        if L < 1e-6:
            return
        t = bmesh.new()
        bmesh.ops.create_cone(t, cap_ends=caps, cap_tris=False, segments=verts, radius1=r, radius2=(r if r2 is None else r2), depth=L)
        if bevel > 0 and caps:
            edges = [e for e in t.edges if all(abs(v.co.z) > L * 0.49 for v in e.verts)]
            if edges:
                bmesh.ops.bevel(t, geom=edges, offset=min(bevel, r * 0.4), segments=2, affect='EDGES')
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        bmesh.ops.rotate(t, cent=(0, 0, 0), matrix=q.to_matrix(), verts=t.verts)
        bmesh.ops.translate(t, vec=(a + b) / 2, verts=t.verts)
        _copy_into(self._target(m), t)
        t.free()

    def sphere(self, m, c, r, seg=16, squash=(1, 1, 1)):
        t = bmesh.new()
        bmesh.ops.create_uvsphere(t, u_segments=seg, v_segments=max(6, seg // 2), radius=r)
        bmesh.ops.scale(t, vec=Vector(squash), verts=t.verts)
        bmesh.ops.translate(t, vec=Vector(c), verts=t.verts)
        _copy_into(self._target(m), t)
        t.free()

    def tube(self, m, a, b, r_out, r_in, verts=24):
        """hollow cylinder (rings at both ends), used for barrels, scopes, suppressors"""
        a = Vector(a); b = Vector(b)
        d = b - a
        L = d.length
        t = bmesh.new()
        bmesh.ops.create_cone(t, cap_ends=False, segments=verts, radius1=r_out, radius2=r_out, depth=L)
        inner = bmesh.new()
        bmesh.ops.create_cone(inner, cap_ends=False, segments=verts, radius1=r_in, radius2=r_in, depth=L)
        bmesh.ops.reverse_faces(inner, faces=list(inner.faces))
        _copy_into(t, inner); inner.free()
        # ring caps
        ring_faces = []
        outer_top = [v for v in t.verts if v.co.z > 0 and (v.co.x ** 2 + v.co.y ** 2) ** 0.5 > (r_out + r_in) / 2]
        inner_top = [v for v in t.verts if v.co.z > 0 and (v.co.x ** 2 + v.co.y ** 2) ** 0.5 <= (r_out + r_in) / 2]
        outer_bot = [v for v in t.verts if v.co.z < 0 and (v.co.x ** 2 + v.co.y ** 2) ** 0.5 > (r_out + r_in) / 2]
        inner_bot = [v for v in t.verts if v.co.z < 0 and (v.co.x ** 2 + v.co.y ** 2) ** 0.5 <= (r_out + r_in) / 2]
        for o, i in ((outer_top, inner_top), (outer_bot, inner_bot)):
            o.sort(key=lambda v: math.atan2(v.co.y, v.co.x)); i.sort(key=lambda v: math.atan2(v.co.y, v.co.x))
            n = len(o)
            for k in range(n):
                try:
                    ring_faces.append(t.faces.new([o[k], o[(k + 1) % n], i[(k + 1) % n], i[k]]))
                except ValueError:
                    pass
        bmesh.ops.recalc_face_normals(t, faces=list(t.faces))
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        bmesh.ops.rotate(t, cent=(0, 0, 0), matrix=q.to_matrix(), verts=t.verts)
        bmesh.ops.translate(t, vec=(a + b) / 2, verts=t.verts)
        _copy_into(self._target(m), t)
        t.free()

    def loft(self, m, sections, closed_ends=True):
        """sections: list of (centre(x,y,z), width_y, height_z, corner_radius) along +X, joined into a rounded solid"""
        t = bmesh.new()
        rings = []
        for (c, w, h, cr) in sections:
            pts = []
            n = 4
            hw, hh = w / 2, h / 2
            cr = min(cr, hw * 0.95, hh * 0.95)
            for corner, (sx, sz) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
                cx, cz = sx * (hw - cr), sz * (hh - cr)
                a0 = [0, 90, 180, 270][corner]
                for k in range(n + 1):
                    ang = math.radians(a0 + 90.0 * k / n)
                    pts.append(Vector((c[0], c[1] + cx + cr * math.cos(ang), c[2] + cz + cr * math.sin(ang))))
            rings.append([t.verts.new(p) for p in pts])
        for i in range(len(rings) - 1):
            a, b = rings[i], rings[i + 1]
            for k in range(len(a)):
                try:
                    t.faces.new([a[k], a[(k + 1) % len(a)], b[(k + 1) % len(a)], b[k]])
                except ValueError:
                    pass
        if closed_ends:
            for ring in (rings[0], rings[-1]):
                try:
                    t.faces.new(ring)
                except ValueError:
                    pass
        bmesh.ops.recalc_face_normals(t, faces=list(t.faces))
        _copy_into(self._target(m), t)
        t.free()

    def empty(self, name, loc, size=0.01):
        self.empties.append((name, Vector(loc), size))

    # ---- output -----------------------------------------------------------------------------------
    def finish(self, collection=None, smooth_angle=38, uv_size=0.25):
        mesh = bpy.data.meshes.new(self.name)
        merged = bmesh.new()
        slot_of = {}
        order = list(self.bms.keys())
        for idx, k in enumerate(order):
            bm = self.bms[k]
            start = len(merged.faces)
            _copy_into(merged, bm)
            merged.faces.ensure_lookup_table()
            for f in merged.faces[start:]:
                f.material_index = idx
            slot_of[k] = idx
            bm.free()
        bmesh.ops.remove_doubles(merged, verts=merged.verts, dist=0.00002)
        merged.to_mesh(mesh)
        merged.free()
        for k in order:
            mesh.materials.append(self.mats[k])
        obj = bpy.data.objects.new(self.name, mesh)
        (collection or bpy.context.scene.collection).objects.link(obj)
        bpy.context.view_layer.objects.active = obj
        for o in bpy.context.view_layer.objects:
            o.select_set(False)
        obj.select_set(True)
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle))
        except Exception:
            bpy.ops.object.shade_smooth()
        # box-projected UVs so image textures (grime, normal maps) can be applied later
        try:
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.uv.cube_project(cube_size=uv_size)
            bpy.ops.object.mode_set(mode='OBJECT')
        except Exception:
            pass
        objs = [obj]
        for (n, loc, sz) in self.empties:
            e = bpy.data.objects.new(n, None)
            e.empty_display_type = 'PLAIN_AXES'
            e.empty_display_size = sz
            e.location = loc
            (collection or bpy.context.scene.collection).objects.link(e)
            e.parent = obj
            objs.append(e)
        return obj


def group(name, children, loc=(0, 0, 0)):
    """an empty node that parents several finished objects (glTF node hierarchy)"""
    g = bpy.data.objects.new(name, None)
    g.location = loc
    bpy.context.scene.collection.objects.link(g)
    for c in children:
        c.parent = g
    return g


def bake_ao(objs, samples=32, distance=0.05):
    """Ambient occlusion baked into a vertex-colour layer (COLOR_0 in glTF) so crevices get contact shading with no textures."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.bake_type = 'AO'
    sc.render.bake.target = 'VERTEX_COLORS'
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    ok = True
    for obj in objs:
        if obj.type != 'MESH':
            continue
        me = obj.data
        if 'AO' not in me.color_attributes:
            me.color_attributes.new(name='AO', type='FLOAT_COLOR', domain='POINT')
        me.color_attributes.active_color = me.color_attributes['AO']
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        try:
            bpy.ops.object.bake(type='AO')
        except Exception as e:
            print('AO bake failed for', obj.name, e)
            ok = False
        obj.select_set(False)
    return ok


def export(path, objs=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    if objs:
        for o in objs:
            o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=bool(objs), export_yup=True, export_apply=True,
                              export_cameras=False, export_lights=False, export_extras=False, export_image_format='AUTO',
                              export_vertex_color='ACTIVE', export_texcoords=True, export_normals=True)
    print('exported', path, os.path.getsize(path) // 1024, 'KB')


def preview(name, cam_loc, target, w=900, h=420, samples=24, lens=50, ortho=None):
    """quick Cycles render of the current scene for eyeballing a model"""
    os.makedirs(PREVIEW, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x = w
    sc.render.resolution_y = h
    sc.render.film_transparent = False
    world = bpy.data.worlds.new('w') if not sc.world else sc.world
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.09, 0.11, 0.15, 1)
    bg.inputs['Strength'].default_value = 1.0
    for o in [o for o in bpy.data.objects if o.type in ('CAMERA', 'LIGHT')]:
        bpy.data.objects.remove(o)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    bpy.context.scene.collection.objects.link(cam)
    cam.location = cam_loc
    if ortho:
        cam.data.type = 'ORTHO'; cam.data.ortho_scale = ortho
    else:
        cam.data.lens = lens
    d = Vector(target) - Vector(cam_loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    for nm, loc, energy, size, col in (('key', (0.6, -1.4, 1.2), 260, 1.2, (1, 0.93, 0.82)), ('rim', (-1.2, 1.0, 0.8), 140, 1.0, (0.7, 0.8, 1)), ('fill', (0.2, -0.6, -0.9), 50, 1.5, (1, 1, 1))):
        ld = bpy.data.lights.new(nm, 'AREA')
        ld.energy = energy; ld.size = size; ld.color = col
        lo = bpy.data.objects.new(nm, ld)
        lo.location = Vector(target) + Vector(loc)
        lo.rotation_euler = (Vector(target) - lo.location).to_track_quat('-Z', 'Y').to_euler()
        bpy.context.scene.collection.objects.link(lo)
    sc.render.filepath = os.path.join(PREVIEW, name + '.png')
    bpy.ops.render.render(write_still=True)
    print('preview', sc.render.filepath)
