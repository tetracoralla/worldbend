"""Editable original scene; run with Blender --background --factory-startup --python.
No scene code or geometry is downloaded. glTF owns imported scene transforms.
"""
import bpy, math, sys, argparse, json, hashlib, struct
from pathlib import Path
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).resolve().parent))
from portable_source import prepare_portable_source
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--artwork',required=True);p.add_argument('--direction',choices=['micro-stage','editions'],default='micro-stage');p.add_argument('--revision',type=int,default=1);p.add_argument('--render',action='store_true');a=p.parse_args(args)
out=Path(a.output).resolve();out.mkdir(parents=True,exist_ok=True);art=Path(a.artwork).resolve()
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.render.resolution_x=1200;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.render.fps=24;scene.frame_start=1;scene.frame_end=96;scene.render.engine='CYCLES';scene.cycles.samples=32
scene.world.use_nodes=True;world=scene.world.node_tree.nodes.get('Background');world.inputs['Color'].default_value=(.66,.61,.48,1);world.inputs['Strength'].default_value=.45;scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG'
def material(name,rgb,rough=.7,metal=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*rgb,1);bs.inputs['Roughness'].default_value=rough;bs.inputs['Metallic'].default_value=metal;return m
paper=material('Warm paper',(0.74,.70,.57));pages=material('Page edges',(.84,.80,.66),.85);dark=material('Forest ink',(.027,.090,.071));brass=material('Brass bookmark',(.39,.26,.065),.35,.65)
def printed(name,file):
 m=material(name,(1,1,1));im=bpy.data.images.load(str(art/file),check_existing=True);tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=im;bs=m.node_tree.nodes.get('Principled BSDF');m.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color']);return m
cover=printed('CoverPrint','cover.png');back=printed('BackPrint','back.png')
def cube(name,loc,size,mat,parent=None,bevel=0):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 o.data.materials.append(mat)
 if bevel:
  mod=o.modifiers.new('Paper edge','BEVEL');mod.width=bevel;mod.segments=3
  o.modifiers.new('Surface normals','WEIGHTED_NORMAL')
 if parent:o.parent=parent
 return o
def plane(name,verts,mat,parent=None):
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],[(0,1,2,3)]);mesh.update();o=bpy.data.objects.new(name,mesh);scene.collection.objects.link(o);o.data.materials.append(mat)
 uv=mesh.uv_layers.new(name='UVMap')
 for i,v in enumerate([(0,0),(1,0),(1,1),(0,1)]):uv.data[i].uv=v
 if parent:o.parent=parent
 return o
def book(name,loc,rot):
 o=bpy.data.objects.new(name,None);scene.collection.objects.link(o);o.location=loc;o.rotation_euler=rot;o['worldbend_object']=name
 cube(name+'_pages',(0,0,.142),(.207,.014,.278),pages,o,.0007)
 cube(name+'_front',(0,-.0092,.142),(.216,.0026,.288),dark,o,.001)
 cube(name+'_back',(0,.0092,.142),(.216,.0026,.288),dark,o,.001)
 front=plane(name+'_artwork',[(-.106,-.0106,.001),(.106,-.0106,.001),(.106,-.0106,.283),(-.106,-.0106,.283)],cover,o);front['worldbend_slot']='cover'
 plane(name+'_backprint',[(.106,.0106,.001),(-.106,.0106,.001),(-.106,.0106,.283),(.106,.0106,.283)],back,o)
 # Physical individual page-edge impressions on the exposed right edge.
 for i in range(16):cube(name+'_page_'+str(i),(.1041,-.0065+i*.00082,.142),(.00012,.0001,.274),paper,o)
 cube(name+'_spine',(-.107,0,.142),(.004,.021,.287),dark,o,.0008)
 return o
cube('Stage', (0,.025,-.017),(5,5,.03),paper,bevel=.004)
if a.direction=='micro-stage':
 cube('Paper plinth',(0,0,.01),(.25,.09,.025),pages,bevel=.001)
 book('Edition',(.015,.005,.024),(0,0,0))
 # A bent paper backdrop, actual geometry rather than a background bitmap.
 verts=[];faces=[]
 for i in range(41):
  t=i/40;theta=t*math.pi;x=.19*math.cos(theta);z=.33*math.sin(theta)
  verts.extend([(x,.070,z),(x,.135,z)])
  if i:faces.append((2*i-2,2*i-1,2*i+1,2*i))
 mesh=bpy.data.meshes.new('Paper ribbon');mesh.from_pydata(verts,[],faces);mesh.update();r=bpy.data.objects.new('Paper ribbon',mesh);scene.collection.objects.link(r);r.data.materials.append(pages);solid=r.modifiers.new('Paper thickness','SOLIDIFY');solid.thickness=.0012
 # The paper lifts from a resting ribbon into the authored arch. glTF carries
 # morph weights and camera motion in one scene clip, rather than baked frames.
 r.shape_key_add(name='Basis');rest=r.shape_key_add(name='Resting')
 for vertex in rest.data:
  height=vertex.co.z;vertex.co.z=.001;vertex.co.y+=height*.65
 for frame,value in [(1,1),(40,.15),(64,0),(96,0)]:
  rest.value=value;rest.keyframe_insert(data_path='value',frame=frame)
 # Authored small bookmark ribbon gives a directional accent on the ground.
 plane('Bookmark',[(-.17,-.035,.0001),(-.055,-.085,.0001),(-.044,-.065,.0001),(-.16,-.017,.0001)],brass)
