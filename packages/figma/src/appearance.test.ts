import { describe, expect, it } from "vitest";
import {
  BUILTIN_APPEARANCE_RECIPES,
  changedGlassFields,
  DEFAULT_GLASS_MATERIAL,
  isAppearanceRecipeWire,
  isGlassMaterialWire,
  type AppearanceRecipeWire,
  type GlassMaterialWire,
} from "./appearance-wire";
import { appearanceNodeSnapshot, appearancePreviewContext, applyAppearanceToNodes, SHARED_APPEARANCE_KEY } from "./appearance";

type EffectLike = { type: string } & Record<string, unknown>;

function glassEffect(overrides: Partial<GlassMaterialWire> = {}): unknown {
  const material = { ...DEFAULT_GLASS_MATERIAL, ...overrides };
  return {
    type: "GLASS",
    visible: material.visible,
    lightIntensity: material.lightIntensity,
    lightAngle: material.lightAngle,
    refraction: material.refraction,
    depth: material.depth,
    dispersion: material.dispersion,
    radius: material.radius,
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
  if (input.pluginData !== undefined) pluginData.set(SHARED_APPEARANCE_KEY, input.pluginData);
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
        effects = next;
      },
    });
  }
  return node as unknown as SceneNode;
}

const recipe: AppearanceRecipeWire = BUILTIN_APPEARANCE_RECIPES[0]!;

describe("appearance wire validation", () => {
  it("ships built-in recipes that satisfy the shared seed contract", () => {
    expect(BUILTIN_APPEARANCE_RECIPES.length).toBeGreaterThanOrEqual(3);
    for (const builtin of BUILTIN_APPEARANCE_RECIPES) {
      expect(isAppearanceRecipeWire(builtin)).toBe(true);
    }
  });

  it("rejects out-of-range materials instead of forwarding them to the document", () => {
    expect(isGlassMaterialWire({ ...DEFAULT_GLASS_MATERIAL, lightIntensity: 1.2 })).toBe(false);
    expect(isGlassMaterialWire({ ...DEFAULT_GLASS_MATERIAL, lightAngle: 360 })).toBe(false);
    expect(isGlassMaterialWire({ ...DEFAULT_GLASS_MATERIAL, depth: 0.5 })).toBe(false);
    expect(isGlassMaterialWire({ ...DEFAULT_GLASS_MATERIAL, radius: -1 })).toBe(false);
    const { radius: _radius, ...missingRadius } = DEFAULT_GLASS_MATERIAL;
    expect(isGlassMaterialWire(missingRadius)).toBe(false);
    expect(
      isAppearanceRecipeWire({ ...recipe, schema: "worldbend.mockup@0.1" }),
    ).toBe(false);
    expect(isAppearanceRecipeWire({ ...recipe, recipeId: "  " })).toBe(false);
    expect(isAppearanceRecipeWire({ ...recipe, recipeVersion: 0 })).toBe(false);
    expect(isAppearanceRecipeWire({ ...recipe, recipeId: "bad\u0085id" })).toBe(false);
  });

  it("does not confuse float32 storage with a designer edit", () => {
    const seed = { ...DEFAULT_GLASS_MATERIAL };
    expect(changedGlassFields({ ...seed, refraction: Math.fround(seed.refraction) }, seed)).toEqual([]);
    expect(changedGlassFields({ ...seed, refraction: Math.fround(0.35001) }, seed)).toEqual(["refraction"]);
  });

  it("reports changed fields in the stable wire order", () => {
    const seed = { ...DEFAULT_GLASS_MATERIAL };
    const live: GlassMaterialWire = {
      ...seed,
      radius: 40,
      lightAngle: 200,
    };
    expect(changedGlassFields(live, seed)).toEqual(["light-angle", "radius"]);
    expect(changedGlassFields(seed, seed)).toEqual([]);
  });
});

