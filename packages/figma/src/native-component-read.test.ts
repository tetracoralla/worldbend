import { afterEach, expect, it, vi } from "vitest";
import { composeAffineTransform, identityTransformRecipe, rebaseNativeAffine, type TransformSpec } from "@worldbend/web";
import { componentNativeMotionParts, componentNativeParts } from "./native-component";
import type { NativeComponentProjection, NativeMatrix } from "./native-frame-record";

function fixture() {
  const identity: NativeMatrix = [[1, 0, 0], [0, 1, 0]];
  const frame = (id: string, type = "FRAME") => ({ id, type, name: id, children: [] as unknown[],
    width: 400, height: 240, visible: true, layoutMode: "NONE", clipsContent: false,
    effects: [], relativeTransform: structuredClone(identity) });
  const result = frame("result"), surface = frame("surface"), basis = frame("basis");
  const content = frame("content"), masterContent = frame("master-content"), master = frame("master", "COMPONENT");
  const instance = { ...frame("instance", "INSTANCE"), scaleFactor: 0.9447221755981445,
    getMainComponentAsync: async () => master };
  result.children = [surface, master]; surface.children = [basis]; basis.children = [instance];
  instance.children = [content]; master.children = [masterContent];
  Object.assign(surface,{parent:result});Object.assign(master,{parent:result});Object.assign(basis,{parent:surface});
  Object.assign(instance,{parent:basis});Object.assign(content,{parent:instance});Object.assign(masterContent,{parent:master});
  result.clipsContent = true; master.visible = false;
  const spec: TransformSpec = { schema: "worldbend.transform", version: "0.1", content: { fit: "stretch" },
    destination: { space: "normalized", quad: { tl: { x: .15, y: 0 }, tr: { x: 1, y: 0 },
      br: { x: .85, y: 1 }, bl: { x: 0, y: 1 } } } };
  // Native unit-column transforms and instance extents are stored by the host
  // at float32 precision; recomposing them need not recover integer corners.
  surface.relativeTransform = [[0.048108138144016266, -0.9366095662117004, 60],
    [0.998842179775238, 0.35037490725517273, 0]];
  basis.relativeTransform = [[0.3310069441795349, 0.9436283111572266, 0],
    [-0.9436283111572266, 0.3310069441795349, 0]];
  for (const node of [basis, instance, content]) {
    node.width = 377.88885498046875; node.height = 226.7333221435547;
  }
  const record: NativeComponentProjection = { schema: "worldbend.figma.native", version: "0.3",
    resultNodeId: result.id, contentNodeId: content.id, surfaceNodeId: surface.id,
    sourceSize: { width: content.width, height: content.height }, outputSize: { width: 400, height: 240 },
    placement: { x: 1000, y: 0, width: 400, height: 240 }, operation: JSON.stringify(spec), renderer: { kind: "affine" },
    frame: { masterNodeId: master.id, masterContentNodeId: masterContent.id, instanceNodeId: instance.id,
      basisNodeId: basis.id, instanceScale: instance.scaleFactor,
      outerBasis: structuredClone(surface.relativeTransform), innerBasis: structuredClone(basis.relativeTransform),
      surfaceSize: { width: surface.width, height: surface.height }, basisSize: { width: basis.width, height: basis.height },
      instanceSize: { width: instance.width, height: instance.height } } };
  const shared: Record<string, string> = { native: JSON.stringify(record), transform: record.operation,
    binding: JSON.stringify({ schema: "worldbend.figma.binding", version: "0.1", resultNodeId: result.id,
      sourceNodeIds: [content.id], revision: 1, renderWidth: 400, renderHeight: 240 }) };
  Object.assign(result, { getSharedPluginData: (_ns: string, key: string) => shared[key] ?? "" });
  const nodes=new Map([result,surface,basis,instance,content,master,masterContent].map(node=>[node.id,node]));
  vi.stubGlobal("figma", { skipInvisibleInstanceChildren: true,motion:{playheadPosition:undefined},
    getNodeByIdAsync:async(id:string)=>nodes.get(id)??null });
  return { result: result as unknown as FrameNode, surface, basis, instance, content, master, masterContent, record, spec };
}
afterEach(() => vi.unstubAllGlobals());

