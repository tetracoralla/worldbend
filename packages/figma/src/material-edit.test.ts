import { afterEach, describe, expect, it, vi } from "vitest";
import { applyMaterialEdit } from "./material-edit";
import { BUILTIN_APPEARANCE_RECIPES } from "./appearance-wire";
import { BUILTIN_TEXTURE_RECIPES } from "./texture-wire";
import { isMaterialEdit, isSavedMaterial } from "./material-edit-wire";
const glass = BUILTIN_APPEARANCE_RECIPES[0]!,
  texture = BUILTIN_TEXTURE_RECIPES[0]!;
function node(id: string, depth: number) {
  const data = new Map([["appearance", JSON.stringify(glass)]]);
  return {
    id,
    name: id,
    type: "RECTANGLE",
    removed: false,
    fills: [],
    parent: { id: "page" },
    relativeTransform: [
      [1, 0, 0],
      [0, 1, 0],
    ],
    effects: [
      { type: "DROP_SHADOW", radius: 7 },
      { type: "GLASS", ...glass.material, depth, splay: 0.2 },
    ],
    getSharedPluginData: (_ns: string, key: string) => data.get(key) ?? "",
    getPluginData: () => "",
    setSharedPluginData: (_ns: string, key: string, value: string) =>
      data.set(key, value),
    data,
  } as unknown as SceneNode & { data: Map<string, string> };
}
afterEach(() => vi.unstubAllGlobals());
describe("material selection edits", () => {
  it("changes only the requested field across mixed native looks, preserving seed, extras and other effects", () => {
    const a = node("a", 2),
      b = node("b", 18);
    const result = applyMaterialEdit([a, b], {
      family: "glass",
      recipe: glass,
      material: { ...glass.material, radius: 8 },
      fields: ["radius"],
    });
    expect(result.ok).toBe(true);
    expect((a as any).effects[1]).toMatchObject({
      radius: 8,
      depth: 2,
      splay: 0.2,
    });
    expect((b as any).effects[1]).toMatchObject({
      radius: 8,
      depth: 18,
      splay: 0.2,
    });
    expect((a as any).effects[0]).toEqual({ type: "DROP_SHADOW", radius: 7 });
    expect(a.data.get("appearance")).toBe(JSON.stringify(glass));
  });
  it("choosing a new look replaces its owned values and keeps compatible texture", () => {
    const a = node("a", 18);
    (a as any).effects.push({ type: "NOISE", density: 0.6, noiseSize: 5 });
    const chosen = BUILTIN_APPEARANCE_RECIPES[1]!;
    expect(
      applyMaterialEdit([a], {
        family: "glass",
        recipe: chosen,
        material: chosen.material,
      }).ok,
    ).toBe(true);
    expect((a as any).effects[1]).toMatchObject(chosen.material);
    expect((a as any).effects[2].density).toBe(0.6);
  });
  it("removes only the chosen family and leaves its recoverable provenance", () => {
    const a = node("a", 2);
    (a as any).effects.push({ type: "NOISE", density: 0.6, noiseSize: 5 });
    expect(
      applyMaterialEdit([a], {
        family: "glass",
        recipe: glass,
        material: glass.material,
        remove: true,
      }).ok,
    ).toBe(true);
    expect((a as any).effects.map((e: any) => e.type)).toEqual([
      "DROP_SHADOW",
      "NOISE",
    ]);
    expect(a.data.get("appearance")).toBe(JSON.stringify(glass));
  });
  it("rolls back earlier targets and a setter that fails after writing", () => {
    const a = node("a", 2),
      b = node("b", 18),
      beforeA = JSON.stringify((a as any).effects),
      beforeB = JSON.stringify((b as any).effects);
    const real = b.setSharedPluginData.bind(b);
    let fail = true;
    b.setSharedPluginData = (ns, key, value) => {
      real(ns, key, value);
      if (fail) {
        fail = false;
        throw Error("host");
      }
    };
    const result = applyMaterialEdit([a, b], {
      family: "glass",
      recipe: glass,
      material: { ...glass.material, radius: 8 },
    });
    expect(result).toMatchObject({ ok: false, unrestoredNodeIds: [] });
    expect(JSON.stringify((a as any).effects)).toBe(beforeA);
    expect(JSON.stringify((b as any).effects)).toBe(beforeB);
  });
  it("rejects cross-family fields, duplicate patches and unknown request fields", () => {
    expect(
      isMaterialEdit({
        family: "texture",
        recipe: texture,
        material: texture.material,
        fields: ["depth"],
      }),
    ).toBe(false);
    expect(
      isMaterialEdit({
        family: "glass",
        recipe: glass,
        material: glass.material,
        fields: ["radius", "radius"],
      }),
    ).toBe(false);
    expect(
      isMaterialEdit({
        family: "glass",
        recipe: glass,
        material: glass.material,
        extra: 1,
      }),
    ).toBe(false);
    expect(
      isSavedMaterial({
        name: "My look",
        edit: { family: "glass", recipe: glass, material: glass.material },
      }),
    ).toBe(true);
    expect(
      isSavedMaterial({
        name: "My look",
        edit: {
          family: "glass",
          recipe: glass,
          material: glass.material,
          fields: ["radius"],
        },
      }),
    ).toBe(false);
  });
});
