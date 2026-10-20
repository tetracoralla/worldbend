import { describe, expect, it } from "vitest";
import {
  BUILTIN_TEXTURE_RECIPES,
  changedTextureFields,
  DEFAULT_TEXTURE_MATERIAL,
  isTextureRecipeWire,
  isTextureMaterialWire,
  parseHexColorWire,
  type TextureMaterialWire,
  type TextureRecipeWire,
} from "./texture-wire";
import { applyTextureToNodes, liveTextureMaterial, SHARED_TEXTURE_KEY, textureNodeSnapshot } from "./texture";

type EffectLike = { type: string } & Record<string, unknown>;

function noiseEffect(overrides: Partial<TextureMaterialWire> = {}, extras: Record<string, unknown> = {}): unknown {
  const material = { ...DEFAULT_TEXTURE_MATERIAL, ...overrides };
  const [red, green, blue] = parseHexColorWire(material.grainColor) ?? [138, 127, 114];
  return {
    type: "NOISE",
    visible: material.visible,
    color: { r: red / 255, g: green / 255, b: blue / 255, a: 1 },
    noiseSize: material.grainSize,
    density: material.grain,
    noiseType: "MONOTONE",
    ...extras,
  };
}

/**
 * Mirrors the real host's strict effect validation so a write that omits a
 * required field (an RGBA color without its alpha channel) fails in tests
 * exactly like it failed in the Figma sandbox on 2026-10-01. The same live
 * session showed the installed host rejects an appended NOISE effect that
 * carries a `blendMode` key, so the writer never emits one itself.
 */
function assertHostEffectShape(effect: EffectLike): void {
  const record = effect as Record<string, unknown>;
  const fail = (why: string) => { throw new Error(`mock host rejected effect: ${why}`); };
  const vector = record.noiseSizeVector as { x: number; y: number } | undefined;
  if (vector && vector.x !== record.noiseSize) fail("noiseSize must match noiseSizeVector.x");
  if (record.type === "NOISE") {
    const color = record.color as Record<string, number> | undefined;
    if (!color || typeof color.r !== "number" || typeof color.g !== "number" ||
        typeof color.b !== "number" || typeof color.a !== "number") fail("NOISE color must be complete RGBA");
    if (typeof record.noiseSize !== "number" || typeof record.density !== "number") fail("NOISE requires noiseSize and density");
    if (record.noiseType === "DUOTONE" && !record.secondaryColor) fail("DUOTONE noise requires secondaryColor");
    if (record.noiseType === "MULTITONE" && typeof record.opacity !== "number") fail("MULTITONE noise requires opacity");
  } else if (record.type === "TEXTURE") {
    if (typeof record.noiseSize !== "number" || typeof record.radius !== "number" ||
        typeof record.clipToShape !== "boolean") fail("TEXTURE requires noiseSize, radius and clipToShape");
  }
}

function textureEffect(overrides: Partial<TextureMaterialWire> = {}): EffectLike {
  const material = { ...DEFAULT_TEXTURE_MATERIAL, ...overrides };
  return {
    type: "TEXTURE",
    visible: material.visible,
    noiseSize: material.etchSize,
    radius: material.etch,
    clipToShape: material.clipToShape,
  };
}

function sceneNode(input: {
  id?: string;
  name?: string;
  type?: string;
  effects?: EffectLike[];
  noEffects?: boolean;
  pluginData?: string;
  removed?: boolean;
  failOnEffectsWrite?: boolean;
}): SceneNode {
  const pluginData = new Map<string, string>();
  if (input.pluginData !== undefined) pluginData.set("shared:" + SHARED_TEXTURE_KEY, input.pluginData);
  let effects: EffectLike[] = input.effects ?? [];
  const node: Record<string, unknown> = {
    id: input.id ?? "10:1",
    name: input.name ?? "Fixture",
    type: input.type ?? "RECTANGLE",
    removed: input.removed ?? false,
    getPluginData(key: string) {
      return pluginData.get(key) ?? "";
    },
    getSharedPluginData(_namespace: string, key: string) { return pluginData.get("shared:" + key) ?? ""; },
    setSharedPluginData(_namespace: string, key: string, value: string) { pluginData.set("shared:" + key, value); },
    setPluginData(key: string, value: string) {
      pluginData.set(key, value);
    },
  };
  if (!input.noEffects) {
    Object.defineProperty(node, "effects", {
      get() {
        return effects;
      },
      set(next: EffectLike[]) {
        if (input.failOnEffectsWrite) throw new Error("effects are locked");
        for (const effect of next) assertHostEffectShape(effect);
        effects = next;
      },
    });
  }
  return node as unknown as SceneNode;
}

