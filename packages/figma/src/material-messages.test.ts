import { describe, expect, it } from "vitest";
import { isUiToMainMessage } from "./messages";
import { BUILTIN_APPEARANCE_RECIPES } from "./appearance-wire";
import { BUILTIN_TEXTURE_RECIPES } from "./texture-wire";
import { BUILTIN_FOIL_RECIPES } from './foil-material-wire';
import { BUILTIN_MESH_GRADIENT_RECIPES } from './mesh-gradient-material-wire';

const glass = BUILTIN_APPEARANCE_RECIPES[0]!;
const texture = BUILTIN_TEXTURE_RECIPES[0]!;
const edit = { family: "glass", recipe: glass, material: glass.material };
describe("material host boundary", () => {
  it('roundtrips independent RGBA recipe objects and rejects partial saved looks and malformed color channel edits',()=>{
    const recipe=structuredClone(BUILTIN_FOIL_RECIPES[0]!),foil={family:'foil',recipe,material:structuredClone(recipe.material)};
    const saved={type:'save-material',material:{name:'My foil',edit:JSON.parse(JSON.stringify(foil))}};
    expect(isUiToMainMessage(saved)).toBe(true);
    saved.material.edit.material.baseColor.a=.25;
    expect(isUiToMainMessage(saved)).toBe(false);
    const apply=(extra:object)=>isUiToMainMessage({type:'apply-material',generation:1,edit:{...foil,fields:['base-color'],...extra}});
    expect(apply({colorChannels:{'base-color':['a']}})).toBe(true);
    for(const channels of [{},{'base-color':[]},{'base-color':['a','a']},{'base-color':['x']},{'highlight-color':['a']}])
      expect(apply({colorChannels:channels})).toBe(false);
    expect(apply({adopt:true})).toBe(false);
    expect(isUiToMainMessage({type:'request-foil-state'})).toBe(true);
    expect(isUiToMainMessage({type:'request-foil-state',resource:'guessed'})).toBe(false);
    const meshRecipe=structuredClone(BUILTIN_MESH_GRADIENT_RECIPES[0]!),mesh={family:'mesh-gradient',recipe:meshRecipe,material:structuredClone(meshRecipe.material)};
    expect(isUiToMainMessage({type:'save-material',material:{name:'Soft fluid',edit:JSON.parse(JSON.stringify(mesh))}})).toBe(true);
    expect(isUiToMainMessage({type:'apply-material',generation:1,edit:{...mesh,fields:['color-tl'],colorChannels:{'color-tl':['a']}}})).toBe(true);
    expect(isUiToMainMessage({type:'apply-material',generation:1,edit:{...mesh,fields:['color-tl'],colorChannels:{'base-color':['a']}}})).toBe(false);
    expect(isUiToMainMessage({type:'apply-material',generation:1,edit:{...mesh,adopt:true,fields:['warp']}})).toBe(false);
    expect(isUiToMainMessage({type:'request-mesh-gradient-state'})).toBe(true);
    expect(isUiToMainMessage({type:'request-mesh-gradient-state',resource:'guessed'})).toBe(false);
  });
  it("accepts bounded integer window sizes and rejects nonfinite, fractional and out-of-range requests", () => {
    expect(
      isUiToMainMessage({ type: "resize-ui", width: 820, height: 720 }),
    ).toBe(true);
    for (const width of [299, 1601, 820.5, NaN, Infinity])
      expect(isUiToMainMessage({ type: "resize-ui", width, height: 720 })).toBe(
        false,
      );
    for (const height of [439, 1201, 720.5, NaN])
      expect(isUiToMainMessage({ type: "resize-ui", width: 820, height })).toBe(
        false,
      );
    expect(
      isUiToMainMessage({
        type: "resize-ui",
        width: 820,
        height: 720,
        extra: true,
      }),
    ).toBe(false);
  });
  it("rejects cross-family payloads and repeated or foreign field patches", () => {
    const request = (value: unknown) => ({
      type: "request-material-trial",
      generation: 1,
      requestId: 2,
      edit: value,
    });
    expect(isUiToMainMessage(request(edit))).toBe(true);
    expect(
      isUiToMainMessage(request({ ...edit, material: texture.material })),
    ).toBe(false);
    expect(isUiToMainMessage(request({ ...edit, recipe: texture }))).toBe(
      false,
    );
    expect(
      isUiToMainMessage(request({ ...edit, fields: ["depth", "depth"] })),
    ).toBe(false);
    expect(isUiToMainMessage(request({ ...edit, fields: ["density"] }))).toBe(
      false,
    );
    expect(isUiToMainMessage({ ...request(edit), generation: -1 })).toBe(false);
  });
  it("stores a complete repeatable look, never a removal or a field-only patch", () => {
    const save = (value: unknown, name = "My glass") => ({
      type: "save-material",
      material: { name, edit: value },
    });
    expect(isUiToMainMessage(save(edit))).toBe(true);
    expect(isUiToMainMessage(save({ ...edit, remove: true }))).toBe(false);
    expect(isUiToMainMessage(save({ ...edit, fields: ["depth"] }))).toBe(false);
    expect(isUiToMainMessage(save(edit, "\nBad"))).toBe(false);
    expect(
      isUiToMainMessage(
        save({ ...edit, material: { ...glass.material, depth: 999 } }),
      ),
    ).toBe(false);
  });
});
