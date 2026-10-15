"""Third author revision of the packed editable paper work; no remote assets.
Blender --background --python revise.py -- --source ... --output ...
"""
import bpy, sys, argparse, json, hashlib, struct
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from portable_source import prepare_portable_source
p = argparse.ArgumentParser()
p.add_argument('--source', required=True)
p.add_argument('--output', required=True)
a = p.parse_args(sys.argv[sys.argv.index('--') + 1:])
bpy.ops.wm.open_mainfile(filepath=str(Path(a.source).resolve()))
out = Path(a.output).resolve()
out.mkdir(parents=True, exist_ok=True)
# Preserve the upright physical cover and FrontCamera proof. Change the authored
# ribbon volume and camera identity, exercising real geometry and renamed nodes.
bpy.data.objects['Paper ribbon'].scale.z = .91
bpy.data.objects['RevealCamera'].name = 'Reveal Camera.003'
bpy.context.scene.camera = bpy.data.objects['Reveal Camera.003']
prepare_portable_source(bpy)
bpy.ops.wm.save_as_mainfile(filepath=str(out / 'scene.blend'), compress=True)
bpy.ops.export_scene.gltf(filepath=str(out / 'scene.glb'), export_format='GLB',
 export_import_convert_lighting_mode='COMPAT', export_cameras=True,
 export_lights=True, export_extras=True, export_yup=True, export_animations=True,
 export_animation_mode='SCENE', export_force_sampling=True, export_frame_range=True,
 export_anim_scene_split_object=False)
binary = (out / 'scene.glb').read_bytes()
gltf = json.loads(binary[20:20 + struct.unpack_from('<I', binary, 12)[0]])
assert len(gltf['animations']) == 1
recipe = {'schema': 'worldbend.scene-production-evidence', 'version': '0.1',
 'revision': 3, 'blenderVersion': bpy.app.version_string,
 'parentSourceSha256': hashlib.sha256(Path(a.source).read_bytes()).hexdigest(),
 'sourceSha256': hashlib.sha256((out / 'scene.blend').read_bytes()).hexdigest(),
 'gltfSha256': hashlib.sha256(binary).hexdigest(),
 'camera': 'Reveal Camera.003', 'animation': gltf['animations'][0]['name'],
 'changes': ['paper ribbon height .91', 'renamed authored reveal camera'],
 'losses': ['COMPAT lighting; no Cycles/AgX visual parity claim']}
(out / 'production.json').write_text(json.dumps(recipe, indent=2) + '\n')
print('WORLDBEND_REVISION', json.dumps(recipe))
