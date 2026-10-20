import { SHARED_RASTER_PAINT_KEY, writeRasterPaintProof } from "./raster-paint-guard";
import { stagePublicationChunk,cancelPublication,readPublication } from "./agent-handoff-media";
import { finishLinkedPublication } from "./agent-linked-update-finalize";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as sourceHandoff from "./agent-linked-results";
import { linkedTargetExpected } from "./agent-linked-results";
import { writeStoredBinding } from "./stored-binding";
import { writeStoredOperation } from "./stored-operation";
import type { TransformSpec } from "@worldbend/web/types";
import { defaultMockup } from "./mockup-workspace";
import { deformationWorkFromMesh } from "./deformation-work-state";
import { createMeshSpec } from "./mesh-workspace";
import { deformationTask } from "./stored-designer-task";
import { continuedCompositionTask } from "./stored-designer-task";
import type { FigmaSpatialEffectTask } from "./stored-designer-task";
import { byteFingerprint } from "./agent-handoff";
import { createHash } from "node:crypto";

const transform: TransformSpec = { schema: "worldbend.transform", version: "0.1",
  destination: { space: "normalized", quad: { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 },
    br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } } }, content: { fit: "stretch" } };

function host() {
  const registry = new Map<string, any>();
  const writes = vi.fn();
  const page: any = { id: "page", type: "PAGE", removed: false, children: [] };
  registry.set(page.id, page);
  function node(id: string, parent = page, type = "RECTANGLE") {
    const values = new Map<string, string>();
    const node: any = { id, name: id, type, parent, removed: false, visible: true, children: [], width: 100, height: 80,
      x: 0, y: 0, opacity: 1, fills: [], strokes: [], effects: [],
      relativeTransform: [[1, 0, 0], [0, 1, 0]],
      getSharedPluginData: (_namespace: string, key: string) => values.get(key) ?? "",
      setSharedPluginData: (_namespace: string, key: string, value: string) => { writes(); values.set(key, value); },
      exportAsync: vi.fn(async () => Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"))),
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 80 }, values };
    parent.children.push(node); registry.set(id, node); return node;
  }
  const api: any = { fileKey: "file", currentPage: page, getNodeByIdAsync: vi.fn(async (id: string) => registry.get(id) ?? null),
    createImage: vi.fn(() => ({ hash: "new-pixels" })) };
  vi.stubGlobal("figma", api);
  const source = node("source");
  const bind = (node: any, ids: string[]) => {
    writeStoredBinding(node, { sourceNodeIds: ids, renderWidth: 100, renderHeight: 80 });
    writeStoredOperation(node, { kind: "transform", spec: transform });
    writes.mockClear();
  };
  return { page, node, source, api, writes, bind };
}

afterEach(() => {vi.unstubAllGlobals();vi.restoreAllMocks();});

function closedArtwork(source:any) {
  source.type="FRAME";source.clipsContent=true;source.blendMode="PASS_THROUGH";
  source.absoluteTransform=[[1,0,0],[0,1,0]];
  source.fills=[{type:"SOLID",color:{r:1,g:1,b:1},opacity:1}];
}