describe("appearanceNodeSnapshot", () => {
  it("reports absent for a plain effect-capable node without glass", () => {
    const snapshot = appearanceNodeSnapshot(
      sceneNode({ effects: [{ type: "DROP_SHADOW", radius: 4 } as EffectLike] }),
    );
    expect(snapshot.eligible).toBe(true);
    expect(snapshot.state).toBe("absent");
    expect(snapshot.glassCount).toBe(0);
  });

  it("marks nodes without an effects array ineligible", () => {
    const snapshot = appearanceNodeSnapshot(sceneNode({ type: "GROUP", noEffects: true }));
    expect(snapshot.eligible).toBe(false);
    expect(snapshot.reason).toBe("no-effects");
  });

  it("keeps untagged native glass inspectable without guessing a preset", () => {
    const snapshot = appearanceNodeSnapshot(
      sceneNode({ effects: [glassEffect({ radius: 31 }) as EffectLike] }),
    );
    expect(snapshot.state).toBe("untagged-native");
    expect(snapshot.provenance).toBeUndefined();
    expect(snapshot.live?.radius).toBe(31);
  });

  it("reports tagged instances and native edits as the designer's own", () => {
    const tagged = appearanceNodeSnapshot(
      sceneNode({
        effects: [glassEffect(recipe.material) as EffectLike],
        pluginData: JSON.stringify(recipe),
      }),
    );
    expect(tagged.state).toBe("tagged");
    expect(tagged.customized).toEqual([]);
    const customized = appearanceNodeSnapshot(
      sceneNode({
        effects: [glassEffect({ radius: 40, lightIntensity: 0.9 }) as EffectLike],
        pluginData: JSON.stringify(recipe),
      }),
    );
    expect(customized.state).toBe("customized");
    expect(customized.customized).toEqual(["light-intensity", "radius"]);
  });

  it("discloses stacked glass and native removal instead of guessing", () => {
    const stacked = appearanceNodeSnapshot(
      sceneNode({
        effects: [glassEffect() as EffectLike, glassEffect() as EffectLike],
        pluginData: JSON.stringify(recipe),
      }),
    );
    expect(stacked.eligible).toBe(false);
    expect(stacked.reason).toBe("multiple-glass");
    expect(stacked.glassCount).toBe(2);
    const removed = appearanceNodeSnapshot(
      sceneNode({ pluginData: JSON.stringify(recipe) }),
    );
    expect(removed.state).toBe("removed");
    expect(removed.eligible).toBe(true);
  });
});

