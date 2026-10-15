/** A small standard skin, with no external resources or image decoding. The
 * loader creates its SkinnedMesh before binding its Skeleton in loadNode. */
export function skinnedSceneGlb() {
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 2] }],
    nodes: [{ mesh: 0, skin: 0, children: [1] }, { name: 'Joint' },
      { name: 'Camera', camera: 0, translation: [0, 0, 2] }],
    cameras: [{ type: 'perspective', perspective: { yfov: 1, znear: .01 } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 }, material: 0 }] }],
    materials: [{ name: 'Skin', pbrMetallicRoughness: { baseColorFactor: [.8, .2, .1, 1] } }],
    skins: [{ joints: [1], skeleton: 1 }], buffers: [{ byteLength: 96 }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 12 },
      { buffer: 0, byteOffset: 48, byteLength: 48 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-.5, -.5, 0], max: [.5, .5, 0] },
      { bufferView: 1, componentType: 5121, count: 3, type: 'VEC4' }, { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' }],
  };
  const text = new TextEncoder().encode(JSON.stringify(json)), size = Math.ceil(text.length / 4) * 4,
    bytes = new Uint8Array(28 + size + 96), view = new DataView(bytes.buffer);
  for (const [offset, value] of [[0, 0x46546c67], [4, 2], [8, bytes.length], [12, size], [16, 0x4e4f534a],
    [20 + size, 96], [24 + size, 0x004e4942]]) view.setUint32(offset, value, true);
  bytes.fill(32, 20, 20 + size); bytes.set(text, 20);
  [-.5, -.5, 0, .5, -.5, 0, 0, .5, 0].forEach((v, i) => view.setFloat32(28 + size + i * 4, v, true));
  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0].forEach((v, i) => view.setFloat32(28 + size + 48 + i * 4, v, true));
  return bytes;
}
