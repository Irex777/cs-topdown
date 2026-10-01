"""Bake fitted paint wear, contact shading and PBR maps into each moving part."""
import math
import os
import lib
bpy=lib.bpy


def surface_graph(material):
    nodes,links=material.node_tree.nodes,material.node_tree.links
    bsdf=nodes.get('Principled BSDF');output=nodes.get('Material Output')
    if material.get('surface_prepared'):return
    material['surface_prepared']=True
    uv=nodes.new('ShaderNodeUVMap');uv.uv_map='UVMap'
    for node in list(nodes):
        if node.type=='TEX_IMAGE':links.new(uv.outputs['UV'],node.inputs['Vector'])
    emit=nodes.new('ShaderNodeEmission');emit.name='SurfaceAlbedo'
    color=bsdf.inputs['Base Color']
    base=color.links[0].from_socket if color.is_linked else None
    mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1
    if base:links.new(base,mix.inputs[1])
    else:mix.inputs[1].default_value=color.default_value
    ao=nodes.new('ShaderNodeVertexColor');ao.layer_name='AO';links.new(ao.outputs['Color'],mix.inputs[2])
    final=mix.outputs[0]
    if material.name in ('paint','paint_dark','armor_panels'):
        geo=nodes.new('ShaderNodeNewGeometry')
        noise=nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=95;noise.inputs['Detail'].default_value=3
        links.new(geo.outputs['Position'],noise.inputs['Vector'])
        curve=nodes.new('ShaderNodeValToRGB');curve.color_ramp.elements[0].position=.49;curve.color_ramp.elements[1].position=.535
        links.new(geo.outputs['Pointiness'],curve.inputs[0])
        mul=nodes.new('ShaderNodeMath');mul.operation='MULTIPLY';links.new(curve.outputs['Color'],mul.inputs[0]);links.new(noise.outputs['Fac'],mul.inputs[1])
        chips=nodes.new('ShaderNodeMixRGB');links.new(mul.outputs[0],chips.inputs[0]);links.new(final,chips.inputs[1]);chips.inputs[2].default_value=(*lib.srgb('#737b65'),1)
        final=chips.outputs[0]
        sep=nodes.new('ShaderNodeSeparateXYZ');links.new(geo.outputs['Position'],sep.inputs[0])
        low=nodes.new('ShaderNodeMath');low.operation='SUBTRACT';low.use_clamp=True;low.inputs[0].default_value=.90;links.new(sep.outputs['Z'],low.inputs[1])
        dust=nodes.new('ShaderNodeMath');dust.operation='MULTIPLY';links.new(low.outputs[0],dust.inputs[0]);dust.inputs[1].default_value=.42
        dirty=nodes.new('ShaderNodeMixRGB');links.new(dust.outputs[0],dirty.inputs[0]);links.new(final,dirty.inputs[1]);dirty.inputs[2].default_value=(*lib.srgb('#85816b'),1);final=dirty.outputs[0]
        images=[n for n in nodes if n.type=='TEX_IMAGE']
        if images:
            bump=nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.2;bump.inputs['Distance'].default_value=.003
            links.new(images[0].outputs['Color'],bump.inputs['Height']);links.new(bump.outputs[0],bsdf.inputs['Normal'])
    links.new(final,emit.inputs['Color'])
    orm=nodes.new('ShaderNodeEmission');orm.name='SurfaceORM'
    orm.inputs['Color'].default_value=(1,bsdf.inputs['Roughness'].default_value,bsdf.inputs['Metallic'].default_value,1)
    links.new(bsdf.outputs[0],output.inputs['Surface'])


def bake(objects,asset):
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=1
    scene.cycles.use_denoising=False;scene.render.bake.target='IMAGE_TEXTURES';scene.render.bake.margin=6
    scene.render.bake.normal_space='TANGENT'
    folder=os.path.join(lib.OUT,'vehicles','surfaces',asset);os.makedirs(folder,exist_ok=True)
    wheel=None
    for obj in objects:
        if obj.type!='MESH':continue
        if obj.name.startswith('wheel_') and wheel:
            obj.data=wheel.data.copy();continue
        bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
        materials=list(obj.data.materials)
        for material in materials:surface_graph(material)
        source_uv=obj.data.uv_layers.active;source_uv.name='UVMap'
        target_uv=obj.data.uv_layers.new(name='BakedUV');obj.data.uv_layers.active=target_uv
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(68),island_margin=.002,area_weight=1)
        bpy.ops.object.mode_set(mode='OBJECT')
        size=2048 if obj.name=='body' else 512 if obj.name.startswith('wheel_') else 1024
        maps={}
        for suffix,kind,shader,resolution in [('c','EMIT','SurfaceAlbedo',size),('n','NORMAL','Principled BSDF',min(1024,size)),('orm','EMIT','SurfaceORM',min(1024,size))]:
            image=bpy.data.images.new(asset+'_'+obj.name+'_'+suffix,width=resolution,height=resolution,alpha=False)
            image.colorspace_settings.name='sRGB' if suffix=='c' else 'Non-Color'
            targets=[]
            for material in materials:
                nodes,links=material.node_tree.nodes,material.node_tree.links
                links.new(nodes[shader].outputs[0],nodes['Material Output'].inputs['Surface'])
                target=nodes.new('ShaderNodeTexImage');target.image=image;nodes.active=target;targets.append((nodes,target))
            bpy.ops.object.bake(type=kind)
            image.filepath_raw=os.path.join(folder,obj.name+'_'+suffix+'.jpg');image.file_format='JPEG';image.save()
            maps[suffix]=image
            for nodes,target in targets:nodes.remove(target)
        material=lib.mat(asset+'_'+obj.name+'_surface',(1,1,1),rough=1)
        nodes,links=material.node_tree.nodes,material.node_tree.links
        for suffix in ('c','n','orm'):
            node=nodes.new('ShaderNodeTexImage');node.image=maps[suffix]
            if suffix=='c':links.new(node.outputs['Color'],nodes['Principled BSDF'].inputs['Base Color'])
            elif suffix=='n':
                normal=nodes.new('ShaderNodeNormalMap');links.new(node.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs[0],nodes['Principled BSDF'].inputs['Normal'])
            else:
                sep=nodes.new('ShaderNodeSeparateColor');sep.mode='RGB';links.new(node.outputs['Color'],sep.inputs[0])
                links.new(sep.outputs['Green'],nodes['Principled BSDF'].inputs['Roughness']);links.new(sep.outputs['Blue'],nodes['Principled BSDF'].inputs['Metallic'])
        obj.data.materials.clear();obj.data.materials.append(material)
        for polygon in obj.data.polygons:polygon.material_index=0
        for color in list(obj.data.color_attributes):obj.data.color_attributes.remove(color)
        obj.data.uv_layers.remove(obj.data.uv_layers.get('UVMap'))
        obj.data.uv_layers.active=obj.data.uv_layers.get('BakedUV')
        obj.data.uv_layers.active.active_render=True
        if obj.name.startswith('wheel_'):wheel=obj
        print('BAKED VEHICLE SURFACE:',asset,obj.name,flush=True)
