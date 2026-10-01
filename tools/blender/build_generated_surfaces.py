"""Bake companion normal/roughness maps from generated brick through Blender MCP."""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib
from build_textures import bake_pass

bpy = lib.bpy
lib.reset()
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 1
scene.cycles.use_denoising = False
scene.render.bake.use_pass_direct = False
scene.render.bake.use_pass_indirect = False
scene.render.bake.normal_space = 'TANGENT'
scene.render.bake.target = 'IMAGE_TEXTURES'
bpy.ops.mesh.primitive_plane_add(size=1.0)
obj = bpy.context.active_object
material = lib.mat('generated_brick', (1, 1, 1), rough=0.9)
obj.data.materials.append(material)
nodes, links = material.node_tree.nodes, material.node_tree.links
image = nodes.new('ShaderNodeTexImage')
image.image = bpy.data.images.load(os.path.join(lib.OUT, 'tex', 'brick-generated.jpg'), check_existing=True)
links.new(image.outputs['Color'], nodes['Principled BSDF'].inputs['Base Color'])
# Clay is redder than the neutral mortar: derive relief from that separation.
# Matching the generated image avoids a second, differently spaced brick bond.
separate = nodes.new('ShaderNodeSeparateColor')
separate.mode = 'RGB'
links.new(image.outputs['Color'], separate.inputs['Color'])
height = nodes.new('ShaderNodeMath')
height.operation = 'SUBTRACT'
links.new(separate.outputs['Red'], height.inputs[0])
links.new(separate.outputs['Blue'], height.inputs[1])
bump = nodes.new('ShaderNodeBump')
bump.inputs['Strength'].default_value = 0.5
bump.inputs['Distance'].default_value = 0.025
links.new(height.outputs[0], bump.inputs['Height'])
links.new(bump.outputs['Normal'], nodes['Principled BSDF'].inputs['Normal'])
tex = os.path.join(lib.OUT, 'tex')
bake_pass(scene, obj, material, 'NORMAL', 1024, os.path.join(tex, 'brick-generated-n.jpg'), 'Non-Color')
roughness = nodes.new('ShaderNodeRGBToBW')
links.new(image.outputs['Color'], roughness.inputs['Color'])
ramp = nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (0.72, 0.72, 0.72, 1)
ramp.color_ramp.elements[1].color = (0.96, 0.96, 0.96, 1)
links.new(roughness.outputs[0], ramp.inputs['Fac'])
emission = nodes.new('ShaderNodeEmission')
links.new(ramp.outputs[0], emission.inputs['Color'])
links.new(emission.outputs[0], nodes['Material Output'].inputs['Surface'])
bake_pass(scene, obj, material, 'EMIT', 1024, os.path.join(tex, 'brick-generated-r.jpg'), 'Non-Color')
print('Generated brick companion maps baked')