it("keeps canonical integer bounds through an unchanged affine read and mode composition", async () => {
  const f = fixture(), read = await componentNativeParts(f.result, f.record);
  const spec = read.affineState ? await rebaseNativeAffine(read.affineState) : read.spec;
  const composed = await composeAffineTransform(spec, identityTransformRecipe(), { width: 400, height: 240 });
  expect(composed.canvas.size).toEqual({ width: 400, height: 240 });
  expect(read.spec).toEqual(f.spec);
});

it("still observes a native clip resize instead of replaying the old output extent", async () => {
  const f = fixture();
  Object.assign(f.result, { width: 420, height: 250 });
  const read = await componentNativeParts(f.result, f.record);
  expect(read.affineState?.outputSize).toEqual({ width: 420, height: 250 });
});

it("preserves canonical geometry on an independent native duplicate", async () => {
  const f = fixture();
  for (const node of [f.result, f.surface, f.basis, f.instance, f.content, f.master, f.masterContent]) {
    Object.assign(node, { id: `copy-${node.id}` });
  }
  const read = await componentNativeParts(f.result, f.record);
  expect(read.copied).toBe(true);
  expect(read.affineState).toBeUndefined();
  expect(read.spec).toEqual(f.spec);
});

it("reads a host Duplicate whose nested Source became an instance without adopting or writing it", async () => {
  const f=fixture(),originalMaster={id:f.record.frame.masterNodeId};
  for(const node of [f.result,f.surface,f.basis,f.instance,f.content,f.master,f.masterContent])Object.assign(node,{id:`copy-${node.id}`});
  Object.assign(f.master,{type:"INSTANCE",getMainComponentAsync:async()=>originalMaster});
  f.instance.getMainComponentAsync=async()=>originalMaster as never;
  const before=JSON.stringify(f.record);
  expect((await componentNativeParts(f.result,f.record)).copied).toBe(true);
  expect(JSON.stringify(f.record)).toBe(before);
  Object.assign(f.master,{getMainComponentAsync:async()=>({id:"unrelated-master"})});
  await expect(componentNativeParts(f.result,f.record)).rejects.toThrow("master changed");
});

it("does not hide a small admitted native basis edit behind a rounding tolerance", async () => {
  const f = fixture();
  f.surface.relativeTransform[0][2] = Math.fround(f.surface.relativeTransform[0][2] + .00001);
  const read = await componentNativeParts(f.result, f.record);
  expect(read.affineState?.outerBasis).toEqual(f.surface.relativeTransform);
});

it("still observes changed editable content extent and a uniform native scale", async () => {
  const f = fixture();
  f.content.width += 1;
  expect((await componentNativeParts(f.result, f.record)).affineState?.sourceSize.width).toBe(f.content.width);
  f.content.width -= 1;
  Object.assign(f.result, { width: 480, height: 288 });
  f.surface.width *= 1.2; f.surface.height *= 1.2;
  f.surface.relativeTransform[0][2] *= 1.2;
  f.basis.width *= 1.2; f.basis.height *= 1.2;
  f.content.width *= 1.2; f.content.height *= 1.2;
  f.instance.scaleFactor *= 1.2;
  const read = await componentNativeParts(f.result, f.record);
  expect(read.affineState?.outputSize).toEqual({ width: 480, height: 288 });
  expect(read.affineState?.sourceSize).toEqual({ width: f.content.width, height: f.content.height });
});

it("reopens a projective result after Figma moves keyed shader properties into Motion base values", async () => {
  const f = fixture();
  const ids = Array.from({ length: 11 }, (_, index) => `property-${index}`);
  const properties = Object.fromEntries(ids.map((id, index) => [id, Math.fround(index + .25)]));
  f.record.renderer = { kind: "projective", shaderId: "shader", properties };
  Object.assign(f.surface, { clipsContent: true, effects: [{ type: "SHADER", visible: true, id: "shader",
    properties: Object.fromEntries(ids.slice(9).map(id => [id, properties[id]!])) }],
    applyManualKeyframeTrack() {}, animationStyles: [], timelines: [{ id: f.result.id, duration: 2 }],
    manualKeyframeTracks: { effects: { 0: { properties: Object.fromEntries(ids.slice(0, 9).map(id => [id, {
      id: `track-${id}`, baseValue: { type: "FLOAT", value: properties[id]! }, keyframes: [
        { id: `key-${id}-0`, timelinePosition: 0, easing: { type: "LINEAR" }, value: { type: "FLOAT", value: 0 } },
        { id: `key-${id}-1`, timelinePosition: 2, easing: { type: "LINEAR" }, value: { type: "FLOAT", value: 1 } },
      ] }])) } } } });
  await expect(componentNativeParts(f.result, f.record)).resolves.toMatchObject({ spec: f.spec });
});

