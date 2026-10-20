import { describe, expect, it } from "vitest";
import { isCanvasOutputNames, normalizeCanvasOutputName } from "./canvas-output-name";
import { addCanvasVariant, createCanvasDraft, renameCanvasVariant } from "./canvas-state";
import { draftFromStoredCanvasSet, specFromDraft } from "./canvas-workspace-support";
import { canvasTemplateFromSet, isFigmaTaskTemplate } from "./stored-template-library";

describe("human size names",()=>{
  it("keeps labels out of geometry and restores them through the carrier template",()=>{
    let draft=addCanvasVariant(createCanvasDraft(1600,900));
    draft=renameCanvasVariant(draft,"output-1","书封 · 横版 / 2026 🎨");
    draft=renameCanvasVariant(draft,"output-2","书封 · 方形");
    const spec=specFromDraft(draft);
    expect(spec.variants.map(v=>v.id)).toEqual(["output-1","output-2"]);
    expect(JSON.stringify(spec)).not.toContain("书封");
    const template=canvasTemplateFromSet(spec,Object.fromEntries(draft.variants.map(v=>[v.id,v.name!])));
    expect(isFigmaTaskTemplate(JSON.parse(JSON.stringify(template)))).toBe(true);
    const restored=draftFromStoredCanvasSet(template.operation.spec,1600,900,template.outputNames);
    expect(restored.variants.map(v=>v.name)).toEqual(draft.variants.map(v=>v.name));
    expect(restored.activeId).toBe("output-1");
    expect(specFromDraft(restored)).toEqual(spec);
  });
  it("admits punctuation as data, rejects unknown labels and never reads inherited identity names",()=>{
    expect(normalizeCanvasOutputName('  书封 <script> / "🎨"  ')).toBe('书封 <script> / "🎨"');
    for(const name of ["", "x\ny", "\ud800", "x".repeat(129)])expect(normalizeCanvasOutputName(name)).toBeUndefined();
    expect(isCanvasOutputNames({output1:undefined},["output1"])).toBe(false);
    expect(isCanvasOutputNames({unknown:"书封"},["output1"])).toBe(false);
    expect(isCanvasOutputNames(new Date(),["output1"])).toBe(false);
    const spec=specFromDraft(createCanvasDraft(100,80));spec.variants[0]!.id="constructor";
    expect(draftFromStoredCanvasSet(spec,100,80,{}).variants[0]!.name).toBeUndefined();
  });
});
