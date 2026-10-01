"""Shared hand-built forms used to recreate the generated world reference sheets."""
import math
import os
import bmesh
from mathutils import Vector
import lib


def faces(builder, material, vertices, polygons, bevel=0):
    bm = bmesh.new()
    points = [bm.verts.new(Vector(p)) for p in vertices]
    for indices in polygons:
        bm.faces.new([points[i] for i in indices])
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect='EDGES')
    lib._copy_into(builder._target(material), bm)
    bm.free()


def prism(builder, material, profile, width, y=0):
    vertices = [(x, y + side * width / 2, z) for side in (-1, 1) for x, z in profile]
    n = len(profile)
    polygons = [list(range(n - 1, -1, -1)), list(range(n, n * 2))]
    polygons += [[i, (i + 1) % n, (i + 1) % n + n, i + n] for i in range(n)]
    faces(builder, material, vertices, polygons, min(.012, width * .2))


def pipe(builder, material, points, radius=.018, segments=8):
    for a, b in zip(points, points[1:]):
        builder.cyl(material, a, b, radius, verts=segments)


def shell(builder, material, sections):
    """Faceted vehicle skin: station tuples (x, half-width, bottom, top)."""
    vertices=[]
    for x,w,lo,hi in sections:
        bevel=min(.13,(hi-lo)*.22)
        vertices += [(x,-w*.76,lo),(x,w*.76,lo),(x,w,lo+bevel),(x,w,hi-bevel),(x,w*.82,hi),(x,-w*.82,hi),(x,-w,hi-bevel),(x,-w,lo+bevel)]
    polygons=[list(range(7,-1,-1)),list(range((len(sections)-1)*8,len(sections)*8))]
    polygons += [[j*8+i,j*8+(i+1)%8,(j+1)*8+(i+1)%8,(j+1)*8+i] for j in range(len(sections)-1) for i in range(8)]
    faces(builder,material,vertices,polygons,.008)


def pillow(builder, material, center, size, angle=0, seed=0):
    vertices = []
    n, rings = 12, 6
    ca, sa = math.cos(angle), math.sin(angle)
    for j in range(rings + 1):
        lat = .001 + (math.pi - .002) * j / rings
        for i in range(n):
            a = i * math.tau / n
            f = lambda t: math.copysign(abs(t) ** .48, t)
            x = size[0] * .5 * f(math.cos(a)) * math.sin(lat) ** .55
            y = size[1] * .5 * f(math.sin(a)) * math.sin(lat) ** .55
            z = size[2] * .5 * f(math.cos(lat))
            z += .008 * math.sin(a * 3 + seed) * math.sin(lat)
            vertices.append((center[0] + x * ca - y * sa, center[1] + x * sa + y * ca, center[2] + z))
    polygons = [[j * n + i, j * n + (i + 1) % n, (j + 1) * n + (i + 1) % n, (j + 1) * n + i] for j in range(rings) for i in range(n)]
    polygons += [list(range(n - 1, -1, -1)), list(range(rings * n, (rings + 1) * n))]
    faces(builder, material, vertices, polygons)


def reference_and_save(kind, name):
    bpy = lib.bpy
    ref = os.path.join(lib.OUT, 'references', kind + '-v2.png')
    empty = bpy.data.objects.new('REFERENCE_' + kind, None)
    empty.empty_display_type = 'IMAGE'
    empty.data = bpy.data.images.load(ref, check_existing=True)
    empty.empty_display_size = 12
    empty.location = (0, 6, 5)
    empty.rotation_euler = (math.pi / 2, 0, 0)
    empty.hide_render = True
    bpy.context.scene.collection.objects.link(empty)
    bpy.ops.file.pack_all()
    out = os.path.join(lib.ROOT, 'output', 'models-v2')
    os.makedirs(out, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, name + '.blend'))