describe("applyAppearanceToNodes", () => {
  it("retains untagged provenance only when an explicit selective action requests it", () => {
    const node = sceneNode({ effects: [glassEffect({ radius: 42 }) as EffectLike] });
    expect(applyAppearanceToNodes([node], recipe, { ...recipe.material, depth: 18 }, ["depth"], true).ok).toBe(true);
    expect(appearanceNodeSnapshot(node)).toMatchObject({ state: "untagged-native", live: { depth: 18, radius: 42 } });
    expect(appearanceNodeSnapshot(node).provenance).toBeUndefined();
    expect(applyAppearanceToNodes([node], recipe, recipe.material, undefined, true).ok).toBe(false);
  });
  it("selectively revises the live effect without replaying other values or changing its seed", () => {
    const shadow = { type: "DROP_SHADOW", radius: 4 } as EffectLike;
    const node = sceneNode({ effects: [shadow] });
    expect(applyAppearanceToNodes([node], recipe, { ...recipe.material, radius: 42, refraction: .8 }).ok).toBe(true);
    const native = (node as unknown as { effects: EffectLike[] }).effects;
    native[1]!["splay"] = .7;
    native[1]!["boundVariables"] = {};
    const before = structuredClone(native);
    expect(applyAppearanceToNodes([node], recipe, { ...recipe.material, depth: 18 }, ["depth"]).ok).toBe(true);
    expect((node as unknown as { effects: EffectLike[] }).effects).toEqual([before[0], { ...before[1], depth: 18 }]);
    expect(appearanceNodeSnapshot(node).provenance).toEqual(recipe);
  });

  it("rejects selective seed changes, repeated fields and removed effects without mutation", () => {
    const node = sceneNode({});
    expect(applyAppearanceToNodes([node], recipe).ok).toBe(true);
    const before = structuredClone((node as unknown as { effects: EffectLike[] }).effects);
    expect(applyAppearanceToNodes([node], { ...recipe, recipeVersion: recipe.recipeVersion + 1 }, recipe.material, ["depth"]).ok).toBe(false);
    expect(applyAppearanceToNodes([node], recipe, recipe.material, ["depth", "depth"]).ok).toBe(false);
    expect((node as unknown as { effects: EffectLike[] }).effects).toEqual(before);
    (node as unknown as { effects: EffectLike[] }).effects = [];
    expect(applyAppearanceToNodes([node], recipe, recipe.material, ["depth"]).ok).toBe(false);
    expect((node as unknown as { effects: EffectLike[] }).effects).toEqual([]);
  });

  it("keeps the preset seed when applying customized values", () => {
    const node = sceneNode({});
    const material = { ...recipe.material, radius: 7 };
    expect(applyAppearanceToNodes([node], recipe, material).ok).toBe(true);
    const state = appearanceNodeSnapshot(node);
    expect(state.live?.radius).toBe(7);
    expect(state.provenance).toEqual(recipe);
    expect(state.customized).toContain("radius");
  });

  it("appends glass while preserving unrelated effects and their order", () => {
    const shadow = { type: "DROP_SHADOW", radius: 4 } as EffectLike;
    const node = sceneNode({ effects: [shadow] });
    const applied = applyAppearanceToNodes([node], recipe);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.outcomes).toEqual([
      { nodeId: "10:1", outcome: "applied", replacedUntagged: false },
    ]);
    const effects = (node as unknown as { effects: EffectLike[] }).effects;
    expect(effects).toHaveLength(2);
    expect(effects[0]).toBe(shadow);
    expect(effects[1]).toMatchObject({ type: "GLASS", radius: recipe.material.radius });
    expect(
      (node as unknown as { getSharedPluginData(namespace: string, key: string): string }).getSharedPluginData(
        "worldbend", SHARED_APPEARANCE_KEY,
      ),
    ).toBe(JSON.stringify(recipe));
  });

  it("replaces the single glass effect in place, including untagged native glass", () => {
    const shadow = { type: "DROP_SHADOW", radius: 4 } as EffectLike;
    const node = sceneNode({
      effects: [shadow, glassEffect({ radius: 60 }) as EffectLike],
    });
    const applied = applyAppearanceToNodes([node], recipe);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.outcomes[0]).toMatchObject({ outcome: "applied", replacedUntagged: true });
    const effects = (node as unknown as { effects: EffectLike[] }).effects;
    expect(effects).toHaveLength(2);
    expect(effects[0]).toBe(shadow);
    expect(effects[1]).toMatchObject({ type: "GLASS", radius: recipe.material.radius });
  });

  it("skips stacked-glass and effect-incapable nodes without touching them", () => {
    const stacked = sceneNode({
      id: "10:2",
      effects: [glassEffect() as EffectLike, glassEffect() as EffectLike],
    });
    const before = [...(stacked as unknown as { effects: EffectLike[] }).effects];
    const group = sceneNode({ id: "10:3", type: "GROUP", noEffects: true });
    const applied = applyAppearanceToNodes([stacked, group], recipe);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.outcomes).toEqual([
      { nodeId: "10:2", outcome: "skipped", reason: "multiple-glass" },
      { nodeId: "10:3", outcome: "skipped", reason: "no-effects" },
    ]);
    expect((stacked as unknown as { effects: EffectLike[] }).effects).toEqual(before);
  });

  it("restores already-changed nodes when a later node fails mid-batch", () => {
    const first = sceneNode({
      id: "10:4",
      effects: [glassEffect({ radius: 60 }) as EffectLike],
    });
    const second = sceneNode({ id: "10:5", failOnEffectsWrite: true });
    const applied = applyAppearanceToNodes([first, second], recipe);
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.error).toContain("locked");
    const firstEffects = (first as unknown as { effects: EffectLike[] }).effects;
    expect(firstEffects).toHaveLength(1);
    expect(firstEffects[0]).toMatchObject({ type: "GLASS", radius: 60 });
    expect(
      (first as unknown as { getSharedPluginData(namespace: string, key: string): string }).getSharedPluginData(
        "worldbend", SHARED_APPEARANCE_KEY,
      ),
    ).toBe("");
  });

  it("preserves native extension controls such as Splay and exposes them for handoff", () => {
    const node = sceneNode({ effects: [{ ...(glassEffect() as EffectLike), splay: 0.2 }] });
    expect(applyAppearanceToNodes([node], recipe).ok).toBe(true);
    expect((node as unknown as { effects: EffectLike[] }).effects[0]?.["splay"]).toBe(0.2);
    expect(appearanceNodeSnapshot(node).nativeExtras).toEqual({ splay: 0.2 });
    expect(appearanceNodeSnapshot(node).state).toBe("tagged");
  });

  it("reports visual conflicts rather than silently claiming visible glass", () => {
    const node = sceneNode({ effects: [{ type: "BACKGROUND_BLUR", visible: true, radius: 18 }] });
    (node as unknown as { fills: unknown[] }).fills = [{ type: "SOLID", opacity: 1 }];
    expect(appearanceNodeSnapshot(node).warnings).toEqual(["opaque-fill", "background-blur"]);
    expect(applyAppearanceToNodes([node], recipe).ok).toBe(true);
    expect(appearanceNodeSnapshot(node).warnings).toEqual(["opaque-fill", "background-blur"]);
  });

  it("never reclassifies invalid native glass as an absent effect", () => {
    const node = sceneNode({ effects: [glassEffect({ depth: 0.5 }) as EffectLike] });
    expect(appearanceNodeSnapshot(node)).toMatchObject({ eligible: false, reason: "invalid-glass", glassCount: 1 });
  });

  it("rejects an invalid recipe before touching the document", () => {
    const node = sceneNode({ effects: [glassEffect() as EffectLike] });
    const applied = applyAppearanceToNodes(
      [node],
      { ...recipe, material: { ...recipe.material, lightAngle: 400 } },
    );
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect((node as unknown as { effects: EffectLike[] }).effects).toHaveLength(1);
  });
});


describe("appearance preview context", () => {
  it("crosses groups to the nearest editable scene and falls back on isolated nodes", () => {
    const frame = { id: "frame", type: "COMPONENT", parent: { type: "PAGE" } };
    const node = sceneNode({});
    Object.assign(node, { parent: { type: "GROUP", parent: frame } });
    expect(appearancePreviewContext(node).id).toBe("frame");
    expect(appearancePreviewContext(sceneNode({})).id).toBe("10:1");
  });
  it("does not overwrite an invalid native effect during a mixed apply", () => {
    const invalid = sceneNode({ id: "bad", effects: [glassEffect({ depth: 0 }) as EffectLike] });
    const good = sceneNode({ id: "good" });
    const before = (invalid as unknown as { effects: EffectLike[] }).effects;
    const result = applyAppearanceToNodes([invalid, good], recipe);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.outcomes).toEqual([
      { nodeId: "bad", outcome: "skipped", reason: "invalid-glass" },
      { nodeId: "good", outcome: "applied", replacedUntagged: false },
    ]);
    expect((invalid as unknown as { effects: EffectLike[] }).effects).toBe(before);
  });
});