const recipe: TextureRecipeWire = BUILTIN_TEXTURE_RECIPES[0]!;

describe("texture wire validation", () => {
  it("ships built-in recipes that satisfy the shared seed contract", () => {
    expect(BUILTIN_TEXTURE_RECIPES.length).toBeGreaterThanOrEqual(3);
    for (const builtin of BUILTIN_TEXTURE_RECIPES) {
      expect(isTextureRecipeWire(builtin)).toBe(true);
    }
  });

  it("rejects out-of-range materials instead of forwarding them to the document", () => {
    expect(isTextureMaterialWire({ ...DEFAULT_TEXTURE_MATERIAL, grain: 1.4 })).toBe(false);
    expect(isTextureMaterialWire({ ...DEFAULT_TEXTURE_MATERIAL, grainSize: 0.2 })).toBe(false);
    expect(isTextureMaterialWire({ ...DEFAULT_TEXTURE_MATERIAL, etch: -1 })).toBe(false);
    expect(isTextureMaterialWire({ ...DEFAULT_TEXTURE_MATERIAL, etchSize: 2000 })).toBe(false);
    expect(isTextureMaterialWire({ ...DEFAULT_TEXTURE_MATERIAL, grainColor: "#ff00zz" })).toBe(false);
    expect(isTextureMaterialWire({ ...DEFAULT_TEXTURE_MATERIAL, grainColor: "ff0000" })).toBe(false);
    const { etch: _etch, ...missingEtch } = DEFAULT_TEXTURE_MATERIAL;
    expect(isTextureMaterialWire(missingEtch)).toBe(false);
    expect(isTextureRecipeWire({ ...recipe, schema: "worldbend.appearance@0.1" })).toBe(false);
    expect(isTextureRecipeWire({ ...recipe, recipeId: "  " })).toBe(false);
    expect(isTextureRecipeWire({ ...recipe, recipeVersion: 0 })).toBe(false);
  });

  it("does not confuse float32 storage or color case with a designer edit", () => {
    const seed = { ...DEFAULT_TEXTURE_MATERIAL };
    expect(changedTextureFields({ ...seed, grain: Math.fround(seed.grain) }, seed)).toEqual([]);
    expect(changedTextureFields({ ...seed, grain: Math.fround(0.35001) }, seed)).toEqual(["grain"]);
    expect(changedTextureFields({ ...seed, grainColor: "#8A7F72" }, seed)).toEqual([]);
    expect(changedTextureFields({ ...seed, grainColor: "#8b7f72" }, seed)).toEqual(["grain-color"]);
  });

  it("reports changed fields in the stable wire order", () => {
    const seed = { ...DEFAULT_TEXTURE_MATERIAL };
    const live: TextureMaterialWire = { ...seed, etch: 4, grain: 0.8 };
    expect(changedTextureFields(live, seed)).toEqual(["grain", "etch"]);
    expect(changedTextureFields(seed, seed)).toEqual([]);
  });
});

