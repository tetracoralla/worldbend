import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {createWork} from "./agent-work-create";
import * as sourceRead from "./agent-work-revise-read";
import * as sourcePublish from "./agent-work-revise-publish";
import {readStoredOperation,writeStoredOperation} from "./stored-operation";
import {readResultBinding,writeStoredBinding} from "./stored-binding";
import {deformationWorkFromMesh} from "./deformation-work-state";
import {planDeformationWork} from "./designer-plan";
import {createMeshSpec} from "./mesh-workspace";
import {defaultMockup} from "./mockup-workspace";
import {continuedCompositionTask} from "./stored-designer-task";
import {stagePublicationChunk,cancelPublication,readPublication} from "./agent-handoff-media";
import {finishWorkRevision} from "./agent-work-revise-finalize";

const transform={schema:"worldbend.transform" as const,version:"0.1" as const,destination:{space:"normalized" as const,
  quad:{tl:{x:0,y:0},tr:{x:1,y:0},br:{x:1,y:1},bl:{x:0,y:1}}},content:{fit:"stretch" as const}};
const png=Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64"));
function host(){
  let serial=0;const nodes=new Map<string,any>();
  const page:any={id:"page",type:"PAGE",removed:false,children:[],parent:null};nodes.set(page.id,page);
  function node(type="FRAME"){
    const shared=new Map<string,string>();const n:any={id:`n-${++serial}`,type,name:"源稿 🌐",parent:page,children:[],visible:true,removed:false,
      x:10,y:20,width:100,height:80,opacity:1,blendMode:"NORMAL",fills:[],strokes:[],effects:[],
      relativeTransform:[[1,0,10],[0,1,20]],absoluteTransform:[[1,0,10],[0,1,20]],
      get absoluteBoundingBox(){return {x:n.x,y:n.y,width:n.width,height:n.height};},
      getSharedPluginData:(_ns:string,key:string)=>shared.get(key)??"",setSharedPluginData:(_ns:string,key:string,value:string)=>shared.set(key,value),
      resize(w:number,h:number){n.width=w;n.height=h;},remove(){n.removed=true;page.children=page.children.filter((c:any)=>c!==n);},
      exportAsync:vi.fn(async()=>png)};page.children.push(n);nodes.set(n.id,n);return n;
  }
  const art=node();const api:any={fileKey:"file",currentPage:page,mixed:Symbol("mixed"),getNodeByIdAsync:vi.fn(async(id:string)=>nodes.get(id)??null),
    createRectangle:vi.fn(()=>node("RECTANGLE")),createImage:vi.fn(()=>({hash:"revision-pixels"})),
    base64Encode:(bytes:Uint8Array)=>Buffer.from(bytes).toString("base64"),base64Decode:(v:string)=>Uint8Array.from(Buffer.from(v,"base64"))};
  vi.stubGlobal("figma",api);return {art,node,nodes,api};
}
function entry(kind:"source"|"bundled"):typeof sourceRead & typeof sourcePublish {
  if(kind==="source")return {...sourceRead,...sourcePublish};
  const runtime=(name:string)=>readFileSync(new URL(`../../../crates/worldbend-mcp/src/figma-runtime-work-revise-${name}.js`,import.meta.url),"utf8");
  const revision=readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-work-revision-read.js",import.meta.url),"utf8");
  return new Function(`${runtime("read")}\nconst reads=WorldbendFigmaHandoff;\n${revision}\nconst revise=WorldbendFigmaHandoff;\n${runtime("publish")}\nreturn {...reads,...revise,...WorldbendFigmaHandoff};`)();
}
async function fixture(){const h=host();const made=await createWork({fileKey:"file",pageId:"page",sourceNodeIds:[h.art.id],
  operation:{kind:"transform",spec:transform},renderWidth:100,renderHeight:80,requestId:"revision-fixture"});
  return {...h,result:h.nodes.get(made.snapshot.nodeId),scope:{fileKey:"file",pageId:"page",nodeId:made.snapshot.nodeId}};
}
async function state(api:ReturnType<typeof entry>,scope:{fileKey:string;pageId:string;nodeId:string}){
  const first=await api.readWorkState(scope);const pages=[first.json];
  for(let part=1;part<first.partCount;part++)pages.push((await api.readWorkState({...scope,part,token:first.token})).json);
  return JSON.parse(pages.join(""));
}
function ref(s:any){return {fileKey:s.fileKey,pageId:s.pageId,nodeId:s.nodeId,revision:s.revision,targetExpected:s.targetExpected};}
async function proposal(api:ReturnType<typeof entry>,input:any){const first=await api.readWorkRevision(input);const pages=[first.json];
  for(let part=1;part<first.partCount;part++)pages.push((await api.readWorkRevision({...input,part,token:first.token,
    ...(first.sourceFingerprints?{sourceFingerprints:first.sourceFingerprints}:{}),includeSourceRasters:false})).json);
  return {snapshot:JSON.parse(pages.join("")),rasters:"sourceRasters" in first?first.sourceRasters:undefined};
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe.each(["source","bundled"] as const)("Selective linked work revision (%s)",kind=>{
  it("changes HD density without resizing artwork, then transports an expanded core canvas and rolls back its full pose",async()=>{
    const h=await fixture(),api=entry(kind);
    const initial=await state(api,h.scope),first=await proposal(api,ref(initial));
    await api.publishWorkRevision({snapshot:first.snapshot,imageBase64:Buffer.from(png).toString("base64")});
    const work=deformationWorkFromMesh(createMeshSpec(100,80,4));work.boundary="free";
    const operation={kind:"task" as const,task:{kind:"deformation" as const,view:"mesh" as const,spec:work}};
    writeStoredOperation(h.result,operation);writeStoredBinding(h.result,{sourceNodeIds:[h.art.id],renderWidth:200,renderHeight:160});
    let matrix:Transform=[[.8,-.6,120],[.6,.8,200]];
    Object.defineProperty(h.result,"relativeTransform",{configurable:true,get:()=>matrix,set:(m:Transform)=>{matrix=m;h.result.x=m[0][2];h.result.y=m[1][2];}});
    Object.defineProperty(h.result,"absoluteTransform",{configurable:true,get:()=>matrix});h.result.relativeTransform=matrix;
    const saved=await state(api,h.scope),density=await proposal(api,{...ref(saved),renderWidth:300,renderHeight:240});
    expect(density.snapshot.previousOperation).toEqual(operation);
    expect(density.snapshot.placement).toMatchObject({width:100,height:80});
    await api.publishWorkRevision({snapshot:density.snapshot,imageBase64:Buffer.from(png).toString("base64")});
    expect([h.result.width,h.result.height]).toEqual([100,80]);expect(h.result.relativeTransform).toEqual(matrix);
    const next=structuredClone(operation);next.task.spec.meshEdits=[{column:2,row:0,warped:{x:.5,y:-.125}},{column:2,row:4,warped:{x:.5,y:1.125}}];
    const before=await planDeformationWork(work),after=await planDeformationWork(next.task.spec);
    const frame=(plan:typeof before)=>({origin:plan.authoredView?.canvasOrigin??{x:0,y:0},reference:plan.meshWarp.solve.resolvedDestination.reference});
    const frames={from:frame(before),to:frame(after)};
    const current=await state(api,h.scope),p=await proposal(api,{...ref(current),operation:next,renderWidth:300,renderHeight:300});
    const oldMatrix=structuredClone(matrix),oldBinding=readResultBinding(h.result),oldFills=structuredClone(h.result.fills);
    const write=h.result.setSharedPluginData;let failed=false;
    h.result.setSharedPluginData=(_ns:string,key:string,value:string)=>{if(key==="task"&&value&&!failed){failed=true;throw Error("task write after canvas transport failed");}write(_ns,key,value);};
    await expect(api.publishWorkRevision({snapshot:p.snapshot,canvasFrames:frames,imageBase64:Buffer.from(png).toString("base64")})).rejects.toThrow("task write after canvas transport failed");
    expect(h.result.relativeTransform).toEqual(oldMatrix);expect([h.result.width,h.result.height]).toEqual([100,80]);
    expect(readResultBinding(h.result)).toEqual(oldBinding);expect(h.result.fills).toEqual(oldFills);expect(readStoredOperation(h.result)).toEqual({status:"valid",operation});
    h.result.setSharedPluginData=write;
    await api.publishWorkRevision({snapshot:p.snapshot,canvasFrames:frames,imageBase64:Buffer.from(png).toString("base64")});
    expect(h.result.relativeTransform).toEqual([[.8,-.6,126],[.6,.8,192]]);expect([h.result.width,h.result.height]).toEqual([100,100]);
    const repeated=await proposal(api,ref(await state(api,h.scope)));
    await api.publishWorkRevision({snapshot:repeated.snapshot,imageBase64:Buffer.from(png).toString("base64")});
    expect(h.result.relativeTransform).toEqual([[.8,-.6,126],[.6,.8,192]]);expect([h.result.width,h.result.height]).toEqual([100,100]);
  });

  it.each(["cancel","expiry","renew","replace"])("preserves published raster work after late %s during transferred source preparation",async change=>{
    let now=1_800_000_000_000;vi.spyOn(Date,"now").mockImplementation(()=>now);
    const h=await fixture(),api=entry(kind),s=await state(api,h.scope),first=await proposal(api,ref(s));
    await api.publishWorkRevision({snapshot:first.snapshot,imageBase64:Buffer.from(png).toString("base64")});
    const current=await state(api,h.scope),p=await proposal(api,ref(current));
    const value={...h.scope,snapshot:p.snapshot,imageBase64:Buffer.from(png).toString("base64")},encoded=Buffer.from(JSON.stringify(value)).toString("base64");
    const scope={...h.scope,transferId:"e".repeat(64),payloadDigest:createHash("sha256").update(encoded).digest("hex")};
    let hash=2166136261;for(const byte of Buffer.from(encoded))hash=Math.imul(hash^byte,16777619)>>>0;
    const stage=async(next=scope)=>{for(let i=0;i<Math.ceil(encoded.length/32768);i++)await stagePublicationChunk({...next,count:Math.ceil(encoded.length/32768),length:encoded.length,checksum:hash.toString(16).padStart(8,"0"),index:i,chunk:encoded.slice(i*32768,(i+1)*32768)});};
    await stage();const beforeFills=structuredClone(h.result.fills),before=readResultBinding(h.result);
    let resume!:()=>void,reached!:()=>void;const paused=new Promise<void>(r=>{resume=r;}),entered=new Promise<void>(r=>{reached=r;});
    h.art.exportAsync.mockImplementationOnce(async()=>{reached();await paused;return png;});
    h.api.createImage.mockReturnValue({hash:"replacement-pixels"});
    const finalize=kind==="source"?finishWorkRevision:new Function(`${readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-work-revise-finalize.js",import.meta.url),"utf8")}\nreturn WorldbendFigmaHandoff.finishWorkRevision;`)();
    const pending=finalize(scope);await entered;
    const next=change==="replace"?{...scope,transferId:"f".repeat(64)}:scope;
    if(change==="expiry")now+=600001;else await cancelPublication(scope);
    if(change==="renew"||change==="replace")await stage(next);
    const retainedTransfer=h.result.getSharedPluginData("worldbend","publication-transfer");
    resume();expect(await pending).toMatchObject({status:"failed"});
    expect(h.result.fills).toEqual(beforeFills);expect(readResultBinding(h.result)).toEqual(before);
    if(change==="renew"||change==="replace") {
      expect(h.result.getSharedPluginData("worldbend","publication-transfer")).toBe(retainedTransfer);
      expect(await readPublication(next)).toEqual(value);
    }else await stage(next);
    expect(await finalize(next)).toMatchObject({status:"published"});
    expect(readResultBinding(h.result)?.revision).toBe(before!.revision+1);expect(h.result.fills[0].imageHash).toBe("replacement-pixels");
  });
  it("captures native media once and preserves exact byte proofs across later export jitter",async()=>{
    const h=await fixture(),api=entry(kind),s=await state(api,h.scope);
    h.art.clipsContent=true;h.art.fills=[{type:"SOLID",color:{r:1,g:1,b:1},opacity:1}];
    const pair=["iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGO4f//ifwAIvwOPpURLAgAAAABJRU5ErkJggg==",
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGO4d+/ifwAIuAONiWavmAAAAABJRU5ErkJggg=="].map(s=>Uint8Array.from(Buffer.from(s,"base64")));
    let count=0;h.art.exportAsync.mockImplementation(async()=>pair[count++%2]);
    const p=await proposal(api,{...ref(s),includeSourceRasters:true});
    expect(count).toBe(1);expect(p.snapshot.sourceState).toMatch(/^hash32x2:/);
    expect(p.rasters?.[0]?.base64).toBe(Buffer.from(pair[0]!).toString("base64"));
    const done=await api.publishWorkRevision({snapshot:p.snapshot,imageBase64:Buffer.from(png).toString("base64")});
    expect(done.revision).toBe(2);
    expect(h.result.fills).toEqual([expect.objectContaining({imageHash:"revision-pixels"})]);
  });

  it("keeps multipart native proposals coherent while rejecting intervening authoring changes",async()=>{
    const h=await fixture(),api=entry(kind),s=await state(api,h.scope);
    h.art.clipsContent=true;h.art.fills=[{type:"SOLID",color:{r:1,g:1,b:1},opacity:1}];
    let serial=0;h.art.exportAsync.mockImplementation(async()=>Uint8Array.from([...png,1+(serial++%2)]));
    const input={...ref(s),operation:{kind:"task" as const,task:{kind:"mesh" as const,spec:createMeshSpec(20,20)}}};
    const first=await api.readWorkRevision({...input,includeSourceRasters:true});
    expect(first.partCount).toBeGreaterThan(1);expect(first.sourceFingerprints).toHaveLength(1);
    const pages=[first.json];
    for(let part=1;part<first.partCount;part++)pages.push((await api.readWorkRevision({...input,part,token:first.token,sourceFingerprints:first.sourceFingerprints!})).json);
    const snapshot=JSON.parse(pages.join(""));expect(snapshot.sources[0].previewFingerprint).toBe(first.sourceFingerprints![0]);
    h.art.opacity=.5;
    await expect(api.readWorkRevision({...input,part:1,token:first.token,sourceFingerprints:first.sourceFingerprints!})).rejects.toThrow("E_FIGMA_CONFLICT");
  });

  it("rejects authoring changes during the source capture",async()=>{
    const h=await fixture(),api=entry(kind),s=await state(api,h.scope);
    h.art.clipsContent=true;h.art.fills=[{type:"SOLID",color:{r:1,g:1,b:1},opacity:1}];
    h.art.exportAsync.mockImplementationOnce(async()=>{h.art.clipsContent=false;return png;});
    await expect(api.readWorkRevision({...ref(s),includeSourceRasters:true})).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(readResultBinding(h.result)?.revision).toBe(1);expect(h.result.fills).toEqual([]);
  });

  it("rejects a native edit at the final image write despite unchanged PNG exports",async()=>{
    const h=await fixture(),api=entry(kind),s=await state(api,h.scope);
    h.art.clipsContent=true;h.art.fills=[{type:"SOLID",color:{r:1,g:1,b:1},opacity:1}];
    const p=await proposal(api,ref(s));
    h.api.createImage.mockImplementationOnce(()=>{h.art.clipsContent=false;return {hash:"revision-pixels"};});
    await expect(api.publishWorkRevision({snapshot:p.snapshot,imageBase64:Buffer.from(png).toString("base64")})).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(readResultBinding(h.result)?.revision).toBe(1);expect(h.result.fills).toEqual([]);
  });
  it("continues only published controls, keeping proposals and native fill edits out",async()=>{
    const h=await fixture(),api=entry(kind),s=await state(api,h.scope);
    expect(s.published).toBe(false);
    await expect(api.readWorkContinuation(h.scope)).rejects.toThrow("finish core publication");
    const p=await proposal(api,ref(s));
    await api.publishWorkRevision({snapshot:p.snapshot,imageBase64:Buffer.from(png).toString("base64")});
    const current=await state(api,h.scope);
    const altered={...transform,destination:{...transform.destination,quad:{...transform.destination.quad,tr:{x:.8,y:.1}}}};
    const proposed=await proposal(api,{...ref(current),operation:{kind:"transform",spec:altered}});
    expect(proposed.snapshot.operation.spec).toEqual(altered);
    const first=await api.readWorkContinuation({...h.scope,includeSourceRasters:true});
    const parts=[first.json];
    for(let part=1;part<first.partCount;part++)parts.push((await api.readWorkContinuation({...h.scope,part,token:first.token})).json);
    const snapshot=JSON.parse(parts.join(""));
    expect(snapshot).toMatchObject({schema:"worldbend.figma.work-continuation-snapshot",revision:2,
      operation:{kind:"transform",spec:transform},sourceNodeIds:[h.art.id],draftStatus:"absent"});
    expect("sourceRasters" in first && first.sourceRasters[0]?.nodeId).toBe(h.art.id);
    const before=readResultBinding(h.result);h.art.opacity=.4;
    await expect(api.readWorkContinuation({...h.scope,token:first.token})).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(readResultBinding(h.result)).toEqual(before);
    h.result.fills=[{type:"IMAGE",imageHash:"native-edit",scaleMode:"FILL"}];
    await expect(api.readWorkContinuation(h.scope)).rejects.toThrow("preserve the edited image");
  });
  it("continues the published task while excluding usable or damaged staged drafts",async()=>{
    const h=await fixture(),api=entry(kind),s=await state(api,h.scope);
    const task={kind:"mockup" as const,spec:defaultMockup([{sourceNodeId:h.art.id,sourceName:h.art.name,renderWidth:100,renderHeight:80,
      placement:{x:0,y:0,width:100,height:80},image:{} as HTMLImageElement}])};
    task.spec.planes=[task.spec.planes[0]!];
    const p=await proposal(api,{...ref(s),operation:{kind:"task",task}});
    await api.publishWorkRevision({snapshot:p.snapshot,imageBase64:Buffer.from(png).toString("base64")});
    const current=await state(api,h.scope);
    const draftTask=structuredClone(task);draftTask.spec.planes[0]!.opacity=.4;
    h.result.setSharedPluginData("worldbend","mockupDraft",JSON.stringify({schema:"worldbend.figma.mockup-draft",version:"0.1",baseRevision:current.revision,task:draftTask}));
    const get=async()=>{const first=await api.readWorkContinuation(h.scope),parts=[first.json];
      for(let part=1;part<first.partCount;part++)parts.push((await api.readWorkContinuation({...h.scope,part,token:first.token})).json);
      return JSON.parse(parts.join(""));};
    expect(await get()).toMatchObject({draftStatus:"pending",operation:{kind:"task",task}});
    h.result.setSharedPluginData("worldbend","mockupDraft","broken pending draft");
    await expect(api.readWorkState(h.scope)).rejects.toThrow("invalid pending draft");
    expect(await get()).toMatchObject({draftStatus:"unusable",operation:{kind:"task",task}});
    expect(h.result.getSharedPluginData("worldbend","mockupDraft")).toBe("broken pending draft");
  });
  it("publishes a core-resolved Canvas size at the saved density and rolls it back on failure",async()=>{
    const h=await fixture(),api=entry(kind);h.result.resize(50,40);const s=await state(api,h.scope);
    const operation={kind:"canvas" as const,spec:{schema:"worldbend.canvas" as const,version:"0.1" as const,operation:{kind:"trim" as const,alphaThreshold:64}}};
    const p=await proposal(api,{...ref(s),operation,includeSourceRasters:true});
    expect(p.snapshot).toMatchObject({renderWidth:100,renderHeight:80});
    const input={snapshot:p.snapshot,renderedSize:{width:1,height:1},imageBase64:Buffer.from(png).toString("base64")};
    const before=readResultBinding(h.result),write=h.result.setSharedPluginData;let failed=false;
    h.result.setSharedPluginData=(_ns:string,key:string,value:string)=>{if(key==="canvas"&&value&&!failed){failed=true;throw Error("Canvas write failed");}write(_ns,key,value);};
    await expect(api.publishWorkRevision(input)).rejects.toThrow("Canvas write failed");
    expect(readResultBinding(h.result)).toEqual(before);expect([h.result.width,h.result.height]).toEqual([50,40]);
    h.result.setSharedPluginData=write;
    await expect(api.publishWorkRevision({...input,renderedSize:{width:2,height:1}})).rejects.toThrow("E_FIGMA_RASTER");
    await api.publishWorkRevision(input);
    expect(readResultBinding(h.result)).toMatchObject({renderWidth:1,renderHeight:1,revision:2});
    expect([h.result.width,h.result.height]).toEqual([.5,.5]);
    const fresh=await state(api,h.scope);
    const again=await proposal(api,ref(fresh));
    await api.publishWorkRevision({...input,snapshot:again.snapshot});
    expect([h.result.width,h.result.height]).toEqual([.5,.5]);
    for(const [settings] of h.art.exportAsync.mock.calls.slice(1)) expect(settings).toMatchObject({constraint:{type:"SCALE",value:1}});
  });

  it("revises single-source geometry to two-source displacement and guards the control map",async()=>{
    const h=await fixture(),api=entry(kind),map=h.node(),s=await state(api,h.scope);
    const operation={kind:"task",task:{kind:"remap",spec:{schema:"worldbend.remap",version:"0.1",output:{width:100,height:80},
      operation:{kind:"displacement",xChannel:"red",yChannel:"green",scaleXPixels:8,scaleYPixels:4,neutral:128,boundary:"clamp"}}}};
    await expect(proposal(api,{...ref(s),operation})).rejects.toThrow("E_FIGMA_INPUT");
    const p=await proposal(api,{...ref(s),operation,sourceNodeIds:[h.art.id,map.id],includeSourceRasters:true});
    expect(p.rasters).toHaveLength(2);
    map.exportAsync.mockResolvedValueOnce(Uint8Array.from([...png,1]));
    await expect(api.publishWorkRevision({snapshot:p.snapshot,imageBase64:Buffer.from(png).toString("base64")})).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(readStoredOperation(h.result)).toEqual({status:"valid",operation:{kind:"transform",spec:transform}});
    await api.publishWorkRevision({snapshot:p.snapshot,imageBase64:Buffer.from(png).toString("base64")});
    expect(readResultBinding(h.result)?.sourceNodeIds).toEqual([h.art.id,map.id]);
    expect((await state(api,h.scope)).operation).toEqual(operation);
  });
  it("reads controls with missing old media and replaces the source without changing the mapping",async()=>{
    const h=await fixture(),api=entry(kind);h.result.setSharedPluginData("worldbend","mockupDraft","unrelated historical family bytes");h.art.remove();const s=await state(api,h.scope);
    expect(s.sourceNodeIds).toEqual([h.art.id]);expect(h.art.exportAsync).toHaveBeenCalledTimes(1);
    const replacement=h.node();replacement.width=200;replacement.height=50;
    const p=await proposal(api,{...ref(s),sourceNodeIds:[replacement.id],includeSourceRasters:true});
    expect(h.result.getSharedPluginData("worldbend","binding")).toContain(h.art.id);
    expect(p.rasters?.[0]?.base64).toBe(Buffer.from(png).toString("base64"));
    const done=await api.publishWorkRevision({snapshot:p.snapshot,imageBase64:Buffer.from(png).toString("base64")});
    expect(done).toMatchObject({nodeId:h.result.id,revision:2});expect(readResultBinding(h.result)?.sourceNodeIds).toEqual([replacement.id]);
    expect(readStoredOperation(h.result)).toEqual({status:"valid",operation:{kind:"transform",spec:transform}});
    expect(h.result.x).toBe(s.placement.x);expect(h.result.y).toBe(s.placement.y);
    expect((await state(api,h.scope)).sourceNodeIds).toEqual([replacement.id]);
    expect(h.result.getSharedPluginData("worldbend","mockupDraft")).toBe("unrelated historical family bytes");
  });
  it("changes output dimensions at the existing display density and atomically rolls back a failed state write",async()=>{
    const h=await fixture(),api=entry(kind);h.result.resize(50,40);const s=await state(api,h.scope);
    const operation={kind:"canvas" as const,spec:{schema:"worldbend.canvas" as const,version:"0.1" as const,operation:{kind:"stretch" as const,output:{width:120,height:60}}}};
    const p=await proposal(api,{...ref(s),operation,renderWidth:120,renderHeight:60});
    const before=readResultBinding(h.result),oldFills=h.result.fills;const write=h.result.setSharedPluginData;let failed=false;
    h.result.setSharedPluginData=(_ns:string,key:string,value:string)=>{if(key==="canvas"&&value&&!failed){failed=true;throw Error("native write failure");}write(_ns,key,value);};
    await expect(api.publishWorkRevision({snapshot:p.snapshot,imageBase64:Buffer.from(png).toString("base64")})).rejects.toThrow("native write failure");
    expect(readResultBinding(h.result)).toEqual(before);expect(h.result.fills).toEqual(oldFills);expect([h.result.width,h.result.height]).toEqual([50,40]);
    expect(readStoredOperation(h.result)).toEqual({status:"valid",operation:{kind:"transform",spec:transform}});
    h.result.setSharedPluginData=write;
    // Core serialization may reorder equivalent keys. Publication must still
    // compare complete values, not reject an otherwise identical proposal.
    const reordered={...p.snapshot,operation:JSON.parse(JSON.stringify(operation,(_k,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).reverse()):v))};
    await api.publishWorkRevision({snapshot:reordered,imageBase64:Buffer.from(png).toString("base64")});
    expect([h.result.width,h.result.height]).toEqual([60,30]);expect(readResultBinding(h.result)).toMatchObject({renderWidth:120,renderHeight:60,revision:2});
    expect(readStoredOperation(h.result)).toEqual({status:"valid",operation});
  });
  it("rejects changed pixels, native edits and cycles without replacing the old image",async()=>{
    const h=await fixture(),api=entry(kind),s=await state(api,h.scope);
    const p=await proposal(api,ref(s));h.art.exportAsync.mockResolvedValue(Uint8Array.from([...png,1]));
    await expect(api.publishWorkRevision({snapshot:p.snapshot,imageBase64:Buffer.from(png).toString("base64")})).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(readResultBinding(h.result)?.revision).toBe(1);expect(h.result.fills).toEqual([]);
    h.art.exportAsync.mockResolvedValue(png);h.result.opacity=.4;
    await expect(proposal(api,ref(s))).rejects.toThrow("E_FIGMA_CONFLICT");
    const actual=await state(api,h.scope);await expect(proposal(api,{...ref(actual),sourceNodeIds:[h.result.id]})).rejects.toThrow("E_FIGMA_INPUT");
    h.art.children.push(h.result);h.result.parent=h.art;
    const current=await state(api,h.scope);await expect(proposal(api,ref(current))).rejects.toThrow("E_FIGMA_CYCLE");
  });
  it("retrieves a large exact authored mesh in bounded parts and rejects mixed-version reads",async()=>{
    const h=await fixture(),api=entry(kind);
    const spec=createMeshSpec(100,80,16);
    for(const vertex of spec.mesh.vertices) if(vertex.source.x>0&&vertex.source.x<1&&vertex.source.y>0&&vertex.source.y<1) vertex.warped.x+=.00012345678912345;
    const operation={kind:"task" as const,task:{kind:"mesh" as const,spec}};
    writeStoredOperation(h.result,operation);h.art.remove();const first=await api.readWorkState(h.scope);
    expect(first.partCount).toBeGreaterThan(10);expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(20*1024);
    const s=await state(api,h.scope);expect(s.operation).toEqual(operation);expect(JSON.stringify(s)).not.toContain("operationJson");
    h.result.opacity=.6;await expect(api.readWorkState({...h.scope,part:1,token:first.token})).rejects.toThrow("E_FIGMA_CONFLICT");
    await expect(api.readWorkState({...h.scope,part:1})).rejects.toThrow("E_FIGMA_INPUT");
  });
  it("retains pending human controls on refresh and only adopts an explicitly matching draft",async()=>{
    const h=await fixture(),api=entry(kind);
    const task=continuedCompositionTask(defaultMockup([{sourceNodeId:h.art.id,sourceName:"Original",renderWidth:100,renderHeight:80,
      placement:{x:0,y:0,width:100,height:80},image:{} as HTMLImageElement}]));
    if(task.kind!=="composition")throw Error("Expected Composition");
    writeStoredOperation(h.result,{kind:"task",task});const pending=structuredClone(task);pending.template.operation.composition.planes[0]!.opacity=.4;
    h.result.setSharedPluginData("worldbend","mockupDraft",JSON.stringify({schema:"worldbend.figma.mockup-draft",version:"0.1",baseRevision:1,task:pending}));
    const s=await state(api,h.scope),replacement=h.node();
    expect(s.pendingDraft.task).toEqual(pending);
    await expect(proposal(api,{...ref(s),operation:{kind:"transform",spec:transform}})).rejects.toThrow("E_FIGMA_CONFLICT");
    const p=await proposal(api,{...ref(s),sourceNodeIds:[replacement.id]});
    await api.publishWorkRevision({snapshot:p.snapshot,imageBase64:Buffer.from(png).toString("base64")});
    expect(JSON.parse(h.result.getSharedPluginData("worldbend","mockupDraft"))).toMatchObject({baseRevision:2,task:pending});
    const actual=await state(api,h.scope),adopt=await proposal(api,{...ref(actual),operation:{kind:"task",task:pending}});
    await api.publishWorkRevision({snapshot:adopt.snapshot,imageBase64:Buffer.from(png).toString("base64")});
    expect(h.result.getSharedPluginData("worldbend","mockupDraft")).toBe("");expect(readStoredOperation(h.result)).toEqual({status:"valid",operation:{kind:"task",task:pending}});
  });
  it.each([false,true])("finishes actual staged revision payloads and clears owned transport on native conflict (%s)",async edited=>{
    const h=await fixture(),api=entry(kind),s=await state(api,h.scope);
    h.art.clipsContent=true;h.art.fills=[{type:"SOLID",color:{r:1,g:1,b:1},opacity:1}];
    let serial=0;h.art.exportAsync.mockImplementation(async()=>Uint8Array.from([...png,1+(serial++%2)]));
    const p=await proposal(api,ref(s));
    const input={...h.scope,snapshot:p.snapshot,imageBase64:Buffer.from(png).toString("base64")};
    const encoded=Buffer.from(JSON.stringify(input)).toString("base64"),scope={...h.scope,transferId:"b".repeat(64),payloadDigest:createHash("sha256").update(encoded).digest("hex")};
    let hash=2166136261;for(let i=0;i<encoded.length;i++)hash=Math.imul(hash^encoded.charCodeAt(i),16777619)>>>0;
    const count=Math.ceil(encoded.length/32768);for(let index=0;index<count;index++)await stagePublicationChunk({...scope,count,length:encoded.length,
      checksum:hash.toString(16).padStart(8,"0"),index,chunk:encoded.slice(index*32768,(index+1)*32768)});
    if(edited)h.result.opacity=.4;
    let receipt;
    if(kind==="source")receipt=await finishWorkRevision(scope);
    else {
      const transport=new Function(`${readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-publication-runtime.js",import.meta.url),"utf8")}\nreturn WorldbendFigmaRuntimeTransport;`)();
      const code=Buffer.from(readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-work-revise-finalize.js",import.meta.url))).toString("base64");
      const digest=createHash("sha256").update(code).digest("hex"),chunks=Math.ceil(code.length/32768);
      for(let index=0;index<chunks;index++)await transport.stageRuntimeChunk({...scope,index,count:chunks,length:code.length,digest,chunk:code.slice(index*32768,(index+1)*32768)});
      receipt=await transport.executeTrustedRuntime({...scope,digest,method:"finishWorkRevision"});
      expect(h.result.getSharedPluginData("worldbend","publication-runtime")).toBe("");
      for(let index=0;index<chunks;index++)expect(h.result.getSharedPluginData("worldbend",`publication-runtime-chunk-${index}`)).toBe("");
    }
    expect(receipt).toMatchObject(edited?{status:"failed",error:{code:"E_FIGMA_CONFLICT"}}:{status:"published",snapshot:{revision:2}});
    expect(h.result.getSharedPluginData("worldbend","publication-transfer")).toBe("");for(let i=0;i<64;i++)expect(h.result.getSharedPluginData("worldbend",`publication-chunk-${i}`)).toBe("");
    expect(readResultBinding(h.result)?.revision).toBe(edited?1:2);
  });
});
