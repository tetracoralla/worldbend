import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as creation from "./agent-work-create";
import * as linked from "./agent-linked-update";
import { readStoredOperation } from "./stored-operation";
import { writeStoredBinding } from "./stored-binding";
import type { StoredOperation } from "./stored-operation";
import { createMeshSpec } from "./mesh-workspace";

const transform = { schema:"worldbend.transform" as const,version:"0.1" as const,
  destination:{space:"normalized" as const,quad:{tl:{x:0,y:0},tr:{x:1,y:0},br:{x:1,y:1},bl:{x:0,y:1}}},content:{fit:"stretch" as const} };
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=","base64"));

function host() {
  let serial=0;
  const registry=new Map<string,any>();
  const page:any={id:"page",type:"PAGE",removed:false,children:[],parent:null};registry.set(page.id,page);
  function node(type="FRAME") {
    const shared=new Map<string,string>();
    const n:any={id:`n-${++serial}`,type,name:"Artwork",parent:page,children:[],visible:true,removed:false,
      x:0,y:0,width:100,height:80,opacity:1,blendMode:"NORMAL",fills:[],strokes:[],effects:[],
      relativeTransform:[[1,0,0],[0,1,0]],absoluteTransform:[[1,0,0],[0,1,0]],
      get absoluteBoundingBox(){return {x:n.x,y:n.y,width:n.width,height:n.height};},
      getSharedPluginData:(_ns:string,key:string)=>shared.get(key)??"",
      setSharedPluginData:(_ns:string,key:string,value:string)=>shared.set(key,value),
      resize(w:number,h:number){n.width=w;n.height=h;},
      remove(){n.removed=true;n.parent.children=n.parent.children.filter((c:any)=>c!==n);},
      appendChild(child:any){child.parent.children=child.parent.children.filter((c:any)=>c!==child);child.parent=n;n.children.push(child);},
      exportAsync:vi.fn(async()=>png)};
    page.children.push(n);registry.set(n.id,n);return n;
  }
  const source=node();
  const api:any={fileKey:"file",currentPage:page,mixed:Symbol("mixed"),
    getNodeByIdAsync:vi.fn(async(id:string)=>registry.get(id)??null),
    createRectangle:vi.fn(()=>node("RECTANGLE")),createImage:vi.fn(()=>({hash:"real-publication-fixture"})),
    base64Encode:(bytes:Uint8Array)=>Buffer.from(bytes).toString("base64"),
    base64Decode:(value:string)=>Uint8Array.from(Buffer.from(value,"base64"))};
  vi.stubGlobal("figma",api);return {page,source,api,node,registry};
}
function entry(kind:"source"|"bundled"):typeof creation & typeof linked {
  if(kind==="source") return {...creation,...linked};
  const runtime=(name:string)=>readFileSync(new URL(`../../../crates/worldbend-mcp/src/figma-runtime-${name}.js`,import.meta.url),"utf8");
  return new Function(`${runtime("work-create")}\nconst create=WorldbendFigmaHandoff;\n${runtime("linked-update")}\nconst read=WorldbendFigmaHandoff;\n${runtime("linked-publish")}\nreturn {...create,...read,...WorldbendFigmaHandoff};`)();
}
afterEach(()=>vi.unstubAllGlobals());