describe("textureNodeSnapshot", () => {
  it("reports absent for a plain effect-capable node without noise or texture", () => {
    const snapshot = textureNodeSnapshot(
      sceneNode({ effects: [{ type: "DROP_SHADOW", radius: 4 } as EffectLike] }),
    );
    expect(snapshot.eligible).toBe(true);
    expect(snapshot.state).toBe("absent");
    expect(snapshot.noiseCount).toBe(0);
    expect(snapshot.textureCount).toBe(0);
  });

  it("marks nodes without an effects array ineligible", () => {
    const snapshot = textureNodeSnapshot(sceneNode({ type: "GROUP", noEffects: true }));
    expect(snapshot.eligible).toBe(false);
    expect(snapshot.reason).toBe("no-effects");
  });

  it("keeps untagged native noise inspectable without guessing a preset", () => {
    const snapshot = textureNodeSnapshot(
      sceneNode({ effects: [noiseEffect({ grain: 0.6 }) as EffectLike] }),
    );
    expect(snapshot.state).toBe("untagged-native");
    expect(snapshot.provenance).toBeUndefined();
    expect(snapshot.live?.grain).toBe(0.6);
    expect(snapshot.live?.etch).toBe(0);
  });

  it("reports tagged instances and native edits as the designer's own", () => {
    const tagged = textureNodeSnapshot(
      sceneNode({
        effects: [noiseEffect() as EffectLike, textureEffect() as EffectLike],
        pluginData: JSON.stringify(recipe),
      }),
    );
    expect(tagged.state).toBe("tagged");
    expect(tagged.customized).toEqual([]);
    const customized = textureNodeSnapshot(
      sceneNode({
        effects: [noiseEffect() as EffectLike, textureEffect({ etch: 5 }) as EffectLike],
        pluginData: JSON.stringify(recipe),
      }),
    );
    expect(customized.state).toBe("customized");
    expect(customized.customized).toEqual(["etch"]);
  });

  it("discloses stacked noise or texture instead of guessing", () => {
    const stacked = textureNodeSnapshot(
      sceneNode({ effects: [noiseEffect() as EffectLike, noiseEffect() as EffectLike] }),
    );
    expect(stacked.eligible).toBe(false);
    expect(stacked.reason).toBe("multiple-noise");
    expect(stacked.noiseCount).toBe(2);
    const stackedTexture = textureNodeSnapshot(
      sceneNode({ effects: [textureEffect() as EffectLike, textureEffect() as EffectLike] }),
    );
    expect(stackedTexture.reason).toBe("multiple-texture");
  });

  it("reports native removal with the seed as explicit fallback state", () => {
    const removed = textureNodeSnapshot(
      sceneNode({ pluginData: JSON.stringify(recipe) }),
    );
    expect(removed.state).toBe("removed");
    expect(removed.eligible).toBe(true);
  });

  it("never reclassifies invalid native noise as an absent effect", () => {
    const snapshot = textureNodeSnapshot(
      sceneNode({ effects: [noiseEffect({ grain: 2 }) as EffectLike] }),
    );
    expect(snapshot).toMatchObject({ eligible: false, reason: "invalid-texture", noiseCount: 1 });
  });

  it("rounds float32 color channels back to the authored bytes", () => {
    const node = sceneNode({
      effects: [{
        type: "NOISE",
        visible: true,
        color: { r: Math.fround(0x8a / 255), g: Math.fround(0x7f / 255), b: Math.fround(0x72 / 255) },
        noiseSize: 3,
        density: 0.35,
      } as EffectLike],
    });
    expect(liveTextureMaterial(node as unknown as SceneNode & { effects: Effect[] })?.grainColor)
      .toBe("#8a7f72");
  });
});

