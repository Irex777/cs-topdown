"""Bake shallow normal/roughness companions for the generated plaster, slate and fabric."""
import os
import sys
import importlib
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import lib
importlib.reload(lib)
from build_textures import bake_pass
bpy=lib.bpy
for name, depth in [('plaster',.006),('roof',.035),('burlap',.002)]:
    lib.reset()
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=1
    scene.cycles.use_denoising=False;scene.render.bake.normal_space='TANGENT';scene.render.bake.target='IMAGE_TEXTURES'
    bpy.ops.mesh.primitive_plane_add(size=1)
    obj=bpy.context.active_object
    m=lib.mat(name+'_bake',(1,1,1),rough=.93);obj.data.materials.append(m)
    n,l=m.node_tree.nodes,m.node_tree.links
    image=n.new('ShaderNodeTexImage');image.image=bpy.data.images.load(os.path.join(lib.OUT,'tex',name+'-v2.jpg'),check_existing=True)
    bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.32;bump.inputs['Distance'].default_value=depth
    l.new(image.outputs['Color'],bump.inputs['Height']);l.new(bump.outputs['Normal'],n['Principled BSDF'].inputs['Normal'])
    bake_pass(scene,obj,m,'NORMAL',1024,os.path.join(lib.OUT,'tex',name+'-v2-n.jpg'),'Non-Color')
    emit=n.new('ShaderNodeEmission');emit.inputs['Color'].default_value=(.9,.9,.9,1)
    l.new(emit.outputs[0],n['Material Output'].inputs['Surface'])
    bake_pass(scene,obj,m,'EMIT',512,os.path.join(lib.OUT,'tex',name+'-v2-r.jpg'),'Non-Color')