else:
 for i in range(3):
  x=(i-1)*.19;y=(i-1)*.025;h=.012+i*.022
  cube('Plinth_'+str(i),(x,y,h/2),(.175,.10,h),pages,bevel=.0009)
  b=book('Edition_'+str(i),(x,y,h),(-.035,0,-.13+i*.10));b.scale=(.72,.72,.72)
# Directional light is glTF KHR_lights_punctual; no unavailable area shader.
data=bpy.data.lights.new('Sunlight','SUN');data.energy=3.2;data.angle=.14
sun=bpy.data.objects.new('Sunlight',data);scene.collection.objects.link(sun);sun.rotation_euler=(math.radians(27),math.radians(-30),math.radians(-34));sun['worldbend_shadow']=True
filldata=bpy.data.lights.new('Fill','POINT');filldata.energy=8;filldata.color=(.75,.86,1);fill=bpy.data.objects.new('Fill',filldata);scene.collection.objects.link(fill);fill.location=(-.3,-.35,.48)
camdata=bpy.data.cameras.new('RevealCamera');cam=bpy.data.objects.new('RevealCamera',camdata);scene.collection.objects.link(cam);scene.camera=cam;camdata.type='PERSP';camdata.lens=70
poses=[(1,(.18,-1.04,.167)),(40,(-.11,-1.05,.167)),(96,(-.25,-1.04,.167))]
if a.revision==2:poses=[(1,(.22,-1.08,.167)),(40,(-.095,-1.06,.167)),(96,(-.23,-1.05,.167))]
if a.direction=='editions':poses=[(frame,tuple(v*1.65 for v in pos)) for frame,pos in poses]
target=Vector((.015,.005,.167 if a.direction=='micro-stage' else .12))
for frame,location in poses:
 cam.location=location;cam.rotation_euler=(target-Vector(location)).to_track_quat('-Z','Y').to_euler();cam.keyframe_insert(data_path='location',frame=frame);cam.keyframe_insert(data_path='rotation_euler',frame=frame)
frontdata=bpy.data.cameras.new('FrontCamera');front=bpy.data.objects.new('FrontCamera',frontdata);scene.collection.objects.link(front);frontdata.type='ORTHO';frontdata.ortho_scale=.48;front.location=(.015,-1.05,.167);front.rotation_euler=(Vector((.015,.005,.167))-front.location).to_track_quat('-Z','Y').to_euler()
scene.frame_set(40)
# Pack authored print into the editable source, so moving the work cannot
# silently fall back to machine-local image paths.
prepare_portable_source(bpy)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'scene.blend'),compress=True)
bpy.ops.export_scene.gltf(filepath=str(out/'scene.glb'),export_format='GLB',export_import_convert_lighting_mode='COMPAT',export_cameras=True,export_lights=True,export_extras=True,export_yup=True,export_animations=True,export_animation_mode='SCENE',export_force_sampling=True,export_frame_range=True,export_anim_scene_split_object=False)
binary=(out/'scene.glb').read_bytes();scene_json=json.loads(binary[20:20+struct.unpack_from('<I',binary,12)[0]])
assert len(scene_json.get('animations',[]))==1, 'Export must retain camera and paper in one clip'
recipe={'schema':'worldbend.scene-production-evidence','version':'0.1','direction':a.direction,'revision':a.revision,'blenderVersion':bpy.app.version_string,'gltf':'scene.glb','lightingExport':'COMPAT','camera':'RevealCamera','animation':scene_json['animations'][0]['name'],'slotMaterial':'CoverPrint','authoredFps':24,'frameCount':96,'posterFrame':39,'background':'#d1ccb4','sourceSha256':hashlib.sha256((out/'scene.blend').read_bytes()).hexdigest(),'gltfSha256':hashlib.sha256((out/'scene.glb').read_bytes()).hexdigest(),'artworkSha256':hashlib.sha256((art/'cover.png').read_bytes()).hexdigest(),'losses':['Blender AgX/Cycles is a production reference; Three rendering uses its own declared color/shadow pipeline','COMPAT unitless lighting export is explicitly selected for the real-time receiver; physical lux/candela parity is not claimed', 'Directional light angular softness and Cycles world illumination are not standard glTF fields']}
(out/'production.json').write_text(json.dumps(recipe,indent=2)+'\n')
if a.render:
 scene.render.filepath=str(out/'poster.png');bpy.ops.render.render(write_still=True)
print('WORLDBEND_SCENE',json.dumps(recipe))
