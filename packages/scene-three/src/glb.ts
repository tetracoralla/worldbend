/** Bounded admission before the adopted loader runs. The initial carrier admits
 * self-contained GLB; external resources need an explicit resolver in a later
 * profile, not an implicit network read from editable asset bytes. */
export function inspectPng(bytes: ArrayBuffer, maxPixels = 64 * 1024 * 1024) {
  return inspectPngView(new DataView(bytes), maxPixels);
}
function inspectPngView(png: DataView, maxPixels = 64 * 1024 * 1024) {
  if (png.byteLength < 24) throw Error("Invalid PNG artwork");
  if (
    png.getUint32(0) !== 0x89504e47 ||
    png.getUint32(4) !== 0x0d0a1a0a ||
    png.getUint32(12) !== 0x49484452
  )
    throw Error("This scene profile receives PNG textures");
  const width = png.getUint32(16),
    height = png.getUint32(20);
  if (
    !width ||
    !height ||
    Math.max(width, height) > 8192 ||
    width * height > maxPixels
  )
    throw Error("Decoded image exceeds receiving budget");
  return width * height;
}
export function inspectGlb(bytes: ArrayBuffer) {
  if (bytes.byteLength < 20 || bytes.byteLength > 64 * 1024 * 1024)
    throw Error("Use a bounded self-contained GLB");
  const v = new DataView(bytes);
  if (
    v.getUint32(0, true) !== 0x46546c67 ||
    v.getUint32(4, true) !== 2 ||
    v.getUint32(8, true) !== bytes.byteLength ||
    v.getUint32(16, true) !== 0x4e4f534a
  )
    throw Error("Invalid GLB header");
  const size = v.getUint32(12, true);
  if (
    size < 2 ||
    size % 4 !== 0 ||
    size > 4 * 1024 * 1024 ||
    20 + size > bytes.byteLength
  )
    throw Error("Invalid GLB scene record");
  const json = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array(bytes, 20, size),
    ),
  );
  if (
    json.asset?.version !== "2.0" ||
    !Array.isArray(json.nodes) ||
    json.nodes.length > 20000 ||
    !Array.isArray(json.scenes)
  )
    throw Error("Unsupported or excessive scene graph");
  if (!json.scenes.length || json.scenes.length > 32)
    throw Error("Loaded scenes exceed receiving budget");
  for (const resource of [...(json.buffers ?? []), ...(json.images ?? [])])
    if (resource.uri !== undefined)
      throw Error("GLB external resources need an explicit resolver");
  const bin = 28 + size;
  if (
    bin > bytes.byteLength ||
    v.getUint32(24 + size, true) !== 0x004e4942 ||
    v.getUint32(20 + size, true) !== bytes.byteLength - bin
  )
    throw Error("Invalid GLB binary resource");
  // GLTFLoader copies each referenced buffer view before constructing an
  // accessor. A small accessor must not hide a large overlapping slice.
  let bufferViewBytes = 0;
  for (const view of json.bufferViews ?? []) {
    const start = view.byteOffset ?? 0;
    if (view.buffer !== 0 || !Number.isSafeInteger(start) || start < 0 ||
        !Number.isSafeInteger(view.byteLength) || view.byteLength < 1 ||
        start + view.byteLength > bytes.byteLength - bin)
      throw Error("Invalid buffer view range");
    bufferViewBytes += view.byteLength;
    if (bufferViewBytes > 128 * 1024 * 1024)
      throw Error("Copied scene buffer views exceed receiving budget");
  }
  let decodedPixels = 0, encodedImageBytes = 0;
  for (const image of json.images ?? []) {
    const view = json.bufferViews?.[image.bufferView];
    if (
      !view ||
      view.buffer !== 0 ||
      !Number.isSafeInteger(view.byteLength) ||
      view.byteLength < 24 ||
      !Number.isSafeInteger(view.byteOffset ?? 0) ||
      (view.byteOffset ?? 0) < 0
    )
      throw Error("Invalid embedded image");
    const start = bin + (view.byteOffset ?? 0);
    if (start + view.byteLength > bytes.byteLength)
      throw Error("Image resource lies outside the GLB");
    encodedImageBytes += view.byteLength;
    if (encodedImageBytes > 128 * 1024 * 1024)
      throw Error("Embedded scene image copies exceed receiving byte budget");
    decodedPixels += inspectPngView(new DataView(bytes, start, view.byteLength));
    if (decodedPixels > 64 * 1024 * 1024)
      throw Error("Decoded scene images exceed receiving budget");
  }
  const allowed = new Set([
    "KHR_lights_punctual",
    "KHR_materials_unlit",
    "KHR_materials_ior",
    "KHR_materials_transmission",
    "KHR_materials_volume",
    "KHR_materials_clearcoat",
    "KHR_materials_sheen",
    "KHR_materials_specular",
    "KHR_texture_transform",
  ]);
  for (const key of new Set([
    ...(json.extensionsRequired ?? []),
    ...(json.extensionsUsed ?? []),
  ]))
    if (!allowed.has(key))
      throw Error(
        "A scene extension is unavailable in this receiving profile: " + key,
      );
  const components: Record<string, number> = {
      SCALAR: 1,
      VEC2: 2,
      VEC3: 3,
      VEC4: 4,
      MAT2: 4,
      MAT3: 9,
      MAT4: 16,
    },
    widths: Record<number, number> = {
      5120: 1,
      5121: 1,
      5122: 2,
      5123: 2,
      5125: 4,
      5126: 4,
    };
  let accessorBytes = 0;
  for (const a of json.accessors ?? []) {
    if (
      !Number.isSafeInteger(a.count) ||
      a.count < 1 ||
      typeof a.type !== "string" || !Object.hasOwn(components, a.type) ||
      !Number.isSafeInteger(a.componentType) || !Object.hasOwn(widths, a.componentType)
    )
      throw Error("Invalid accessor");
    accessorBytes += a.count * components[a.type] * widths[a.componentType];
    if (accessorBytes > 128 * 1024 * 1024)
      throw Error("Expanded scene accessors exceed receiving budget");
  }
  let vertices = 0, morphTextureBytes = 0;
  for (const mesh of json.meshes ?? [])
    for (const p of mesh.primitives ?? []) {
      const accessor = json.accessors?.[p.attributes?.POSITION];
      if (
        !accessor ||
        !Number.isSafeInteger(accessor.count) ||
        accessor.count < 1
      )
        throw Error("Invalid mesh positions");
      vertices += accessor.count;
      if (vertices > 2_000_000)
        throw Error("Scene mesh exceeds receiving budget");
      if (p.targets !== undefined) {
        if (!Array.isArray(p.targets)) throw Error("Invalid morph targets");
        let stride = 0;
        for (const target of p.targets) {
          if (!target || typeof target !== "object" || Array.isArray(target))
            throw Error("Invalid morph target");
          for (const [semantic, slots] of [["POSITION", 1], ["NORMAL", 2], ["COLOR_0", 3]] as const) {
            if (target[semantic] === undefined) continue;
            const index = target[semantic], data = json.accessors?.[index];
            if (!Number.isSafeInteger(index) || !data || data.count !== accessor.count)
              throw Error("Invalid morph target accessor");
            stride = Math.max(stride, slots);
          }
        }
        // Three packs every target into Float32 RGBA layers, even when targets
        // share an accessor. Texture-row padding is less than one extra row,
        // so twice the unpadded size bounds the device-dependent allocation.
        morphTextureBytes += 2 * accessor.count * stride * 16 * p.targets.length;
        if (morphTextureBytes > 128 * 1024 * 1024)
          throw Error("Expanded morph textures exceed receiving budget");
      }
    }
  const meshVertices = (json.meshes ?? []).map((m: any) =>
    (m.primitives ?? []).reduce(
      (sum: number, p: any) =>
        sum + json.accessors[p.attributes.POSITION].count,
      0,
    ),
  );
  const parents = new Array<number>(json.nodes.length).fill(0);
  const lights = json.extensions?.KHR_lights_punctual?.lights ?? [];
  for (const node of json.nodes) {
    if (node.mesh !== undefined) {
      if (
        !Number.isSafeInteger(node.mesh) ||
        meshVertices[node.mesh] === undefined
      )
        throw Error("Invalid mesh reference");
    }
    if (node.children !== undefined && !Array.isArray(node.children))
      throw Error("Invalid scene hierarchy");
    for (const child of node.children ?? []) {
      if (!Number.isSafeInteger(child) || !json.nodes[child] || ++parents[child] !== 1)
        throw Error("Invalid scene hierarchy: each child needs one parent");
    }
    const light = node.extensions?.KHR_lights_punctual?.light;
    if (light !== undefined && (!Number.isSafeInteger(light) || !lights[light] ||
        !["directional", "point", "spot"].includes(lights[light].type)))
      throw Error("Invalid scene light reference");
  }
  // Cache subtree height, not a visited flag: an earlier visit to a child must
  // never conceal a deeper path from a later root. glTF children form trees.
  type Work = { depth: number; nodes: number; vertices: number; lights: number; shadows: number };
  const active = new Set<number>(), work = new Map<number, Work>();
  function visit(i: number, pathDepth = 0): Work {
    if (pathDepth > 128 || !Number.isSafeInteger(i) || !json.nodes[i] || active.has(i))
      throw Error("Invalid or cyclic scene hierarchy");
    const cached = work.get(i);
    if (cached) return cached;
    active.add(i);
    const node = json.nodes[i], light = lights[node.extensions?.KHR_lights_punctual?.light];
    const result: Work = { depth: 0, nodes: 1, vertices: node.mesh === undefined ? 0 : meshVertices[node.mesh],
      lights: light ? 1 : 0, shadows: light?.type === "directional" ? 1 : 0 };
    for (const child of node.children ?? []) {
      const next = visit(child, pathDepth + 1);
      result.depth = Math.max(result.depth, next.depth + 1);
      result.nodes += next.nodes;
      result.vertices += next.vertices;
      result.lights += next.lights;
      result.shadows += next.shadows;
    }
    if (result.depth > 128) throw Error("Invalid scene hierarchy depth");
    active.delete(i);
    work.set(i, result);
    return result;
  }
  json.nodes.forEach((_: unknown, i: number) => visit(i, 0));
  // GLTFLoader loads every scene and clones shared roots. Account that actual
  // expansion, including shadow surfaces, before it creates those resources.
  let loadedNodes = 0, instancedVertices = 0, lightInstances = 0, shadowInstances = 0;
  for (const scene of json.scenes) {
    if (scene.nodes !== undefined && !Array.isArray(scene.nodes))
      throw Error("Invalid scene hierarchy roots");
    const roots = new Set<number>();
    for (const root of scene.nodes ?? []) {
      if (!Number.isSafeInteger(root) || !json.nodes[root] || parents[root] || roots.has(root))
        throw Error("Invalid scene hierarchy roots");
      roots.add(root);
      const tree = visit(root);
      loadedNodes += tree.nodes;
      instancedVertices += tree.vertices;
      lightInstances += tree.lights;
      shadowInstances += tree.shadows;
    }
  }
  if (loadedNodes > 20000) throw Error("Loaded scene nodes exceed receiving budget");
  if (instancedVertices > 2_000_000) throw Error("Instanced scene geometry exceeds receiving budget");
  if (lightInstances > 16) throw Error("Scene lights exceed receiving budget");
  if (shadowInstances > 4) throw Error("Directional shadow maps exceed receiving budget");
  return { gltf: json, decodedPixels, vertices, instancedVertices, loadedNodes, lightInstances, shadowInstances, bufferViewBytes, encodedImageBytes, morphTextureBytes };
}
