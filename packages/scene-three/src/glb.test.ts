import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { inspectGlb, inspectPng } from "./glb";
const original = readFileSync(
  new URL(
    "../examples/paper-stage/assets/edition-1/scene-bd6574f41323.glb",
    import.meta.url,
  ),
);
function edited(change: (json: any) => void, extra = new Uint8Array()) {
  const bytes = original.buffer.slice(
    original.byteOffset,
    original.byteOffset + original.byteLength,
  );
  const view = new DataView(bytes),
    size = view.getUint32(12, true),
    json = JSON.parse(
      new TextDecoder().decode(new Uint8Array(bytes, 20, size)),
    );
  change(json);
  const text = new TextEncoder().encode(JSON.stringify(json)),
    n = Math.ceil(text.length / 4) * 4,
    bin = new Uint8Array(bytes, 20 + size),
    out = new Uint8Array(20 + n + bin.length + extra.length);
  out.set(new Uint8Array(bytes, 0, 20));
  const v = new DataView(out.buffer);
  v.setUint32(8, out.length, true);
  v.setUint32(12, n, true);
  out.fill(32, 20, 20 + n);
  out.set(text, 20);
  out.set(bin, 20 + n);
  out.set(extra, 20 + n + bin.length);
  v.setUint32(20 + n, bin.length - 8 + extra.length, true);
  return out.buffer;
}
describe("self-contained receiving admission", () => {
  it("admits actual Blender cameras, print and animation", () => {
    const scene = inspectGlb(edited(() => {})).gltf;
    expect(scene.cameras).toHaveLength(2);
    expect(scene.animations[0].name).toBe("Scene");
    expect(
      scene.animations[0].channels.some(
        (c: any) => c.target.path === "weights",
      ),
    ).toBe(true);
    expect(scene.materials.some((m: any) => m.name === "CoverPrint")).toBe(
      true,
    );
  });
  it("rejects hidden external fetches, unsupported required semantics and recursive graphs", () => {
    expect(() =>
      inspectGlb(edited((j) => (j.images[0].uri = "http://127.0.0.1/private"))),
    ).toThrow(/resolver/);
    expect(() =>
      inspectGlb(edited((j) => (j.extensionsRequired = ["unknown"]))),
    ).toThrow(/unavailable/);
    expect(() =>
      inspectGlb(edited((j) => (j.nodes[0].children = [0]))),
    ).toThrow(/cyclic/);
  });
  it("checks decoded-image and declared-geometry budgets before loader allocation", () => {
    expect(() =>
      inspectGlb(
        edited(
          (j) =>
            (j.accessors[j.meshes[0].primitives[0].attributes.POSITION].count =
              2_000_001),
        ),
      ),
    ).toThrow(/budget/);
    expect(() =>
      inspectGlb(
        edited((j) => {
          j.accessors[j.meshes[0].primitives[0].attributes.POSITION].count =
            1_500_000;
          j.nodes[0].mesh = 0;
          j.nodes[1].mesh = 0;
        }),
      ),
    ).toThrow(/Instanced/);
    expect(() =>
      inspectGlb(
        edited((j) =>
          j.accessors.push({
            type: "VEC4",
            componentType: 5126,
            count: 1_000_000_000,
            sparse: { count: 1 },
          }),
        ),
      ),
    ).toThrow(/accessors.*budget/);
    expect(() =>
      inspectGlb(
        edited((j) => (j.extensionsUsed = ["EXT_mesh_gpu_instancing"])),
      ),
    ).toThrow(/unavailable/);
    const png = new ArrayBuffer(24),
      v = new DataView(png);
    v.setUint32(0, 0x89504e47);
    v.setUint32(4, 0x0d0a1a0a);
    v.setUint32(12, 0x49484452);
    v.setUint32(16, 8192);
    v.setUint32(20, 8192);
    expect(() => inspectPng(png, 16_777_216)).toThrow(/budget/);
    expect(() =>
      inspectGlb(
        edited((j) => (j.bufferViews[j.images[0].bufferView].byteOffset = -1)),
      ),
    ).toThrow(/Invalid/);
  });
  it("bounds hierarchy depth independently of node order and rejects multiple parents", () => {
    for (const reverse of [false, true]) {
      expect(() => inspectGlb(edited((j) => {
        j.nodes = Array.from({ length: 130 }, (_, i) => {
          const next = reverse ? i - 1 : i + 1;
          return next < 0 || next >= 130 ? {} : { children: [next] };
        });
        j.scenes = [{ nodes: [reverse ? 129 : 0] }];
      }))).toThrow(/hierarchy/);
    }
    expect(() => inspectGlb(edited((j) => {
      j.nodes = [{ children: [2] }, { children: [2] }, {}];
      j.scenes = [{ nodes: [0, 1] }];
    }))).toThrow(/hierarchy/);
  });
  it("accounts for complete loader expansion across scenes and directional shadow maps", () => {
    expect(() => inspectGlb(edited((j) => {
      j.scenes = Array.from({ length: 1000 }, () => j.scenes[0]);
    }))).toThrow(/budget/);
    expect(() => inspectGlb(edited((j) => {
      j.extensions.KHR_lights_punctual.lights = [{ type: "directional", intensity: 1 }];
      j.nodes = Array.from({ length: 5 }, () => ({ extensions: { KHR_lights_punctual: { light: 0 } } }));
      j.scenes = [{ nodes: [0, 1, 2, 3, 4] }];
    }))).toThrow(/shadow.*budget/);
    const two = inspectGlb(edited((j) => j.scenes.push(structuredClone(j.scenes[0]))));
    const one = inspectGlb(edited(() => {}));
    expect(two.instancedVertices).toBe(one.instancedVertices * 2);
    expect(() => inspectGlb(edited((j) => {
      j.nodes = Array.from({ length: 129 }, (_, i) => i ? { children: [i - 1] } : {});
      j.scenes = [{ nodes: [128] }];
    }))).not.toThrow();
  });
  it("bounds copied buffer views even when tiny accessors reference overlapping storage", () => {
    expect(() => inspectGlb(edited((j) => {
      const view = { buffer: 0, byteOffset: 0, byteLength: j.buffers[0].byteLength };
      for (let n = 0; n < 1000; n++) {
        const bufferView = j.bufferViews.length, position = j.accessors.length;
        j.bufferViews.push(view);
        j.accessors.push({ bufferView, componentType: 5126, type: "VEC3", count: 3 });
        j.meshes[0].primitives.push({ attributes: { POSITION: position } });
      }
    }))).toThrow(/buffer.*budget/i);
    expect(() => inspectGlb(edited((j) => {
      j.bufferViews[0].byteLength = j.buffers[0].byteLength + 8;
    }))).toThrow(/buffer.*range/i);
  });
  it("accounts repeated encoded image copies independently of decoded pixels", () => {
    const padded = new Uint8Array(1024 * 1024);
    padded.set(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=", "base64"));
    const scene = (count: number) => edited((j) => {
      const bufferView = j.bufferViews.length;
      j.bufferViews.push({ buffer: 0, byteOffset: j.buffers[0].byteLength, byteLength: padded.length });
      j.buffers[0].byteLength += padded.length;
      j.images = Array.from({ length: count }, () => ({ bufferView, mimeType: "image/png" }));
    }, padded);
    expect(inspectGlb(scene(128)).encodedImageBytes).toBe(128 * 1024 * 1024);
    expect(() => inspectGlb(scene(129))).toThrow(/image copies.*budget/);
  });
  it("rejects prototype names instead of letting NaN bypass accessor accounting", () => {
    for (const type of ["__proto__", "constructor", "toString"]) {
      expect(() => inspectGlb(edited(j => j.accessors.push({
        type, componentType: 5126, count: 1,
      })))).toThrow(/Invalid accessor/);
    }
    expect(() => inspectGlb(edited(j => j.accessors.push({
      type: "VEC3", componentType: "toString", count: 1,
    })))).toThrow(/Invalid accessor/);
  });
  it("counts rendered morph layers independently of shared accessor storage", () => {
    const expanded = (targets: number) => edited(j => {
      const count = 4096, position = j.accessors.length;
      j.accessors.push({ componentType: 5126, type: "VEC3", count,
        min: [0, 0, 0], max: [0, 0, 0] });
      j.nodes = [{ mesh: 0 }]; j.scenes = [{ nodes: [0] }]; j.animations = [];
      j.meshes = [{ primitives: [{ attributes: { POSITION: position }, mode: 0,
        targets: Array.from({ length: targets }, () => ({ POSITION: position })) }] }];
    });
    expect(inspectGlb(expanded(1024)).morphTextureBytes).toBe(128 * 1024 * 1024);
    expect(() => inspectGlb(expanded(1025))).toThrow(/morph textures.*budget/);
    expect(() => inspectGlb(edited(j => {
      j.meshes[0].primitives[0].targets = [{ POSITION: j.accessors.length }];
    }))).toThrow(/morph target accessor/);
    expect(inspectGlb(edited(() => {})).morphTextureBytes).toBeGreaterThan(0);
  });
});