describe("applyTextureToNodes", () => {
  it("retains untagged native state under explicit selective edits without creating provenance", () => {
    const node = sceneNode({ effects: [noiseEffect({ grain: .7 }) as EffectLike] });
    expect(applyTextureToNodes([node], recipe, { ...recipe.material, grain: .2 }, ["grain"], true).ok).toBe(true);
    expect(textureNodeSnapshot(node)).toMatchObject({ state: "untagged-native", live: { grain: .2, etch: 0 } });
    expect(textureNodeSnapshot(node).provenance).toBeUndefined();
    expect(applyTextureToNodes([node], recipe, recipe.material, undefined, true).ok).toBe(false);
  });
  it("selectively changes density while preserving split visibility, native colors, sizes, extras and seed", () => {
    const node = sceneNode({ pluginData: JSON.stringify(recipe), effects: [
      noiseEffect({ grain: .7, visible: false }, { noiseType: "DUOTONE", secondaryColor: { r: .2, g: .4, b: .6, a: .3 }, noiseSizeVector: { x: 3, y: 9 } }) as EffectLike,
      textureEffect({ etch: 8, etchSize: 11, visible: true }),
      { type: "DROP_SHADOW", radius: 4 },
    ] });
    const before = structuredClone((node as unknown as { effects: EffectLike[] }).effects);
    expect(applyTextureToNodes([node], recipe, { ...recipe.material, grain: .2 }, ["grain"]).ok).toBe(true);
    expect((node as unknown as { effects: EffectLike[] }).effects).toEqual([{ ...before[0], density: .2 }, before[1], before[2]]);
    expect(textureNodeSnapshot(node).provenance).toEqual(recipe);
  });

  it("adds a missing grain portion from live values and resizes only the selected native size", () => {
    const node = sceneNode({ pluginData: JSON.stringify(recipe), effects: [textureEffect({ etch: 8, etchSize: 11 })] });
    expect(applyTextureToNodes([node], recipe, { ...recipe.material, grain: .2 }, ["grain"]).ok).toBe(true);
    const first = (node as unknown as { effects: EffectLike[] }).effects;
    expect(first[0]).toEqual(textureEffect({ etch: 8, etchSize: 11 }));
    expect(first[1]).toMatchObject({ type: "NOISE", density: .2, noiseSize: 3 });
    first[1]!["noiseSizeVector"] = { x: 3, y: 9 };
    expect(applyTextureToNodes([node], recipe, { ...recipe.material, grainSize: 6 }, ["grain-size"]).ok).toBe(true);
    expect((node as unknown as { effects: EffectLike[] }).effects[1]).toMatchObject({ noiseSize: 6, noiseSizeVector: { x: 6, y: 9 }, density: .2 });
    expect((node as unknown as { effects: EffectLike[] }).effects[0]).toEqual(first[0]);
  });

  it("rejects selective revival and seed changes before changing effects", () => {
    const node = sceneNode({ pluginData: JSON.stringify(recipe), effects: [] });
    expect(applyTextureToNodes([node], recipe, recipe.material, ["grain"]).ok).toBe(false);
    expect((node as unknown as { effects: EffectLike[] }).effects).toEqual([]);
    (node as unknown as { effects: EffectLike[] }).effects = [textureEffect()];
    const before = structuredClone((node as unknown as { effects: EffectLike[] }).effects);
    expect(applyTextureToNodes([node], { ...recipe, recipeVersion: 2 }, recipe.material, ["etch"]).ok).toBe(false);
    expect(applyTextureToNodes([node], recipe, recipe.material, ["etch", "etch"]).ok).toBe(false);
    expect((node as unknown as { effects: EffectLike[] }).effects).toEqual(before);
  });

  it("keeps the preset seed when applying customized values", () => {
    const node = sceneNode({});
    const material = { ...recipe.material, grain: 0.7 };
    expect(applyTextureToNodes([node], recipe, material).ok).toBe(true);
    const state = textureNodeSnapshot(node);
    expect(state.live?.grain).toBe(0.7);
    expect(state.provenance).toEqual(recipe);
    expect(state.customized).toContain("grain");
  });

  it("appends both effects while preserving unrelated effects and their order", () => {
    const shadow = { type: "DROP_SHADOW", radius: 4 } as EffectLike;
    const node = sceneNode({ effects: [shadow] });
    const applied = applyTextureToNodes([node], recipe);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.outcomes).toEqual([
      { nodeId: "10:1", outcome: "applied", replacedUntagged: false },
    ]);
    const effects = (node as unknown as { effects: EffectLike[] }).effects;
    expect(effects).toHaveLength(3);
    expect(effects[0]).toBe(shadow);
    expect(effects[1]).toMatchObject({ type: "NOISE", density: recipe.material.grain });
    expect(effects[2]).toMatchObject({ type: "TEXTURE", radius: recipe.material.etch });
    expect(
      (node as unknown as { getSharedPluginData(namespace: string, key: string): string }).getSharedPluginData(
        "worldbend", SHARED_TEXTURE_KEY,
      ),
    ).toBe(JSON.stringify(recipe));
  });

  it("replaces the owned noise and texture in place, including untagged native ones", () => {
    const shadow = { type: "DROP_SHADOW", radius: 4 } as EffectLike;
    const node = sceneNode({
      effects: [shadow, noiseEffect({ grain: 0.9 }) as EffectLike, textureEffect({ etch: 9 }) as EffectLike],
    });
    const applied = applyTextureToNodes([node], recipe);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.outcomes[0]).toMatchObject({ outcome: "applied", replacedUntagged: true });
    const effects = (node as unknown as { effects: EffectLike[] }).effects;
    expect(effects).toHaveLength(3);
    expect(effects[0]).toBe(shadow);
    expect(effects[1]).toMatchObject({ type: "NOISE", density: recipe.material.grain });
    expect(effects[2]).toMatchObject({ type: "TEXTURE", radius: recipe.material.etch });
  });

  it("does not stack an inert effect for a grain-only or etch-only seed", () => {
    const grainOnly = sceneNode({});
    const grainOnlySeed: TextureRecipeWire = {
      ...recipe,
      material: { ...recipe.material, etch: 0 },
    };
    expect(applyTextureToNodes([grainOnly], grainOnlySeed).ok).toBe(true);
    const grainOnlyEffects = (grainOnly as unknown as { effects: EffectLike[] }).effects;
    expect(grainOnlyEffects).toHaveLength(1);
    expect(grainOnlyEffects[0]?.["type"]).toBe("NOISE");

    const etchOnly = sceneNode({});
    const etchOnlySeed: TextureRecipeWire = {
      ...recipe,
      material: { ...recipe.material, grain: 0 },
    };
    expect(applyTextureToNodes([etchOnly], etchOnlySeed).ok).toBe(true);
    const etchOnlyEffects = (etchOnly as unknown as { effects: EffectLike[] }).effects;
    expect(etchOnlyEffects).toHaveLength(1);
    expect(etchOnlyEffects[0]?.["type"]).toBe("TEXTURE");
  });

  it("preserves native extras such as duotone secondary colors through a write", () => {
    const node = sceneNode({
      effects: [noiseEffect({}, { noiseType: "DUOTONE", secondaryColor: { r: 1, g: 1, b: 1 } }) as EffectLike],
    });
    const snapshotBefore = textureNodeSnapshot(node);
    expect(snapshotBefore.nativeExtras).toMatchObject({ "noise.noiseType": "DUOTONE" });
    expect(applyTextureToNodes([node], recipe).ok).toBe(true);
    const effects = (node as unknown as { effects: EffectLike[] }).effects;
    expect(effects[0]).toMatchObject({ noiseType: "DUOTONE", density: recipe.material.grain });
    expect(effects[0]?.["secondaryColor"]).toEqual({ r: 1, g: 1, b: 1 });
    expect(textureNodeSnapshot(node).nativeExtras).toMatchObject({ "noise.noiseType": "DUOTONE" });
  });

  it("resizes native scalar/vector sizes coherently and retains grain alpha", () => {
    const node = sceneNode({ effects: [
      noiseEffect({}, { noiseSizeVector: { x: 3, y: 3 }, color: { r: .4, g: .3, b: .2, a: .25 } }) as EffectLike,
      { ...textureEffect(), noiseSizeVector: { x: 4, y: 4 } } as EffectLike,
    ] });
    const updated = { ...recipe.material, grainSize: 6, etchSize: 9 };
    expect(applyTextureToNodes([node], recipe, updated).ok).toBe(true);
    expect((node as unknown as { effects: EffectLike[] }).effects).toMatchObject([
      { noiseSize: 6, noiseSizeVector: { x: 6, y: 6 }, color: { a: .25 } },
      { noiseSize: 9, noiseSizeVector: { x: 9, y: 9 } },
    ]);
    expect(textureNodeSnapshot(node).nativeExtras).toMatchObject({ "noise.colorAlpha": .25 });
  });

  it("keeps native anisotropic Y sizes while synchronizing the owned X", () => {
    const node = sceneNode({ effects: [
      noiseEffect({}, { noiseSizeVector: { x: 3, y: 7 } }) as EffectLike,
      { ...textureEffect(), noiseSizeVector: { x: 4, y: 11 } } as EffectLike,
    ] });
    expect(applyTextureToNodes([node], recipe, { ...recipe.material, grainSize: 6, etchSize: 9 }).ok).toBe(true);
    expect((node as unknown as { effects: EffectLike[] }).effects).toMatchObject([
      { noiseSize: 6, noiseSizeVector: { x: 6, y: 7 } },
      { noiseSize: 9, noiseSizeVector: { x: 9, y: 11 } },
    ]);
  });

  it("skips stacked and effect-incapable nodes without touching them", () => {
    const stacked = sceneNode({
      id: "10:2",
      effects: [noiseEffect() as EffectLike, noiseEffect() as EffectLike],
    });
    const before = [...(stacked as unknown as { effects: EffectLike[] }).effects];
    const group = sceneNode({ id: "10:3", type: "GROUP", noEffects: true });
    const applied = applyTextureToNodes([stacked, group], recipe);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.outcomes).toEqual([
      { nodeId: "10:2", outcome: "skipped", reason: "multiple-noise" },
      { nodeId: "10:3", outcome: "skipped", reason: "no-effects" },
    ]);
    expect((stacked as unknown as { effects: EffectLike[] }).effects).toEqual(before);
  });

  it("restores already-changed nodes when a later node fails mid-batch", () => {
    const first = sceneNode({
      id: "10:4",
      effects: [noiseEffect({ grain: 0.9 }) as EffectLike],
    });
    const second = sceneNode({ id: "10:5", failOnEffectsWrite: true });
    const applied = applyTextureToNodes([first, second], recipe);
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.error).toContain("locked");
    const firstEffects = (first as unknown as { effects: EffectLike[] }).effects;
    expect(firstEffects).toHaveLength(1);
    expect(firstEffects[0]).toMatchObject({ type: "NOISE", density: 0.9 });
    expect(
      (first as unknown as { getSharedPluginData(namespace: string, key: string): string }).getSharedPluginData(
        "worldbend", SHARED_TEXTURE_KEY,
      ),
    ).toBe("");
  });

  it("rejects an invalid recipe before touching the document", () => {
    const node = sceneNode({ effects: [noiseEffect() as EffectLike] });
    const applied = applyTextureToNodes(
      [node],
      { ...recipe, material: { ...recipe.material, grainSize: 0.1 } },
    );
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect((node as unknown as { effects: EffectLike[] }).effects).toHaveLength(1);
  });

  it("does not overwrite an invalid native effect during a mixed apply", () => {
    const invalid = sceneNode({ id: "bad", effects: [noiseEffect({ grain: 5 }) as EffectLike] });
    const good = sceneNode({ id: "good" });
    const before = (invalid as unknown as { effects: EffectLike[] }).effects;
    const result = applyTextureToNodes([invalid, good], recipe);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.outcomes).toEqual([
      { nodeId: "bad", outcome: "skipped", reason: "invalid-texture" },
      { nodeId: "good", outcome: "applied", replacedUntagged: false },
    ]);
    expect((invalid as unknown as { effects: EffectLike[] }).effects).toBe(before);
  });
});