// Two valid PNGs with the observed one-level RGB jitter, not corrupt encodings.
const jitterPair=["iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGO4f//ifwAIvwOPpURLAgAAAABJRU5ErkJggg==",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGO4d+/ifwAIuAONiWavmAAAAABJRU5ErkJggg=="].map(encoded=>Uint8Array.from(Buffer.from(encoded,"base64"))) as [Uint8Array,Uint8Array];

describe.each(["source","bundled-state"] as const)("closed-scene transfer finalization (%s)",entry=>{
  it.each([false,true])("accepts export jitter but rejects a last-edge native edit (%s)",async edited=>{
    const h=host();closedArtwork(h.source);const result=h.node("result");h.bind(result,[h.source.id]);
    const [png,jitter]=jitterPair;let count=0;
    h.source.exportAsync.mockImplementation(async()=>++count%2?png:jitter);
    const plan=await sourceHandoff.inspectLinkedResults({fileKey:"file",pageId:"page",sourceNodeId:h.source.id});
    const snapshot=await sourceHandoff.inspectLinkedResult({plan,nodeId:result.id,completed:[]});
    const scope={fileKey:"file",pageId:"page",nodeId:result.id,transferId:"d".repeat(64)};
    const encoded=Buffer.from(JSON.stringify({...snapshot,plan,completed:[],imageBase64:btoa("core pixels".repeat(6000))})).toString("base64");
    let hash=2166136261;for(let i=0;i<encoded.length;i++)hash=Math.imul(hash^encoded.charCodeAt(i),16777619)>>>0;
    Object.assign(scope,{payloadDigest:createHash("sha256").update(encoded).digest("hex")});
    const chunks=Math.ceil(encoded.length/32768);
    for(let index=0;index<chunks;index++)await stagePublicationChunk({...scope,count:chunks,length:encoded.length,checksum:hash.toString(16).padStart(8,"0"),index,chunk:encoded.slice(index*32768,(index+1)*32768)});
    if(edited)h.api.createImage.mockImplementationOnce(()=>{h.source.clipsContent=false;return {hash:"new-pixels"};});
    const finish=entry==="source"?finishLinkedPublication:new Function(`${readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-linked-finalize.js",import.meta.url),"utf8")}\nreturn WorldbendFigmaHandoff.finishLinkedPublication;`)();
    const receipt=await finish(scope);
    expect(receipt).toMatchObject(edited?{status:"failed",error:{code:"E_FIGMA_CONFLICT"}}:{status:"published",snapshot:{revision:2,sourceState:snapshot.sourceState,sources:snapshot.sources}});
    expect(result.values.get("publication-transfer")).toBe("");
    expect(result.fills).toEqual(edited?[]:[expect.objectContaining({imageHash:"new-pixels"})]);
  });
});

describe("trusted large-runtime transport",()=>{
  it.each(["intact","corrupt-code","forged-manifest","late-edit"])("verifies full source before executing (%s)",async mode=>{
    const h=host();closedArtwork(h.source);const result=h.node("result");h.bind(result,[h.source.id]);
    const plan=await sourceHandoff.inspectLinkedResults({fileKey:"file",pageId:"page",sourceNodeId:h.source.id});
    const snapshot=await sourceHandoff.inspectLinkedResult({plan,nodeId:result.id,completed:[]});
    const scope={fileKey:"file",pageId:"page",nodeId:result.id,transferId:"f".repeat(64)};
    const payload=Buffer.from(JSON.stringify({...snapshot,plan,completed:[],imageBase64:btoa("core pixels")})).toString("base64");
    Object.assign(scope,{payloadDigest:createHash("sha256").update(payload).digest("hex")});
    let sum=2166136261;for(let i=0;i<payload.length;i++)sum=Math.imul(sum^payload.charCodeAt(i),16777619)>>>0;
    await stagePublicationChunk({...scope,index:0,count:1,length:payload.length,checksum:sum.toString(16).padStart(8,"0"),chunk:payload});
    const transport=new Function(`${readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-publication-runtime.js",import.meta.url),"utf8")}\nreturn WorldbendFigmaRuntimeTransport;`)();
    const encoded=Buffer.from(readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-linked-finalize.js",import.meta.url))).toString("base64");
    const digest=createHash("sha256").update(encoded).digest("hex"),count=Math.ceil(encoded.length/32768);
    for(let index=0;index<count;index++)await transport.stageRuntimeChunk({...scope,index,count,length:encoded.length,digest,chunk:encoded.slice(index*32768,(index+1)*32768)});
    if(mode==="corrupt-code")result.setSharedPluginData("worldbend","publication-runtime-chunk-0",(encoded[0]==="A"?"B":"A")+encoded.slice(1,32768));
    if(mode==="forged-manifest") {
      const meta=JSON.parse(result.values.get("publication-runtime"));meta.digest="0".repeat(64);
      result.setSharedPluginData("worldbend","publication-runtime",JSON.stringify(meta));
    }
    if(mode==="late-edit")h.api.createImage.mockImplementationOnce(()=>{h.source.opacity=.5;return {hash:"new-pixels"};});
    const run=()=>transport.executeTrustedRuntime({...scope,digest,method:"finishLinkedPublication"});
    if(mode==="corrupt-code"||mode==="forged-manifest") {
      await expect(run()).rejects.toThrow(mode==="corrupt-code"?"E_FIGMA_INTEGRITY":"E_FIGMA_STATE");
      expect(h.api.createImage).not.toHaveBeenCalled();expect(result.fills).toEqual([]);
      const media=new Function(`${readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-media.js",import.meta.url),"utf8")}\nreturn WorldbendFigmaMedia;`)();
      await expect(media.cancelPublication({...scope,transferId:"e".repeat(64)})).rejects.toThrow("E_FIGMA_CONFLICT");
      expect(result.values.get("publication-runtime-chunk-0")).not.toBe("");
      await media.cancelPublication(scope);
      expect(result.values.get("publication-transfer")).toBe("");
      expect(result.values.get("publication-runtime")).toBe("");
      for(let i=0;i<count;i++)expect(result.values.get(`publication-runtime-chunk-${i}`)).toBe("");
      expect(h.api.createImage).not.toHaveBeenCalled();
    }else {
      expect(await run()).toMatchObject(mode==="intact"?{status:"published",snapshot:{revision:2}}:{status:"failed",error:{code:"E_FIGMA_CONFLICT"}});
      expect(result.values.get("publication-runtime")).toBe("");
      for(let i=0;i<count;i++)expect(result.values.get(`publication-runtime-chunk-${i}`)).toBe("");
      expect(result.fills).toEqual(mode==="intact"?[expect.objectContaining({imageHash:"new-pixels"})]:[]);
    }
  });
  it("clears expired code when a new argument transfer replaces it",async()=>{
    const h=host(),result=h.node("result");h.bind(result,[h.source.id]);
    const media=new Function(`${readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-media.js",import.meta.url),"utf8")}\nreturn WorldbendFigmaMedia;`)();
    const transport=new Function(`${readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-publication-runtime.js",import.meta.url),"utf8")}\nreturn WorldbendFigmaRuntimeTransport;`)();
    const scope={fileKey:"file",pageId:"page",nodeId:result.id,transferId:"a".repeat(64)};
    const payload=btoa(JSON.stringify(scope));let sum=2166136261;
    for(let i=0;i<payload.length;i++)sum=Math.imul(sum^payload.charCodeAt(i),16777619)>>>0;
    const chunk={...scope,index:0,count:1,length:payload.length,checksum:sum.toString(16).padStart(8,"0"),chunk:payload};
    await media.stagePublicationChunk(chunk);
    const code=btoa("throw Error('old code must never execute')");
    const digest=createHash("sha256").update(code).digest("hex");
    await transport.stageRuntimeChunk({...scope,index:0,count:1,length:code.length,digest,chunk:code});
    const active=JSON.parse(result.values.get("publication-transfer"));active.expiresAt=0;
    result.setSharedPluginData("worldbend","publication-transfer",JSON.stringify(active));
    const next={...chunk,transferId:"b".repeat(64)};await media.stagePublicationChunk(next);
    expect(result.values.get("publication-runtime")).toBe("");
    expect(result.values.get("publication-runtime-chunk-0")).toBe("");
    expect(JSON.parse(result.values.get("publication-transfer")).transferId).toBe(next.transferId);
    await expect(transport.executeTrustedRuntime({...scope,digest,method:"finishLinkedPublication"})).rejects.toThrow("E_FIGMA_STATE");
    expect(h.api.createImage).not.toHaveBeenCalled();expect(result.fills).toEqual([]);
    expect(JSON.parse(result.values.get("binding")).revision).toBe(1);
    await media.cancelPublication(next);
  });
});

describe.each(["source", "bundled"] as const)("linked transfer finalization (%s)", entry => {
  it.each(["cancel","expiry","renew","replace"])("preserves an existing linked raster through late %s and fresh finalization",async change=>{
    let now=1_800_000_000_000;vi.spyOn(Date,"now").mockImplementation(()=>now);
    const h=host(),result=h.node("result");h.bind(result,[h.source.id]);
    const inspect=async()=>{const plan=await sourceHandoff.inspectLinkedResults({fileKey:"file",pageId:"page",sourceNodeId:h.source.id});
      return {...await sourceHandoff.inspectLinkedResult({plan,nodeId:result.id,completed:[]}),plan,completed:[],imageBase64:btoa("core pixels")};};
    await sourceHandoff.publishLinkedImage(await inspect());const input=await inspect(),beforeFills=structuredClone(result.fills),before=result.values.get("binding");
    const encoded=Buffer.from(JSON.stringify(input)).toString("base64"),scope={fileKey:"file",pageId:"page",nodeId:result.id,transferId:"c".repeat(64),payloadDigest:createHash("sha256").update(encoded).digest("hex")};
    let hash=2166136261;for(const byte of Buffer.from(encoded))hash=Math.imul(hash^byte,16777619)>>>0;
    const stage=async(next=scope)=>{for(let i=0;i<Math.ceil(encoded.length/32768);i++)await stagePublicationChunk({...next,count:Math.ceil(encoded.length/32768),length:encoded.length,checksum:hash.toString(16).padStart(8,"0"),index:i,chunk:encoded.slice(i*32768,(i+1)*32768)});};
    await stage();let resume!:()=>void,reached!:()=>void;
    const paused=new Promise<void>(r=>{resume=r;}),entered=new Promise<void>(r=>{reached=r;});
    const original=h.source.exportAsync.getMockImplementation()!;
    h.source.exportAsync.mockImplementationOnce(async()=>{reached();await paused;return original();});
    h.api.createImage.mockReturnValue({hash:"replacement-pixels"});
    const finish=entry==="source"?finishLinkedPublication:new Function(`${readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-linked-finalize.js",import.meta.url),"utf8")}\nreturn WorldbendFigmaHandoff.finishLinkedPublication;`)();
    const pending=finish(scope);await entered;const next=change==="replace"?{...scope,transferId:"d".repeat(64)}:scope;
    if(change==="expiry")now+=600001;else await cancelPublication(scope);
    if(change==="renew"||change==="replace")await stage(next);
    const retainedTransfer=result.values.get("publication-transfer");resume();
    expect(await pending).toMatchObject({status:"failed"});expect(result.fills).toEqual(beforeFills);expect(result.values.get("binding")).toBe(before);
    if(change==="renew"||change==="replace") {
      expect(result.values.get("publication-transfer")).toBe(retainedTransfer);expect(await readPublication(next)).toEqual(input);
    }else await stage(next);
    expect(await finish(next)).toMatchObject({status:"published"});expect(result.fills[0].imageHash).toBe("replacement-pixels");
  });
  it.each([false, true])("publishes or rejects a concurrent native edit (%s), clearing its own transport", async edited => {
    const h = host(), result = h.node("result");
    h.bind(result, [h.source.id]);
    const plan = await sourceHandoff.inspectLinkedResults({ fileKey: "file", pageId: "page", sourceNodeId: h.source.id });
    const snapshot = await sourceHandoff.inspectLinkedResult({ plan, nodeId: result.id, completed: [] });
    const input = { ...snapshot, plan, completed: [], imageBase64: btoa("new core pixels".repeat(5000)) };
    const scope = { fileKey: "file", pageId: "page", nodeId: result.id, transferId: "a".repeat(64) };
    const encoded = Buffer.from(JSON.stringify(input)).toString("base64");
    Object.assign(scope,{payloadDigest:createHash("sha256").update(encoded).digest("hex")});
    let hash = 2166136261;
    for (let i = 0; i < encoded.length; i++) hash = Math.imul(hash ^ encoded.charCodeAt(i), 16777619) >>> 0;
    const count = Math.ceil(encoded.length / 32768);
    for (let index = 0; index < count; index++) {
      await stagePublicationChunk({ ...scope, count, length: encoded.length, checksum: hash.toString(16).padStart(8, "0"),
        index, chunk: encoded.slice(index * 32768, (index + 1) * 32768) });
    }
    if (edited) result.opacity = .6;
    const finish: typeof finishLinkedPublication = entry === "source" ? finishLinkedPublication : new Function(
      `${readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-linked-finalize.js", import.meta.url), "utf8")}\nreturn WorldbendFigmaHandoff.finishLinkedPublication;`,
    )();
    const receipt = await finish(scope);
    expect(receipt).toMatchObject(edited
      ? { status: "failed", error: { code: "E_FIGMA_CONFLICT" }, requiresInspection: true }
      : { status: "published", snapshot: { nodeId: result.id, revision: 2 } });
    expect(result.values.get("publication-transfer")).toBe("");
    for (let i = 0; i < count; i++) expect(result.values.get(`publication-chunk-${i}`)).toBe("");
    expect(result.fills).toEqual(edited ? [] : [expect.objectContaining({ type: "IMAGE", imageHash: "new-pixels" })]);
    expect(result.opacity).toBe(edited ? .6 : 1);
    expect(JSON.parse(result.values.get("binding")).revision).toBe(edited ? 1 : 2);
  });
});

describe.each(["source", "bundled"] as const)("external linked-result discovery (%s)", entry => {
  let inspectLinkedResults: typeof sourceHandoff.inspectLinkedResults;
  let inspectLinkedResult: typeof sourceHandoff.inspectLinkedResult;
  let publishLinkedImage: typeof sourceHandoff.publishLinkedImage;
  beforeEach(() => {
    const handoff = entry === "source" ? sourceHandoff : new Function(
      `${readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-linked-update.js", import.meta.url), "utf8")}\nconst read=WorldbendFigmaHandoff;\n${readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-linked-publish.js", import.meta.url), "utf8")}\nreturn {...read,...WorldbendFigmaHandoff};`,
    )();
    ({ inspectLinkedResults, inspectLinkedResult, publishLinkedImage } = handoff);
  });
  function closedSource(h:ReturnType<typeof host>) {
    closedArtwork(h.source);
  }
  function alternateExports(node: { id: string; exportAsync: { mockImplementation: (fn: () => Promise<Uint8Array>) => void } }) {
    let n = 0;
    node.exportAsync.mockImplementation(async () => jitterPair[n++ % 2]!);
  }
  function opaqueGuide(guide: any) {
    guide.blendMode = "PASS_THROUGH";
    guide.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1 }];
    guide.vectorNetwork = { vertices: [], segments: [], regions: [] };
    guide.absoluteTransform = [[1, 0, 0], [0, 1, 0]];
    guide.vectorPaths = [{ windingRule: "NONZERO", data: "M 0 0 L 100 0 L 100 80 L 0 80 Z" }];
  }
  it("captures once, keeps exact PNG correlation and accepts unchanged closed artwork across export jitter",async()=>{
    const h=host();closedSource(h);const result=h.node("result");h.bind(result,[h.source.id]);
    const a=jitterPair[0]!,b=jitterPair[1]!;
    let count=0;h.source.exportAsync.mockImplementation(async()=>++count%2?a:b);
    const plan=await inspectLinkedResults({fileKey:"file",pageId:"page",sourceNodeId:h.source.id});
    const first=await inspectLinkedResult({plan,nodeId:result.id,completed:[],includeSourceRasters:true});
    expect(count).toBe(1);expect(first.sourceState).toMatch(/^hash32x2:/);
    expect(first.sources[0]!.previewFingerprint).toBe(byteFingerprint(a));
    expect(first.sourceRasters![0]!.base64).toBe(Buffer.from(a).toString("base64"));
    const second=await inspectLinkedResult({plan,nodeId:result.id,completed:[]});
    expect(second.sources[0]!.previewFingerprint).toBe(byteFingerprint(b));
    expect(second.expected).toBe(first.expected);
    const done=await publishLinkedImage({...first,plan,completed:[],imageBase64:btoa("core pixels")});
    expect(done.revision).toBe(2);expect(done.sources).toEqual(first.sources);
  });
  it("detects native mask edits and alias-value edits with unchanged exported PNGs, including the last write edge",async()=>{
    const h=host();closedSource(h);const result=h.node("result"),mask=h.node("mask",h.source,"VECTOR");
    mask.isMask=true;mask.maskType="VECTOR";mask.vectorPaths=[{windingRule:"EVENODD",data:"M 0 0 L 10 0 L 10 10 Z"}];
    const collection:any={id:"c",defaultModeId:"m",modes:[{modeId:"m",name:"Default"}]};
    const a:any={id:"a",variableCollectionId:"c",resolvedType:"FLOAT",valuesByMode:{m:{type:"VARIABLE_ALIAS",id:"b"}}};
    const b:any={id:"b",variableCollectionId:"c",resolvedType:"FLOAT",valuesByMode:{m:1}};
    h.source.boundVariables={opacity:{type:"VARIABLE_ALIAS",id:"a"}};
    h.api.variables={getVariableByIdAsync:vi.fn(async(id:string)=>id==="a"?a:id==="b"?b:null),getVariableCollectionByIdAsync:vi.fn(async()=>collection)};
    h.bind(result,[h.source.id]);const plan=await inspectLinkedResults({fileKey:"file",pageId:"page",sourceNodeId:h.source.id});
    const snapshot=await inspectLinkedResult({plan,nodeId:result.id,completed:[]});
    const input={...snapshot,plan,completed:[],imageBase64:btoa("core pixels")};
    mask.maskType="ALPHA";await expect(publishLinkedImage(input)).rejects.toThrow("E_FIGMA_CONFLICT");mask.maskType="VECTOR";
    b.valuesByMode={m:.5};await expect(publishLinkedImage(input)).rejects.toThrow("E_FIGMA_CONFLICT");b.valuesByMode={m:1};
    collection.defaultModeId="other";await expect(publishLinkedImage(input)).rejects.toThrow("E_FIGMA_CONFLICT");collection.defaultModeId="m";
    h.api.createImage.mockImplementationOnce(()=>{b.valuesByMode={m:.5};return {hash:"new-pixels"};});
    await expect(publishLinkedImage(input)).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(result.fills).toEqual([]);expect(JSON.parse(result.values.get("binding")).revision).toBe(1);
    b.valuesByMode={m:{type:"VARIABLE_ALIAS",id:"a"}};
    await expect(inspectLinkedResult({plan,nodeId:result.id,completed:[]})).rejects.toThrow("E_FIGMA_CYCLE");
  });
  it("rejects an edit during capture before emitting artifacts and retains pixel guards for open backdrops",async()=>{
    const h=host();closedSource(h);const result=h.node("result");h.bind(result,[h.source.id]);
    h.api.io={write:vi.fn()};const png=await h.source.exportAsync();
    const plan=await inspectLinkedResults({fileKey:"file",pageId:"page",sourceNodeId:h.source.id});
    h.source.exportAsync.mockImplementationOnce(async()=>{h.source.opacity=.5;return png;});
    await expect(inspectLinkedResult({plan,nodeId:result.id,completed:[],includeSourceRasters:true,sourceRasterTransport:"artifact"})).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(h.api.io.write).not.toHaveBeenCalled();
    const snapshot=await inspectLinkedResult({plan,nodeId:result.id,completed:[]});
    expect(snapshot.sourceState).toBeUndefined();
    h.source.exportAsync.mockResolvedValue(new Uint8Array([7,8,9]));
    await expect(publishLinkedImage({...snapshot,plan,completed:[],imageBase64:btoa("core pixels")})).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(result.fills).toEqual([]);
  });
  it("follows the captured alias chain when an intervening await changes and restores the alias",async()=>{
    const h=host();closedSource(h);const result=h.node("result");h.bind(result,[h.source.id]);
    const alias={type:"VARIABLE_ALIAS",id:"b"},a:any={id:"a",variableCollectionId:"collection",resolvedType:"FLOAT",valuesByMode:{m:alias}};
    const b:any={id:"b",variableCollectionId:"collection",resolvedType:"FLOAT",valuesByMode:{m:100,other:100}};
    const c:any={...b,id:"c"};h.source.boundVariables={opacity:{type:"VARIABLE_ALIAS",id:"a"}};
    h.api.variables={getVariableByIdAsync:async(id:string)=>{if(id!=="a")a.valuesByMode={m:alias};return id==="a"?a:id==="b"?b:c;},
      getVariableCollectionByIdAsync:async()=>{a.valuesByMode={m:{type:"VARIABLE_ALIAS",id:"c"}};return {id:"collection",defaultModeId:"m",modes:[{modeId:"m",name:"Default"},{modeId:"other",name:"Other"}]};}};
    const plan=await inspectLinkedResults({fileKey:"file",pageId:"page",sourceNodeId:h.source.id});
    const snapshot=await inspectLinkedResult({plan,nodeId:result.id,completed:[]});
    b.valuesByMode={m:100,other:75};
    await expect(publishLinkedImage({...snapshot,plan,completed:[],imageBase64:btoa("core pixels")})).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(result.fills).toEqual([]);
  });
  it("guards advanced range typography and leaves externally dependent materials on pixel freshness",async()=>{
    const h=host();closedSource(h);const result=h.node("result"),text=h.node("caption",h.source,"TEXT");h.bind(result,[h.source.id]);
    let ligatures=true;
    text.getStyledTextSegments=(fields:string[])=>[{characters:"office",start:0,end:6,...(fields.includes("openTypeFeatures")?{openTypeFeatures:{liga:ligatures}}:{})}];
    const plan=await inspectLinkedResults({fileKey:"file",pageId:"page",sourceNodeId:h.source.id});
    const snapshot=await inspectLinkedResult({plan,nodeId:result.id,completed:[]});expect(snapshot.sourceState).toBeDefined();
    ligatures=false;
    await expect(publishLinkedImage({...snapshot,plan,completed:[],imageBase64:btoa("core pixels")})).rejects.toThrow("E_FIGMA_CONFLICT");
    text.effects=[{type:"GLASS",visible:true}];
    expect((await inspectLinkedResult({plan,nodeId:result.id,completed:[]})).sourceState).toBeUndefined();
    text.effects=[];text.fills=[{type:"SHADER",shaderId:"external-code"}];
    expect((await inspectLinkedResult({plan,nodeId:result.id,completed:[]})).sourceState).toBeUndefined();
  });
  it("continues a closed scene through its completed native-guide prerequisite",async()=>{
    const h=host(),guide=h.node("guide",h.page,"VECTOR"),fitted=h.node("fitted"),scene=h.node("scene",h.page,"FRAME"),whole=h.node("whole");
    guide.vectorNetwork={vertices:[],segments:[],regions:[]};guide.absoluteTransform=[[1,0,0],[0,1,0]];
    guide.vectorPaths=[{windingRule:"NONZERO",data:"M 0 0 L 100 0 L 100 80 L 0 80 Z"}];
    h.bind(fitted,[guide.id,h.source.id]);
    const work=deformationWorkFromMesh(createMeshSpec(100,80,4));
    const contour={start:{x:0,y:0},segments:[{kind:"line" as const,to:{x:1,y:0}},{kind:"line" as const,to:{x:1,y:1}},{kind:"line" as const,to:{x:0,y:1}}]};
    work.shapeFit={contour,clip:{contours:[contour],fillRule:"nonZero"}};
    writeStoredOperation(fitted,{kind:"task",task:deformationTask(work,"pin",0)});
    h.page.children=h.page.children.filter((n:any)=>n!==fitted);fitted.parent=scene;scene.children.push(fitted);closedArtwork(scene);
    h.bind(whole,[scene.id]);
    const plan=await inspectLinkedResults({fileKey:"file",pageId:"page",sourceNodeId:h.source.id});
    expect(plan.items.find(item=>item.nodeId===whole.id)?.dependencyNodeIds).toContain(fitted.id);
    const upstream=await inspectLinkedResult({plan,nodeId:fitted.id,completed:[]});
    const done=await publishLinkedImage({...upstream,plan,completed:[],imageBase64:btoa("fitted core pixels")});
    const completed=[{nodeId:done.nodeId,revision:done.revision,expected:done.expected}];
    const downstream=await inspectLinkedResult({plan,nodeId:whole.id,completed});expect(downstream.sourceState).toBeDefined();
    expect((await publishLinkedImage({...downstream,plan,completed,imageBase64:btoa("whole scene core pixels")})).revision).toBe(2);
  });
  it("keeps an opaque vector guide and closed artwork stable across export jitter, then rejects a guide edit",async()=>{
    const h=host(),guide=h.node("guide",h.page,"VECTOR"),fitted=h.node("fitted"),scene=h.node("scene",h.page,"FRAME"),consumer=h.node("consumer");
    opaqueGuide(guide);closedArtwork(h.source);
    h.bind(fitted,[guide.id,h.source.id]);
    const work=deformationWorkFromMesh(createMeshSpec(100,80,4));
    const contour={start:{x:0,y:0},segments:[{kind:"line" as const,to:{x:1,y:0}},{kind:"line" as const,to:{x:1,y:1}},{kind:"line" as const,to:{x:0,y:1}}]};
    work.shapeFit={contour,clip:{contours:[contour],fillRule:"nonZero"}};
    writeStoredOperation(fitted,{kind:"task",task:deformationTask(work,"pin",0)});
    h.page.children=h.page.children.filter((node:any)=>node!==fitted);fitted.parent=scene;scene.children.push(fitted);closedArtwork(scene);
    h.bind(consumer,[scene.id]);
    for (const node of [guide,h.source,scene]) alternateExports(node);
    const plan=await inspectLinkedResults({fileKey:"file",pageId:"page",sourceNodeId:h.source.id});
    const fittedRead=await inspectLinkedResult({plan,nodeId:fitted.id,completed:[]});
    const fittedAgain=await inspectLinkedResult({plan,nodeId:fitted.id,completed:[]});
    expect(fittedRead.sourceState).toMatch(/^hash32x2:/);
    expect(fittedAgain.expected).toBe(fittedRead.expected);
    expect(fittedAgain.sources.map(source=>source.previewFingerprint)).not.toEqual(fittedRead.sources.map(source=>source.previewFingerprint));
    const done=await publishLinkedImage({...fittedRead,plan,completed:[],imageBase64:btoa("fitted jitter")});
    const completed=[{nodeId:done.nodeId,revision:done.revision,expected:done.expected}];
    const downstream=await inspectLinkedResult({plan,nodeId:consumer.id,completed});
    expect((await inspectLinkedResult({plan,nodeId:consumer.id,completed})).expected).toBe(downstream.expected);
    guide.vectorPaths=[{windingRule:"NONZERO",data:"M 0 0 L 100 0 L 80 80 L 0 80 Z"}];
    await expect(inspectLinkedResult({plan,nodeId:consumer.id,completed})).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(consumer.fills).toEqual([]);
  });
  it("keeps pixel proof for a vector that does not cover its backdrop",async()=>{
    const h=host(),guide=h.node("guide",h.page,"VECTOR"),result=h.node("result");
    guide.blendMode="PASS_THROUGH";guide.opacity=.4;guide.absoluteTransform=[[1,0,0],[0,1,0]];
    guide.vectorPaths=[{windingRule:"NONZERO",data:"M 0 0 L 100 0 L 100 80 L 0 80 Z"}];
    h.bind(result,[guide.id]);alternateExports(guide);
    const plan=await inspectLinkedResults({fileKey:"file",pageId:"page",sourceNodeId:guide.id});
    const first=await inspectLinkedResult({plan,nodeId:result.id,completed:[]});
    const second=await inspectLinkedResult({plan,nodeId:result.id,completed:[]});
    expect(first.sourceState).toBeUndefined();
    expect(second.expected).not.toBe(first.expected);
    guide.opacity=1;guide.fills=[{type:"SOLID",color:{r:1,g:1,b:1},opacity:1}];guide.effects=[{type:"GLASS",visible:true}];
    expect((await inspectLinkedResult({plan,nodeId:result.id,completed:[]})).sourceState).toBeUndefined();
  });
  it("keeps one opaque image source stable across export jitter and rejects a replaced image",async()=>{
    const h=host(),result=h.node("result");
    h.source.blendMode="NORMAL";
    h.source.fills=[{type:"IMAGE",imageHash:"cover",scaleMode:"FILL",opacity:1,visible:true}];
    h.bind(result,[h.source.id]);alternateExports(h.source);
    const plan=await inspectLinkedResults({fileKey:"file",pageId:"page",sourceNodeId:h.source.id});
    const first=await inspectLinkedResult({plan,nodeId:result.id,completed:[]});
    const second=await inspectLinkedResult({plan,nodeId:result.id,completed:[]});
    expect(first.sourceState).toMatch(/^hash32x2:/);
    expect(second.expected).toBe(first.expected);
    expect(second.sources[0]!.previewFingerprint).not.toBe(first.sources[0]!.previewFingerprint);
    h.source.fills=[{type:"IMAGE",imageHash:"swapped",scaleMode:"FILL",opacity:1,visible:true}];
    await expect(publishLinkedImage({...first,plan,completed:[],imageBase64:btoa("image pixels")})).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(result.fills).toEqual([]);
  });
  it("carries an artwork and guide refresh through one consumer into two size outputs",async()=>{
    const h=host(),guide=h.node("guide",h.page,"VECTOR"),fitted=h.node("fitted"),scene=h.node("scene",h.page,"FRAME"),consumer=h.node("consumer");
    const square=h.node("square"),wide=h.node("wide"),looseA=h.node("loose-a"),looseB=h.node("loose-b");
    guide.vectorNetwork={vertices:[],segments:[],regions:[]};guide.absoluteTransform=[[1,0,0],[0,1,0]];
    guide.vectorPaths=[{windingRule:"NONZERO",data:"M 0 0 L 100 0 L 100 80 L 0 80 Z"}];
    h.bind(fitted,[guide.id,h.source.id]);
    const work=deformationWorkFromMesh(createMeshSpec(100,80,4));
    const contour={start:{x:0,y:0},segments:[{kind:"line" as const,to:{x:1,y:0}},{kind:"line" as const,to:{x:1,y:1}},{kind:"line" as const,to:{x:0,y:1}}]};
    work.shapeFit={contour,clip:{contours:[contour],fillRule:"nonZero"}};
    writeStoredOperation(fitted,{kind:"task",task:deformationTask(work,"pin",0)});
    h.page.children=h.page.children.filter((node:any)=>node!==fitted);fitted.parent=scene;scene.children.push(fitted);closedArtwork(scene);
    h.bind(consumer,[scene.id]);
    square.width=100;square.height=100;wide.width=160;wide.height=90;
    writeStoredBinding(square,{sourceNodeIds:[consumer.id],renderWidth:100,renderHeight:100});
    writeStoredBinding(wide,{sourceNodeIds:[consumer.id],renderWidth:160,renderHeight:90});
    writeStoredOperation(square,{kind:"transform",spec:transform});
    writeStoredOperation(wide,{kind:"transform",spec:transform});
    h.bind(looseA,[h.source.id]);h.bind(looseB,[h.source.id]);
    const artwork=Uint8Array.from([9,8,7,6]);
    h.source.exportAsync.mockResolvedValue(artwork);
    guide.vectorPaths=[{windingRule:"NONZERO",data:"M 0 0 L 100 0 L 80 80 L 0 80 Z"}];
    const plan=await inspectLinkedResults({fileKey:"file",pageId:"page",sourceNodeId:h.source.id});
    const byId=new Map(plan.items.map(item=>[item.nodeId,item]));
    const reachesConsumer=(id:string)=>{
      const seen=new Set<string>(),stack=[...(byId.get(id)?.dependencyNodeIds??[])];
      while(stack.length){const next=stack.pop()!;if(seen.has(next))continue;seen.add(next);if(next===consumer.id)return true;stack.push(...(byId.get(next)?.dependencyNodeIds??[]));}
      return false;
    };
    expect(byId.get(consumer.id)?.dependencyNodeIds).toContain(fitted.id);
    expect(reachesConsumer(square.id)).toBe(true);
    expect(reachesConsumer(wide.id)).toBe(true);
    expect(reachesConsumer(looseA.id)).toBe(false);
    expect(reachesConsumer(looseB.id)).toBe(false);
    await expect(inspectLinkedResult({plan,nodeId:square.id,completed:[]})).rejects.toThrow("E_FIGMA_PREREQUISITE");
    const completed:Array<{nodeId:string;revision:number;expected:string}>=[];
    const publish=(snapshot:Awaited<ReturnType<typeof inspectLinkedResult>>,pixels:string)=>publishLinkedImage({...snapshot,plan,completed,imageBase64:btoa(pixels)});
    const fittedRead=await inspectLinkedResult({plan,nodeId:fitted.id,completed});
    expect(fittedRead.sources.map(source=>source.nodeId)).toEqual([guide.id,h.source.id]);
    expect(fittedRead.sources[1]?.previewFingerprint).toBe(byteFingerprint(artwork));
    expect(fittedRead.shapeGuideClip?.contours[0]?.segments[1]?.to).toEqual({x:.8,y:1});
    completed.push(await publish(fittedRead,"fitted"));
    completed.push(await publish(await inspectLinkedResult({plan,nodeId:consumer.id,completed}),"consumer"));
    const loose=await inspectLinkedResult({plan,nodeId:looseA.id,completed:[]});
    expect(loose.sourceNodeIds).toEqual([h.source.id]);
    await publish(loose,"loose");
    await expect(inspectLinkedResult({plan,nodeId:wide.id,completed:completed.filter(item=>item.nodeId!==consumer.id)})).rejects.toThrow("E_FIGMA_PREREQUISITE");
    const squareRead=await inspectLinkedResult({plan,nodeId:square.id,completed});
    const wideRead=await inspectLinkedResult({plan,nodeId:wide.id,completed});
    expect(squareRead.sourceNodeIds).toEqual([consumer.id]);
    expect(wideRead.sourceNodeIds).toEqual([consumer.id]);
    expect([squareRead.renderWidth,squareRead.renderHeight]).toEqual([100,100]);
    expect([wideRead.renderWidth,wideRead.renderHeight]).toEqual([160,90]);
    expect((await publish(squareRead,"square")).revision).toBe(2);
    expect((await publish(wideRead,"wide")).revision).toBe(2);
    expect(square.fills).toEqual([expect.objectContaining({type:"IMAGE",imageHash:"new-pixels"})]);
    expect(wide.fills).toEqual(square.fills);
  });
  it.each([0,1] as const)("discovers and refreshes both native fitting bindings with guide in slot %s",async index=>{
    const h=host(),guide=h.node("guide",h.page,"VECTOR"),result=h.node("fitted");
    guide.vectorNetwork={vertices:[],segments:[],regions:[]}; guide.absoluteTransform=[[1,0,0],[0,1,0]]; guide.vectorPaths=[{windingRule:"NONZERO",data:"M 0 0 L 100 0 L 100 80 L 0 80 Z"}];
    const ids=index===0 ? [guide.id,h.source.id] : [h.source.id,guide.id];
    h.bind(result,ids);
    const work=deformationWorkFromMesh(createMeshSpec(100,80,4));
    const contour={start:{x:0,y:0},segments:[{kind:"line" as const,to:{x:1,y:0}},{kind:"line" as const,to:{x:1,y:1}},{kind:"line" as const,to:{x:0,y:1}}]};
    work.shapeFit={contour,clip:{contours:[contour],fillRule:"nonZero"}};
    const task=deformationTask(work,"pin",index);
    writeStoredOperation(result,{kind:"task",task});
    const plan=await inspectLinkedResults({fileKey:"file",pageId:"page",sourceNodeId:h.source.id});
    expect(plan.items[0]).toMatchObject({nodeId:result.id,sourceNodeIds:ids,updatable:true});
    const snapshot=await inspectLinkedResult({plan,nodeId:result.id,completed:[],includeSourceRasters:true});
    expect(snapshot.operation).toEqual({kind:"task",task});
    expect(snapshot.sources.map(source=>source.nodeId)).toEqual(ids);
    const receipt=await publishLinkedImage({...snapshot,plan,completed:[],imageBase64:btoa("fresh fitted artwork")});
    expect(receipt.revision).toBe(2);
    expect(JSON.parse(result.values.get("task"))).toEqual(task);
    expect(JSON.parse(result.values.get("binding")).sourceNodeIds).toEqual(ids);
    // Identical exported pixels do not hide a changed native guide recipe.
    const freshPlan=await inspectLinkedResults({fileKey:"file",pageId:"page",sourceNodeId:h.source.id});
    guide.vectorPaths=[{windingRule:"NONZERO",data:"M 0 0 L 100 0 L 80 80 L 0 80 Z"}];
    const changed=await inspectLinkedResult({plan:freshPlan,nodeId:result.id,completed:[]});
    expect(changed.shapeGuideClip?.contours[0]?.segments[1]?.to).toEqual({x:.8,y:1});
    const refreshed=deformationTask({...work,shapeFit:{...work.shapeFit!,contour:changed.shapeGuideClip!.contours[0]!,clip:changed.shapeGuideClip!}},"pin",index,{kind:"nativeContour",contourIndex:0});
    const reorder=(value:any):any=>Array.isArray(value) ? value.map(reorder) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,next])=>[key,reorder(next)])) : value;
    const publication={...changed,shapeGuideClip:reorder(changed.shapeGuideClip),plan:freshPlan,completed:[],refreshedTask:reorder(refreshed),imageBase64:btoa("new guide pixels")};
    h.api.createImage.mockImplementationOnce(()=>{guide.absoluteTransform=[[1,.2,0],[0,1,0]];return {hash:"new-pixels"};});
    await expect(publishLinkedImage(publication)).rejects.toThrow("E_FIGMA_CONFLICT");
    guide.absoluteTransform=[[1,0,0],[0,1,0]];
    const done=await publishLinkedImage(publication);
    expect(done.revision).toBe(3);
    expect(done.operation).toEqual({kind:"task",task:refreshed});
    expect(JSON.parse(result.values.get("task"))).toEqual(refreshed);

  });

  it("updates both local branches before reading the whole, rejects newer sources and resumes independent work", async () => {
    const h = host(); const group = h.node("assembly", h.page, "FRAME");
    const a = h.node("a", group); const b = h.node("b", group); const whole = h.node("whole");
    h.bind(a, [h.source.id]); h.bind(b, [h.source.id]); h.bind(whole, [group.id]);
    const plan = await inspectLinkedResults({ fileKey: "file", pageId: "page", sourceNodeId: "source" });
    const completed: Array<{ nodeId: string; revision: number; expected: string }> = [];
    const read = (nodeId: string) => inspectLinkedResult({ plan, nodeId, completed, includeSourceRasters: true });
    await expect(read(whole.id)).rejects.toThrow("E_FIGMA_PREREQUISITE");
    const first = await read(a.id);
    const input = { ...first, plan, completed, imageBase64: btoa("core pixels") };
    h.source.exportAsync.mockResolvedValue(new Uint8Array([...Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")), 1]));
    await expect(publishLinkedImage(input)).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(a.fills).toEqual([]);
    // Failure on A does not prevent the independent B branch from completing.
    const nextB = await read(b.id);
    completed.push(await publishLinkedImage({ ...nextB, plan, completed, imageBase64: btoa("core pixels") }));
    await expect(read(whole.id)).rejects.toThrow("E_FIGMA_PREREQUISITE");
    const retryA = await read(a.id);
    completed.push(await publishLinkedImage({ ...retryA, plan, completed, imageBase64: btoa("core pixels") }));
    expect((await read(whole.id)).sourceNodeIds).toEqual([group.id]);
    h.source.exportAsync.mockResolvedValue(new Uint8Array([7, 8, 9]));
    await expect(read(whole.id)).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(whole.fills).toEqual([]);
    expect(a.fills).toEqual([{ type: "IMAGE", scaleMode: "FILL", imageHash: "new-pixels" }]);
    expect(b.fills).toEqual(a.fills);
  });

  it("refuses an edited published image on fresh discovery instead of treating the edit as its new baseline", async () => {
    const h = host(), a = h.node("a"); h.bind(a, [h.source.id]);
    a.fills = [{ type: "IMAGE", imageHash: "published", scaleMode: "FILL", opacity: 1 }];
    writeRasterPaintProof(a); a.fills[0].opacity = .55;
    const plan = await inspectLinkedResults({ fileKey: "file", pageId: "page", sourceNodeId: "source" });
    expect(plan.items[0]?.updatable).toBe(false);
    await expect(inspectLinkedResult({ plan, nodeId: a.id, completed: [] })).rejects.toThrow("E_FIGMA_STATE");
    expect(a.fills[0].opacity).toBe(.55); expect(h.api.createImage).not.toHaveBeenCalled();
  });

  it("rejects a source edit at the last write edge and restores a failed refresh", async () => {
    const h = host(); const a = h.node("a"); h.bind(a, [h.source.id]);
    const plan = await inspectLinkedResults({ fileKey: "file", pageId: "page", sourceNodeId: "source" });
    const snapshot = await inspectLinkedResult({ plan, nodeId: a.id, completed: [] });
    const input = { ...snapshot, plan, completed: [], imageBase64: btoa("core pixels") };
    await expect(publishLinkedImage({ ...input, operationJson: "{}" })).rejects.toThrow("E_FIGMA_CONFLICT");
    await expect(publishLinkedImage({ ...input, sources: [{ ...snapshot.sources[0]!, previewFingerprint: "different" }] })).rejects.toThrow("E_FIGMA_CONFLICT");
    h.api.createImage.mockImplementationOnce(() => { h.source.opacity = .5; return { hash: "new-pixels" }; });
    await expect(publishLinkedImage(input)).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(a.fills).toEqual([]);
    h.source.opacity = 1;
    const priorBinding = a.values.get("binding");
    const write = a.setSharedPluginData;
    let failed = false;
    a.setSharedPluginData = (namespace: string, key: string, value: string) => {
      if (key === "binding" && !failed) { failed = true; throw Error("host write failed"); }
      write(namespace, key, value);
    };
    await expect(publishLinkedImage(input)).rejects.toThrow("host write failed");
    expect(a.fills).toEqual([]); expect(a.values.get("binding")).toBe(priorBinding);
    expect((await publishLinkedImage(input)).revision).toBe(snapshot.revision + 1);
    await expect(publishLinkedImage(input)).rejects.toThrow("E_FIGMA_CONFLICT");
  });

  it("captures the rendered source state before later source edits can masquerade as the completed pixels", async () => {
    const h = host(); const a = h.node("a"); const whole = h.node("whole");
    h.bind(a, [h.source.id]); h.bind(whole, [a.id]);
    const plan = await inspectLinkedResults({ fileKey: "file", pageId: "page", sourceNodeId: "source" });
    const snapshot = await inspectLinkedResult({ plan, nodeId: a.id, completed: [] });
    const write = a.setSharedPluginData;
    a.setSharedPluginData = (namespace: string, key: string, value: string) => {
      write(namespace, key, value);
      if (key === "binding") queueMicrotask(() => h.source.exportAsync.mockResolvedValue(new Uint8Array([4,5,6])));
    };
    const completion = await publishLinkedImage({ ...snapshot, plan, completed: [], imageBase64: btoa("core pixels") });
    expect(completion.sources).toEqual(snapshot.sources);
    await expect(inspectLinkedResult({ plan, nodeId: whole.id, completed: [completion] })).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(whole.fills).toEqual([]);
  });

  it("rebases a usable Composition draft without applying it, and preserves it across failed publication", async () => {
    const h = host(); const a = h.node("a"); h.bind(a, [h.source.id]);
    const task = continuedCompositionTask(defaultMockup([{ sourceNodeId: h.source.id, sourceName: "Original",
      renderWidth: 100, renderHeight: 80, placement: { x: 0, y: 0, width: 100, height: 80 }, image: {} as HTMLImageElement }]));
    writeStoredOperation(a, { kind: "task", task });
    if (task.kind !== "composition") throw Error("Expected the continued Composition fixture");
    const pending = structuredClone(task); pending.template.operation.composition.planes[0]!.opacity = .4;
    const draft = { schema: "worldbend.figma.mockup-draft", version: "0.1", baseRevision: 1, task: pending };
    a.values.set("mockupDraft", JSON.stringify(draft));
    writeRasterPaintProof(a);
    const beforePaintProof = a.values.get(SHARED_RASTER_PAINT_KEY);
    const plan = await inspectLinkedResults({ fileKey: "file", pageId: "page", sourceNodeId: "source" });
    const snapshot = await inspectLinkedResult({ plan, nodeId: a.id, completed: [] });
    const input = { ...snapshot, plan, completed: [], imageBase64: btoa("core pixels") };
    const beforeTask = a.values.get("task"); const write = a.setSharedPluginData; let failed = false;
    a.setSharedPluginData = (namespace: string, key: string, value: string) => {
      if (key === "mockupDraft" && !failed) { failed = true; throw Error("draft write failed"); }
      write(namespace, key, value);
    };
    await expect(publishLinkedImage(input)).rejects.toThrow("draft write failed");
    expect(a.fills).toEqual([]); expect(a.values.get("task")).toBe(beforeTask);
    expect(JSON.parse(a.values.get("mockupDraft"))).toEqual(draft);
    expect(a.values.get(SHARED_RASTER_PAINT_KEY)).toBe(beforePaintProof);
    const completion = await publishLinkedImage(input);
    expect(completion.revision).toBe(2); expect(a.values.get("task")).toBe(beforeTask);
    expect(JSON.parse(a.values.get("mockupDraft"))).toEqual({ ...draft, baseRevision: 2 });
    // A stale or malformed pending edit must be repaired, never promoted to a
    // fresh revision merely because source pixels were refreshed.
    for (const raw of ["{broken", JSON.stringify(draft), JSON.stringify({ ...draft, baseRevision: 2, task: { kind: "effect" } })]) {
      a.values.set("mockupDraft", raw); h.writes.mockClear();
      const freshPlan = await inspectLinkedResults({ fileKey: "file", pageId: "page", sourceNodeId: "source" });
      await expect(inspectLinkedResult({ plan: freshPlan, nodeId: a.id, completed: [] })).rejects.toThrow("E_FIGMA_STATE");
      expect(h.writes).not.toHaveBeenCalled();
    }
  });

  it("does not change unrelated draft data while refreshing an ordinary transform", async () => {
    const h = host(); const a = h.node("a"); h.bind(a, [h.source.id]);
    a.values.set("mockupDraft", "unrelated old family data");
    const plan = await inspectLinkedResults({ fileKey: "file", pageId: "page", sourceNodeId: "source" });
    const snapshot = await inspectLinkedResult({ plan, nodeId: a.id, completed: [] });
    await publishLinkedImage({ ...snapshot, plan, completed: [], imageBase64: btoa("core pixels") });
    expect(a.values.get("mockupDraft")).toBe("unrelated old family data");
  });

  it("retains unpublished Depth edits on their new base revision", async () => {
    const h = host(); const second = h.node("second"); const a = h.node("a");
    h.bind(a, [h.source.id, second.id]);
    const task: FigmaSpatialEffectTask = { kind: "effect", recipe: { schema: "worldbend.effect-recipe", version: "3", origin: null,
      viewport: { width: 100, height: 80 }, camera: { focalLength: 1300, focusDistance: 1000, travel: { x: 10, y: 8 } },
      layers: [1500, 500].map((distance, index) => ({ id: `layer-${index + 1}`, offset: { x: 0, y: 0 },
        surface: { kind: "camera-plane", size: { width: 100, height: 80 }, distance }, tracks: [] })) as FigmaSpatialEffectTask["recipe"]["layers"] },
      state: { progress: 1, pointerX: 0, pointerY: 0, reducedMotion: false } };
    writeStoredOperation(a, { kind: "task", task });
    const pending = structuredClone(task); pending.recipe.camera!.focalLength = 1599.5;
    const draft = { schema: "worldbend.figma.effect-draft", version: "0.1", baseRevision: 1,
      fingerprint: `sha256:${"a".repeat(64)}`, task: pending };
    a.values.set("effectDraft", JSON.stringify(draft));
    const plan = await inspectLinkedResults({ fileKey: "file", pageId: "page", sourceNodeId: "source" });
    const snapshot = await inspectLinkedResult({ plan, nodeId: a.id, completed: [] });
    await publishLinkedImage({ ...snapshot, plan, completed: [], imageBase64: btoa("core pixels") });
    expect(JSON.parse(a.values.get("task"))).toEqual(task);
    expect(JSON.parse(a.values.get("effectDraft"))).toEqual({ ...draft, baseRevision: 2 });
  });

  it("expands compact prepared packets before applying the same read and publication guards", async () => {
    if (entry !== "bundled") return;
    const h = host(); const a = h.node("a"); h.bind(a, [h.source.id]);
    const { items, ...header } = await inspectLinkedResults({ fileKey: "file", pageId: "page", sourceNodeId: "source" });
    const plan = { ...header, rows: items.map(item => [item.nodeId, item.kind, item.revision, item.expected,
      item.sourceNodeIds, item.dependencyNodeIds, item.updatable]) } as unknown as sourceHandoff.LinkedUpdatePlan;
    const snapshot = await inspectLinkedResult({ plan, nodeId: a.id, completed: [] });
    expect((await publishLinkedImage({ ...snapshot, plan, completed: [], imageBase64: btoa("core pixels") })).revision).toBe(2);
    await expect(inspectLinkedResult({ plan, nodeId: a.id, completed: [] })).rejects.toThrow("E_FIGMA_CONFLICT");
  });

  it("retains native document order and waits for every local branch before its whole output", async () => {
    const h = host(); const group = h.node("assembly", h.page, "FRAME");
    const a = h.node("a", group); const b = h.node("b", group); const whole = h.node("whole");
    const other = h.node("unrelated");
    h.bind(a, [h.source.id]); h.bind(b, [h.source.id]); h.bind(whole, [group.id]); h.bind(other, ["elsewhere"]);
    const plan = await inspectLinkedResults({ fileKey: "file", pageId: "page", sourceNodeId: "source" });
    expect(plan.items.map(item => [item.nodeId, item.dependencyNodeIds])).toEqual([
      ["a", []], ["b", []], ["whole", ["a", "b"]],
    ]);
    expect(plan.items.every(item => item.updatable)).toBe(true);
    expect(h.writes).not.toHaveBeenCalled();
    expect(h.page.children).toEqual([h.source, group, whole, other]);
  });

  it("reports a broken operation as a prerequisite instead of silently admitting its stale pixels", async () => {
    const h = host(); const broken = h.node("broken"); const whole = h.node("whole");
    h.bind(broken, [h.source.id]); h.bind(whole, [broken.id]);
    broken.values.set("transform", "{broken");
    const plan = await inspectLinkedResults({ fileKey: "file", pageId: "page", sourceNodeId: "source" });
    expect(plan.items[0]).toMatchObject({ nodeId: "broken", kind: "invalid", updatable: false });
    expect(plan.items[1]).toMatchObject({ nodeId: "whole", dependencyNodeIds: ["broken"] });
    expect(h.writes).not.toHaveBeenCalled();
  });

  it("rejects feedback and excess results before publication", async () => {
    const h = host(); const a = h.node("a"); const b = h.node("b");
    h.bind(a, [h.source.id, b.id]); h.bind(b, [a.id]);
    await expect(inspectLinkedResults({ fileKey: "file", pageId: "page", sourceNodeId: "source" })).rejects.toThrow("E_FIGMA_CYCLE");
    h.bind(a, ["elsewhere"]); h.bind(b, ["elsewhere"]);
    for (let i = 0; i < 65; i++) h.bind(h.node(`output-${i}`), [h.source.id]);
    await expect(inspectLinkedResults({ fileKey: "file", pageId: "page", sourceNodeId: "source" })).rejects.toThrow("E_FIGMA_LIMIT");
    expect(h.writes).not.toHaveBeenCalled();
  });

  it("rejects changed scope and incomplete page reads", async () => {
    const h = host(); const a = h.node("a"); h.bind(a, [h.source.id]);
    await expect(inspectLinkedResults({ fileKey: "another-file", pageId: "page", sourceNodeId: "source" })).rejects.toThrow("E_FIGMA_SCOPE");
    const read = h.api.getNodeByIdAsync.getMockImplementation();
    h.api.getNodeByIdAsync.mockImplementation(async (id: string) => {
      if (id === a.id) h.page.children = [h.source];
      return read(id);
    });
    await expect(inspectLinkedResults({ fileKey: "file", pageId: "page", sourceNodeId: "source" })).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(h.writes).not.toHaveBeenCalled();
  });

  it.each(["source-arc", "target-smoothing"] as const)("rejects native %s edits at the final publication boundary", async changed => {
    const h = host(), result = h.node("result"); h.bind(result, [h.source.id]);
    h.source.type = "ELLIPSE";
    h.source.arcData = { startingAngle: 0, endingAngle: Math.PI * 2, innerRadius: 0 };
    result.cornerSmoothing = 0;
    const plan = await inspectLinkedResults({ fileKey: "file", pageId: "page", sourceNodeId: h.source.id });
    const snapshot = await inspectLinkedResult({ plan, nodeId: result.id, completed: [] });
    h.api.createImage.mockImplementationOnce(() => {
      if (changed === "source-arc") h.source.arcData = { ...h.source.arcData, innerRadius: .5 };
      else result.cornerSmoothing = .75;
      return { hash: "outdated-pixels" };
    });
    await expect(publishLinkedImage({ ...snapshot, plan, completed: [], imageBase64: btoa("pixels") })).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(result.fills).toEqual([]);
    expect(JSON.parse(result.values.get("binding")).revision).toBe(1);
    expect(h.writes).not.toHaveBeenCalled();
  });

  it("guards native paint and placement edits independently of source pixels", () => {
    const h = host(); const a = h.node("a"); h.bind(a, [h.source.id]);
    const first = linkedTargetExpected(a); h.source.opacity = .5;
    expect(linkedTargetExpected(a)).toBe(first);
    a.relativeTransform[0][2] = 30;
    expect(linkedTargetExpected(a)).not.toBe(first);
    a.relativeTransform[0][2] = 0; a.fills = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }];
    expect(linkedTargetExpected(a)).not.toBe(first);
  });
});