function projectiveMotionFixture(){
  const f=fixture(),ids=Array.from({length:11},(_,index)=>`property-${index}`);
  const properties=Object.fromEntries(ids.map((id,index)=>[id,Math.fround(index+.25)]));
  f.record.renderer={kind:"projective",shaderId:"shader",properties};
  Object.assign(f.surface,{clipsContent:true,effects:[{type:"SHADER",visible:true,id:"shader",
    properties:Object.fromEntries(ids.slice(9).map(id=>[id,properties[id]!]))}],applyManualKeyframeTrack(){},
    animationStyles:[],timelines:[{id:f.result.id,duration:2}],manualKeyframeTracks:{effects:{0:{properties:
      Object.fromEntries(ids.slice(0,9).map(id=>[id,{id:`track-${id}`,baseValue:{type:"FLOAT",value:properties[id]!},keyframes:[
        {id:`key-${id}-0`,timelinePosition:0,easing:{type:"LINEAR"},value:{type:"FLOAT",value:0}},
        {id:`key-${id}-1`,timelinePosition:2,easing:{type:"LINEAR"},value:{type:"FLOAT",value:1}},
      ]}]))}}}});
  return f;
}

function evaluatedMotionGraph(f:ReturnType<typeof projectiveMotionFixture>){
  const clone=(node:any,id:string)=>({...node,id,children:[],effects:structuredClone(node.effects),
    manualKeyframeTracks:structuredClone(node.manualKeyframeTracks),animationStyles:structuredClone(node.animationStyles),
    timelines:structuredClone(node.timelines)});
  const surface=clone(f.surface,"evaluated-surface"),basis=clone(f.basis,"evaluated-basis");
  const instance=clone(f.instance,"evaluated-instance"),content=clone(f.content,"evaluated-content");
  const master=clone(f.master,"evaluated-master"),masterContent=clone(f.masterContent,"evaluated-master-content");
  (f.result as any).children=[surface,master];surface.children=[basis];basis.children=[instance];instance.children=[content];master.children=[masterContent];
  const evaluatedRoot={id:"evaluated-result"};
  Object.assign(surface,{parent:evaluatedRoot});Object.assign(master,{parent:evaluatedRoot});Object.assign(basis,{parent:surface});
  Object.assign(instance,{parent:basis,getMainComponentAsync:async()=>f.master});Object.assign(content,{parent:instance});Object.assign(masterContent,{parent:master});
  Object.assign(f.surface,{parent:evaluatedRoot});Object.assign(f.master,{parent:evaluatedRoot});Object.assign(f.basis,{parent:surface});
  Object.assign(f.instance,{parent:basis});Object.assign(f.content,{parent:instance});Object.assign(f.masterContent,{parent:master});
  return {surface,basis,instance,content,master,masterContent};
}

it("admits only Figma Motion's semantically identical evaluated descendant graph",async()=>{
  const f=projectiveMotionFixture(),evaluated=evaluatedMotionGraph(f),api=figma as unknown as {motion:{playheadPosition?:number}};
  api.motion.playheadPosition=1;
  await expect(componentNativeParts(f.result,f.record)).rejects.toThrow("structure changed");
  await expect(componentNativeMotionParts(f.result,f.record)).resolves.toMatchObject({
    content:{id:evaluated.content.id},surface:{id:evaluated.surface.id},spec:f.spec,copied:false,
  });
});

it("rejects a Motion-shaped alias when its tracks or geometry diverge from the canonical graph",async()=>{
  const f=projectiveMotionFixture(),evaluated=evaluatedMotionGraph(f),api=figma as unknown as {motion:{playheadPosition?:number}};
  api.motion.playheadPosition=1;
  evaluated.surface.manualKeyframeTracks.effects[0].properties["property-0"].keyframes[0].value.value=.5;
  await expect(componentNativeMotionParts(f.result,f.record)).rejects.toThrow("Motion changed");
  evaluated.surface.manualKeyframeTracks=structuredClone((f.surface as any).manualKeyframeTracks);
  evaluated.content.width+=1;
  await expect(componentNativeMotionParts(f.result,f.record)).rejects.toThrow("geometry changed");
});
