import {afterEach,expect,it,vi} from "vitest";
import {copyNativeSurfaceAppearance} from "./native-surface-appearance";
afterEach(()=>vi.unstubAllGlobals());

function fixture() {
  const variable={id:"radius"},collection={id:"theme",modes:[{modeId:"night"}]};
  vi.stubGlobal("figma",{mixed:Symbol("mixed"),variables:{getVariableByIdAsync:async(id:string)=>id===variable.id?variable:null,
    getVariableCollectionByIdAsync:async(id:string)=>id===collection.id?collection:null}});
  const source={fills:[{type:"SOLID",color:{r:.2,g:.3,b:.4}}],strokes:[],fillStyleId:"fill-style",strokeStyleId:"stroke-style",
    opacity:.7,blendMode:"MULTIPLY",strokeWeight:2,strokeTopWeight:2,strokeRightWeight:3,strokeBottomWeight:4,strokeLeftWeight:5,
    strokeAlign:"INSIDE",strokeCap:"ROUND",strokeJoin:"BEVEL",strokeMiterLimit:3,dashPattern:[4,2],cornerSmoothing:.5,
    topLeftRadius:24,topRightRadius:10,bottomLeftRadius:11,bottomRightRadius:12,
    boundVariables:{topLeftRadius:{type:"VARIABLE_ALIAS",id:"radius"},width:{type:"VARIABLE_ALIAS",id:"managed-width"}},
    explicitVariableModes:{theme:"night"},effects:[{type:"SHADER",id:"old"}],width:300,clipsContent:true};
  const target={effects:[{type:"SHADER",id:"new"}],width:360,clipsContent:true,visible:true,
    setFillStyleIdAsync:vi.fn(async()=>{}),setStrokeStyleIdAsync:vi.fn(async()=>{}),
    setBoundVariable:vi.fn(),setExplicitVariableModeForCollection:vi.fn()};
  return {source,target,variable,collection};
}
it("retains authored appearance, style references, corner aliases and explicit modes without replacing the new sampler or view box",async()=>{
  const {source,target,variable,collection}=fixture();
  await copyNativeSurfaceAppearance(source as unknown as FrameNode,target as unknown as FrameNode);
  expect(target).toMatchObject({opacity:.7,blendMode:"MULTIPLY",strokeRightWeight:3,dashPattern:[4,2],cornerSmoothing:.5,
    topLeftRadius:24,topRightRadius:10,bottomLeftRadius:11,bottomRightRadius:12,effects:[{type:"SHADER",id:"new"}],width:360,clipsContent:true});
  expect(target.setFillStyleIdAsync).toHaveBeenCalledWith("fill-style");
  expect(target.setStrokeStyleIdAsync).toHaveBeenCalledWith("stroke-style");
  expect(target.setBoundVariable.mock.calls).toEqual([["topLeftRadius",variable]]);
  expect(target.setExplicitVariableModeForCollection.mock.calls).toEqual([[collection,"night"]]);
});
it.each(["variable","mode"])("refuses an unavailable %s before changing the replacement appearance",async(kind)=>{
  const {source,target}=fixture(),before=JSON.stringify(target);
  if(kind==="variable")source.boundVariables.topLeftRadius.id="unavailable";
  else source.explicitVariableModes.theme="unavailable";
  await expect(copyNativeSurfaceAppearance(source as unknown as FrameNode,target as unknown as FrameNode)).rejects.toThrow("unavailable");
  expect(JSON.stringify(target)).toBe(before);expect(target.setBoundVariable).not.toHaveBeenCalled();
  expect(target.setFillStyleIdAsync).not.toHaveBeenCalled();
});
it("retains independent border weights when Figma reports the uniform weight as mixed",async()=>{
  const {source,target}=fixture();
  const mixed={...source,strokeWeight:figma.mixed};
  await copyNativeSurfaceAppearance(mixed as unknown as FrameNode,target as unknown as FrameNode);
  expect(target).toMatchObject({strokeTopWeight:2,strokeRightWeight:3,strokeBottomWeight:4,strokeLeftWeight:5});
});
it("rejects an equivalent-paint style reassignment during variable lookup before overwriting the newer choice",async()=>{
  const {source,target,variable}=fixture();
  figma.variables.getVariableByIdAsync=async()=>{source.fillStyleId="newer-live-style";return variable as Variable;};
  await expect(copyNativeSurfaceAppearance(source as unknown as FrameNode,target as unknown as FrameNode)).rejects.toThrow("Scene changed");
  expect(source.fillStyleId).toBe("newer-live-style");expect(target.setFillStyleIdAsync).not.toHaveBeenCalled();
});