describe.each(["source","bundled"] as const)("Cold linked raster work (%s)",kind=>{
  it("places new work clear of artwork added while a source lookup is pending",async()=>{
    const h=host(),api=entry(kind),get=h.api.getNodeByIdAsync.getMockImplementation()!;
    let obstacle:any;
    h.api.getNodeByIdAsync.mockImplementation(async(id:string)=>{
      const value=await get(id);
      if(id===h.source.id&&!obstacle){obstacle=h.node("RECTANGLE");obstacle.x=148;obstacle.y=0;}
      return value;
    });
    const made=await api.createWork({fileKey:"file",pageId:"page",sourceNodeIds:[h.source.id],
      operation:{kind:"transform",spec:transform},renderWidth:100,renderHeight:80,requestId:"fresh-placement"});
    const result=h.registry.get(made.snapshot.nodeId);
    expect(obstacle).toBeDefined();
    expect(result.x+result.width<=obstacle.x||result.x>=obstacle.x+obstacle.width||
      result.y+result.height<=obstacle.y||result.y>=obstacle.y+obstacle.height).toBe(true);
    expect(h.source).toMatchObject({x:0,y:0,width:100,height:80});
  });

  it("rejects competing original identity owners nested under an existing page root",async()=>{
    const h=host(),api=entry(kind);
    const input={fileKey:"file",pageId:"page",sourceNodeIds:[h.source.id],
      operation:{kind:"transform" as const,spec:transform},renderWidth:100,renderHeight:80,requestId:"ambiguous-work"};
    const made=await api.createWork(input),result=h.registry.get(made.snapshot.nodeId);
    const parent=h.node(),other=h.node("RECTANGLE");parent.appendChild(result);parent.appendChild(other);
    const marker=JSON.parse(result.getSharedPluginData("worldbend","workCreation"));
    other.setSharedPluginData("worldbend","workCreation",JSON.stringify({...marker,nodeId:other.id}));
    const count=h.api.createRectangle.mock.calls.length;
    await expect(api.createWork(input)).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(h.api.createRectangle.mock.calls.length).toBe(count);
    expect(result.removed).toBe(false);expect(other.removed).toBe(false);
  });

  it.each(["crop","trim","pad"] as const)("resolves %s from 1x source media without caller-sized output",async family=>{
    const h=host(),api=entry(kind);
    const operation:StoredOperation={kind:"canvas",spec:{schema:"worldbend.canvas",version:"0.1",operation:family==="crop"
      ? {kind:"crop",rect:{x:0,y:0,width:1,height:1}} : family==="trim" ? {kind:"trim",alphaThreshold:0}
      : {kind:"pad",insets:{top:1,right:2,bottom:3,left:4},background:{kind:"transparent"}}}};
    const input={fileKey:"file",pageId:"page",sourceNodeIds:[h.source.id],operation,requestId:`dynamic-${family}`};
    const made=await api.createWork(input),result=h.registry.get(made.snapshot.nodeId);
    expect(made).toMatchObject({status:"needs-publication",snapshot:{renderWidth:100,renderHeight:80}});
    const plan=await api.inspectLinkedResults({fileKey:"file",pageId:"page",sourceNodeId:h.source.id});
    const snapshot=await api.inspectLinkedResult({plan,nodeId:result.id,completed:[],includeSourceRasters:true});
    // Geometry/alpha resolution is tested through actual decoded core pixels.
    // This native adapter test verifies the returned dimension is accepted and
    // source sampling never changes to match the cropped result on repetition.
    const done=await api.publishLinkedImage({...snapshot,plan,completed:[],renderWidth:1,renderHeight:1,imageBase64:Buffer.from(png).toString("base64")});
    expect([result.width,result.height]).toEqual([1,1]);
    expect(done).toMatchObject({renderWidth:1,renderHeight:1,revision:2,placement:{width:1,height:1}});
    for(const [settings] of h.source.exportAsync.mock.calls) expect(settings).toMatchObject({constraint:{type:"SCALE",value:1}});
    expect(await api.createWork(input)).toMatchObject({reused:true,status:"published",snapshot:{renderWidth:1,renderHeight:1}});
    const again=await api.inspectLinkedResults({fileKey:"file",pageId:"page",sourceNodeId:h.source.id});
    const fresh=await api.inspectLinkedResult({plan:again,nodeId:result.id,completed:[]});
    await expect(api.publishLinkedImage({...fresh,plan:again,completed:[],renderWidth:2,renderHeight:1,imageBase64:Buffer.from(png).toString("base64")})).rejects.toThrow("E_FIGMA_RASTER");
    expect(result.width).toBe(1);
    // A repaired work can outlive its original source. The creation retry
    // must inspect its current bindings before resolving a new viewport.
    h.source.remove();const replacement=h.node();
    writeStoredBinding(result,{sourceNodeIds:[replacement.id],renderWidth:1,renderHeight:1});
    expect(await api.createWork(input)).toMatchObject({reused:true,status:"published",snapshot:{revision:3,sourceNodeIds:[replacement.id]}});
  });

  it("places a first expanded publication clear of adjacent content and retains later positions",async()=>{
    const h=host(),api=entry(kind);h.source.resize(1,1);
    const operation:StoredOperation={kind:"canvas",spec:{schema:"worldbend.canvas",version:"0.1",operation:
      {kind:"pad",insets:{top:1,right:2,bottom:3,left:4},background:{kind:"transparent"}}}};
    const made=await api.createWork({fileKey:"file",pageId:"page",sourceNodeIds:[h.source.id],operation,requestId:"expanding-pad"});
    const result=h.registry.get(made.snapshot.nodeId),start={x:result.x,y:result.y};
    for(const key of ["width","height"]){let value=result[key];Object.defineProperty(result,key,
      {enumerable:false,get:()=>value,set:next=>{value=next;}});}
    // Live Figma may expose fresh proxy wrappers for the same node/Page.
    // Native identity is the ID, not JavaScript object equality.
    result.parent={...h.page};
    h.page.children=h.page.children.map((n:any)=>n.id===result.id?{...n}:n);
    const obstacle=h.node("RECTANGLE");obstacle.x=result.x+result.width+1;obstacle.y=result.y;obstacle.resize(2,5);
    const plan=await api.inspectLinkedResults({fileKey:"file",pageId:"page",sourceNodeId:h.source.id});
    const snapshot=await api.inspectLinkedResult({plan,nodeId:result.id,completed:[]});
    const imageBase64="iVBORw0KGgoAAAANSUhEUgAAAAcAAAAFCAYAAACJmvbYAAAAD0lEQVR4nGP4jwcwDIAkAIE0i3UsWLUUAAAAAElFTkSuQmCC";
    const done=await api.publishLinkedImage({...snapshot,plan,completed:[],renderWidth:7,renderHeight:5,imageBase64});
    expect(result.x!==start.x||result.y!==start.y).toBe(true);
    expect(result.x+result.width<=obstacle.x||result.x>=obstacle.x+obstacle.width||result.y+result.height<=obstacle.y||result.y>=obstacle.y+obstacle.height).toBe(true);
    expect(done.placement).toEqual({x:result.x,y:result.y,width:7,height:5});
    const next={x:result.x,y:result.y};obstacle.x=result.x;obstacle.y=result.y;
    const again=await api.inspectLinkedResults({fileKey:"file",pageId:"page",sourceNodeId:h.source.id});
    const fresh=await api.inspectLinkedResult({plan:again,nodeId:result.id,completed:[]});
    await api.publishLinkedImage({...fresh,plan:again,completed:[],renderWidth:7,renderHeight:5,imageBase64});
    expect({x:result.x,y:result.y}).toEqual(next);
  });

  it("rejects an oversized 1x source without leaving an empty Canvas result",async()=>{
    const h=host(),api=entry(kind);h.source.width=4097;
    await expect(api.createWork({fileKey:"file",pageId:"page",sourceNodeIds:[h.source.id],requestId:"oversized-canvas",
      operation:{kind:"canvas",spec:{schema:"worldbend.canvas",version:"0.1",operation:{kind:"trim",alphaThreshold:0}}},
      renderWidth:100,renderHeight:80})).rejects.toThrow("E_FIGMA_LIMIT");
    expect(h.page.children.filter((n:any)=>!n.removed&&n.type==="RECTANGLE")).toHaveLength(0);
  });

  it.each(["transform","canvas","mesh","rectify","lens","displacement"] as const)("creates, exports, publishes and recovers %s after native reparenting",async family=>{
    const h=host(),api=entry(kind);
    const operation:StoredOperation=family==="transform" ? {kind:"transform",spec:transform} :
      family==="canvas" ? {kind:"canvas",spec:{schema:"worldbend.canvas",version:"0.1",operation:{kind:"contain",output:{width:100,height:80},anchor:{x:.5,y:.5},background:{kind:"transparent"}}}} :
      family==="mesh" ? {kind:"task",task:{kind:"mesh",spec:createMeshSpec(100,80,4)}} :
      family==="rectify" ? {kind:"rectify",spec:{schema:"worldbend.rectify",version:"0.1",source:{space:"normalized",quad:transform.destination.quad},output:{width:100,height:80}}} :
      {kind:"task",task:{kind:"remap",spec:{schema:"worldbend.remap",version:"0.1",output:{width:100,height:80},operation:family==="lens"
        ? {kind:"lens",coefficients:{k1:.2,k2:0,k3:0,p1:0,p2:0},center:{x:.5,y:.5},scale:{x:.5,y:.5}}
        : {kind:"displacement",xChannel:"red",yChannel:"green",scaleXPixels:10,scaleYPixels:5,neutral:128,boundary:"clamp"}}}};
    const sourceNodeIds=family==="displacement" ? [h.source.id,h.node().id] : [h.source.id];
    const input={fileKey:"file",pageId:"page",sourceNodeIds,operation,renderWidth:100,renderHeight:80,requestId:`cold-${family}`};
    const made=await api.createWork(input),result=h.registry.get(made.snapshot.nodeId);
    expect(made).toMatchObject({reused:false,status:"needs-publication",snapshot:{revision:1,operation,sourceNodeIds}});
    expect(result.fills).toEqual([]);expect(readStoredOperation(result)).toEqual({status:"valid",operation});
    const folder=h.node();folder.appendChild(result);
    expect(await api.createWork(input)).toMatchObject({reused:true,snapshot:{nodeId:result.id}});
    const plan=await api.inspectLinkedResults({fileKey:"file",pageId:"page",sourceNodeId:h.source.id});
    const snapshot=await api.inspectLinkedResult({plan,nodeId:result.id,completed:[],includeSourceRasters:true});
    if (!("sourceRasters" in snapshot)) throw Error("Creation continuation did not return the requested source media");
    expect(snapshot.sourceRasters?.[0]?.base64).toBe(Buffer.from(png).toString("base64"));
    expect(snapshot.sourceRasters).toHaveLength(sourceNodeIds.length);
    const done=await api.publishLinkedImage({...snapshot,plan,completed:[],imageBase64:Buffer.from(png).toString("base64")});
    expect(done.revision).toBe(2);expect(await api.createWork(input)).toMatchObject({reused:true,status:"published",snapshot:{nodeId:result.id,revision:2,operation}});
    expect(h.source.fills).toEqual([]);expect(h.source.parent).toBe(h.page);
    const changed=structuredClone(input);changed.renderWidth=110;
    await expect(api.createWork(changed)).rejects.toThrow("E_FIGMA_CONFLICT");
    h.source.exportAsync.mockResolvedValue(Uint8Array.from([...png,1]));
    await expect(api.publishLinkedImage({...snapshot,plan,completed:[],imageBase64:Buffer.from(png).toString("base64")})).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(result.fills[0].imageHash).toBe("real-publication-fixture");
  });

  it("serializes retries, removes untouched failed results and retains native edits for recovery",async()=>{
    const h=host(),api=entry(kind);
    const input={fileKey:"file",pageId:"page",sourceNodeIds:[h.source.id],operation:{kind:"transform" as const,spec:transform},renderWidth:100,renderHeight:80,requestId:"retry-work"};
    const both=await Promise.all([api.createWork(input),api.createWork(input)]);
    expect(both[0].snapshot.nodeId).toBe(both[1].snapshot.nodeId);
    expect(both.map(v=>v.reused).sort()).toEqual([false,true]);
    const before=h.page.children.length;
    h.source.exportAsync.mockRejectedValueOnce(Error("source export failed"));
    await expect(api.createWork({...input,requestId:"failed-clean"})).rejects.toThrow("source export failed");
    expect(h.page.children.length).toBe(before);
    h.source.exportAsync.mockImplementationOnce(async()=>{
      const own=[...h.registry.values()].find(n=>n.type==="RECTANGLE"&&!n.removed&&n.getSharedPluginData("worldbend","workCreation").includes("edited-recovery"));
      own.opacity=.4;throw Error("source export failed");
    });
    await expect(api.createWork({...input,requestId:"edited-recovery"})).rejects.toThrow("source export failed");
    const recovered=await api.createWork({...input,requestId:"edited-recovery"});
    expect(recovered.reused).toBe(true);expect(h.registry.get(recovered.snapshot.nodeId).opacity).toBe(.4);
  });

  it("rejects invalid slots and ownership without native writes",async()=>{
    const h=host(),api=entry(kind);
    const input={fileKey:"file",pageId:"page",sourceNodeIds:[h.source.id],operation:{kind:"transform" as const,spec:transform},renderWidth:100,renderHeight:80,requestId:"invalid"};
    await expect(api.createWork({...input,sourceNodeIds:[h.source.id,h.source.id]})).rejects.toThrow("E_FIGMA_INPUT");
    await expect(api.createWork({...input,fileKey:"wrong"})).rejects.toThrow("E_FIGMA_SCOPE");
    await expect(api.createWork({...input,operation:{...input.operation,extra:true} as any})).rejects.toThrow("E_FIGMA_INPUT");
    expect(h.api.createRectangle).not.toHaveBeenCalled();
  });
});
