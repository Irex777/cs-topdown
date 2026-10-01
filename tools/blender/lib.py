"""Small modelling toolkit on top of Blender's Python API (bpy), used to build the game's high-fidelity assets headlessly.

Run any script here with:  python3 tools/blender/build_weapons.py      (needs `pip install bpy`)

Conventions: metres, +X forward (muzzle), +Z up, +Y left. glTF export converts to three.js axes (X fwd, Y up, Z right).
"""
import math
import os
import sys
import json
import struct

import bpy
import bmesh
from mathutils import Vector, Euler, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'src', 'client', 'assets')
PREVIEW = os.environ.get('BLENDER_PREVIEW_DIR', '/tmp/bl_preview')


def reset():
    # Preserve the running MCP add-on and user preferences during batch builds.
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for pool in (bpy.data.meshes, bpy.data.materials):
        for item in list(pool):
            if item.users == 0:
                pool.remove(item)
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
        if hasattr(m, 'surface_render_method'):
            m.surface_render_method = 'DITHERED'
        elif hasattr(m, 'blend_method'):
            m.blend_method = 'BLEND'
    MATS[name] = m
    return m


def image_mat(name, image_path, tint=(1, 1, 1), metal=0.0, rough=0.8):
    """Generated, UV-mapped base color; tint remains an editable glTF factor."""
    m = mat(name, tint, metal, rough)
    m['frontline_base_color_factor'] = [*tint, 1.0]
    path = os.path.join(OUT, image_path)
    if not os.path.isfile(path):
        raise FileNotFoundError('Generate the skin first: ' + path)
    nodes = m.node_tree.nodes
    image = nodes.new('ShaderNodeTexImage')
    image.image = bpy.data.images.load(path, check_existing=True)
    image.interpolation = 'Linear'
    mix = nodes.new('ShaderNodeMixRGB')
    mix.blend_type = 'MULTIPLY'
    mix.inputs[0].default_value = 1.0
    mix.inputs[2].default_value = (*tint, 1.0)
    m.node_tree.links.new(image.outputs['Color'], mix.inputs[1])
    m.node_tree.links.new(mix.outputs[0], nodes['Principled BSDF'].inputs['Base Color'])
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

    def stack(self, m, rings, n=28, cap_top=True, cap_bot=True):
        """Organic vertical solid from superellipse cross-sections.
        rings: list of (z, cx, cy, rx, ry, p) bottom -> top; p=2 is an ellipse, 3-4 a soft rounded box."""
        t = bmesh.new()
        layers = []
        for (z, cx, cy, rx, ry, p) in rings:
            e = 2.0 / p
            layer = []
            for k in range(n):
                a = 2 * math.pi * k / n
                c, s = math.cos(a), math.sin(a)
                layer.append(t.verts.new((cx + rx * math.copysign(abs(c) ** e, c), cy + ry * math.copysign(abs(s) ** e, s), z)))
            layers.append(layer)
        for i in range(len(layers) - 1):
            a, b = layers[i], layers[i + 1]
            for k in range(n):
                try:
                    t.faces.new([a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]])
                except ValueError:
                    pass
        if cap_top:
            try:
                t.faces.new(layers[-1])
            except ValueError:
                pass
        if cap_bot:
            try:
                t.faces.new(list(reversed(layers[0])))
            except ValueError:
                pass
        _copy_into(self._target(m), t)
        t.free()

    def sweep(self, m, pts, radii, n=14, squash=(1.0, 1.0), ref=(0, 1, 0), round_ends=(True, True), p=2.0):
        """Tapered tube along a polyline (limbs, straps, hoses). squash scales the (u, v) axes of each ring, u being the
        component of `ref` perpendicular to the path; round_ends closes each end with a small dome; p is the superellipse
        exponent of the cross-section (2 = ellipse, 4 = rounded rectangle)."""
        pts = [Vector(p) for p in pts]
        ref = Vector(ref).normalized()
        k = len(pts)
        tang = []
        for i in range(k):
            d = pts[min(i + 1, k - 1)] - pts[max(i - 1, 0)]
            tang.append(d.normalized())

        def frame(tn):
            u = ref - tn * ref.dot(tn)
            if u.length < 1e-4:
                u = Vector((1, 0, 0)) - tn * tn.x
            u.normalize()
            return u, tn.cross(u).normalized()

        # expand the ends into a few shrinking rings so the tube is closed with a dome
        rings = [(pts[i], tang[i], radii[i]) for i in range(k)]
        if round_ends[0]:
            r0, t0 = radii[0], tang[0]
            rings = [(pts[0] - t0 * r0 * f, t0, r0 * s) for f, s in ((0.85, 0.45), (0.5, 0.85))] + rings
        if round_ends[1]:
            r1, t1 = radii[-1], tang[-1]
            rings = rings + [(pts[-1] + t1 * r1 * f, t1, r1 * s) for f, s in ((0.5, 0.85), (0.85, 0.45))]
        t = bmesh.new()
        layers = []
        for (c, tn, r) in rings:
            u, v = frame(tn)
            e = 2.0 / p
            ring = []
            for j in range(n):
                cj, sj = math.cos(2 * math.pi * j / n), math.sin(2 * math.pi * j / n)
                ring.append(t.verts.new(c + u * (math.copysign(abs(cj) ** e, cj) * r * squash[0]) + v * (math.copysign(abs(sj) ** e, sj) * r * squash[1])))
            layers.append(ring)
        for i in range(len(layers) - 1):
            a, b = layers[i], layers[i + 1]
            for j in range(n):
                try:
                    t.faces.new([a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]])
                except ValueError:
                    pass
        for layer, flip in ((layers[0], True), (layers[-1], False)):
            try:
                t.faces.new(list(reversed(layer)) if flip else layer)
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
        for child in getattr(self, 'children', []):
            child.parent = obj
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
    # Blender 5.2 exports MixRGB image links without their constant multiplier.
    # Store that authored tint as the standard glTF linear baseColorFactor.
    with open(path, 'rb') as stream:
        blob = stream.read()
    json_size = struct.unpack_from('<I', blob, 12)[0]
    doc = json.loads(blob[20:20 + json_size])
    for material in doc.get('materials', []):
        source = bpy.data.materials.get(material.get('name', ''))
        if source and 'frontline_base_color_factor' in source:
            material.setdefault('pbrMetallicRoughness', {})['baseColorFactor'] = list(source['frontline_base_color_factor'])
        if source and 'frontline_alpha_cutoff' in source:
            material['alphaMode'] = 'MASK'
            material['alphaCutoff'] = source['frontline_alpha_cutoff']
            material['doubleSided'] = True
    encoded = json.dumps(doc, separators=(',', ':')).encode('utf8')
    encoded += b' ' * (-len(encoded) % 4)
    binary = blob[20 + json_size:]
    with open(path, 'wb') as stream:
        stream.write(struct.pack('<4sII', b'glTF', 2, 20 + len(encoded) + len(binary)))
        stream.write(struct.pack('<II', len(encoded), 0x4E4F534A))
        stream.write(encoded)
        stream.write(binary)
    print('exported', path, os.path.getsize(path) // 1024, 'KB')


def preview(name, cam_loc, target, w=900, h=420, samples=24, lens=50, ortho=None, light=1.0):
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
        ld.energy = energy * light; ld.size = size; ld.color = col
        lo = bpy.data.objects.new(nm, ld)
        lo.location = Vector(target) + Vector(loc)
        lo.rotation_euler = (Vector(target) - lo.location).to_track_quat('-Z', 'Y').to_euler()
        bpy.context.scene.collection.objects.link(lo)
    sc.render.filepath = os.path.join(PREVIEW, name + '.png')
    bpy.ops.render.render(write_still=True)
    print('preview', sc.render.filepath)
