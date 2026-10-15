import { afterEach,describe,expect,it,vi } from "vitest";
import { nativeContinuationCapture,nativeContinuationPage,nativeSourcePage } from "./agent-native-continuation-source";
import { fingerprintState } from "./state-fingerprint";

function fixture() {
  const page:any={id:"page",type:"PAGE",parent:{id:"root",type:"DOCUMENT"}},scope={fileKey:"file",pageId:"page",nodeId:"result",carrier:"frame" as const};
  let svg="<svg width='850' height='500'><desc>工作🚀</desc>"+"<path d='M0 0H20V20H0Z'/>".repeat(2000)+"</svg>";
  const source:any={id:"content",type:"FRAME",parent:page,name:"😀".repeat(150),width:850,height:500,x:0,y:0,children:[],
    fills:[],strokes:[],effects:[],opacity:1,visible:true,removed:false,absoluteTransform:[[1,0,0],[0,1,0]],absoluteBoundingBox:{x:0,y:0,width:850,height:500},
    getSharedPluginDataKeys:()=>[],getSharedPluginData:()=>"",exportAsync:vi.fn(async()=>svg),clone:vi.fn(()=>{throw Error("read must not clone");})};
  const base={schema:"base",nodeId:"result",revision:3,spec:{rotation:0}};
  vi.stubGlobal("figma",{fileKey:"file",currentPage:page,getNodeByIdAsync:vi.fn(async()=>source)});
  return {scope,source,base,readBase:async()=>structuredClone(base),svg:()=>svg,setSvg:(v:string)=>{svg=v;}};
}
afterEach(()=>vi.unstubAllGlobals());
describe("exact native source continuation",()=>{
  it("retains current source bytes in bounded tokened pages without cloning or changing native content",async()=>{
    const f=fixture(),before=JSON.stringify({fills:f.source.fills,effects:f.source.effects,name:f.source.name});
    const capture=await nativeContinuationCapture(f.scope,f.base,f.source.id,f.readBase);
    expect([...capture.data.source.name]).toHaveLength(128);
    const state=nativeContinuationPage(capture,{});let json=state.json;
    for(let part=1;part<state.partCount;part++)json+=nativeContinuationPage(capture,{part,token:state.token}).json;
    expect(JSON.parse(json)).toEqual(capture.data);
    const guard={...f.scope,targetExpected:capture.data.targetExpected,sourceExpected:capture.data.sourceExpected,svgExpected:capture.data.source.previewFingerprint};
    const first=nativeSourcePage(capture,guard);let encoded=first.base64;
    for(let part=1;part<first.partCount;part++){
      const page=nativeSourcePage(capture,{...guard,part,token:first.token});expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(20480);encoded+=page.base64;
    }
    expect(Buffer.from(encoded,"base64").toString("utf8")).toBe(f.svg());
    expect(first.bytes).toBe(Buffer.byteLength(f.svg()));expect(first.partCount).toBeGreaterThan(1);
    expect(f.source.clone).not.toHaveBeenCalled();expect(JSON.stringify({fills:f.source.fills,effects:f.source.effects,name:f.source.name})).toBe(before);
  });
  it("rejects source, scope, target and byte changes across asynchronous capture or continuation",async()=>{
    const f=fixture();f.source.exportAsync.mockImplementationOnce(async()=>{f.source.name="newer native edit";return f.svg();});
    await expect(nativeContinuationCapture(f.scope,f.base,f.source.id,f.readBase)).rejects.toThrow(/changed/);
    const g=fixture();const capture=await nativeContinuationCapture(g.scope,g.base,g.source.id,g.readBase);
    const guard={...g.scope,targetExpected:capture.data.targetExpected,sourceExpected:capture.data.sourceExpected,svgExpected:capture.data.source.previewFingerprint};
    expect(()=>nativeSourcePage(capture,{...guard,sourceExpected:fingerprintState("newer")})).toThrow(/CONFLICT/);
    expect(()=>nativeSourcePage(capture,{...guard,token:fingerprintState("different bytes")})).toThrow(/CONFLICT/);
    expect(()=>nativeSourcePage(capture,{...guard,part:1})).toThrow(/INPUT/);
    (globalThis as any).figma.currentPage={...g.source.parent,id:"other"};expect(()=>nativeSourcePage(capture,guard)).toThrow(/scope/);
    const h=fixture();await expect(nativeContinuationCapture(h.scope,h.base,h.source.id,async()=>({...h.base,revision:4}))).rejects.toThrow(/CONFLICT/);
  });
  it("uses the Vector appearance domain and rejects a changed export crop",async()=>{
    const f=fixture(),scope={...f.scope,carrier:"vector" as const};
    f.source.effects=[{type:"DROP_SHADOW",visible:true,radius:12,offset:{x:8,y:4},color:{r:0,g:0,b:0,a:.3}}];
    f.source.absoluteRenderBounds={x:-12,y:-12,width:890,height:540};
    const capture=await nativeContinuationCapture(scope,f.base,f.source.id,f.readBase);
    expect(capture.data.source).toMatchObject({width:890,height:540});
    expect(capture.data.sourceEffects).toEqual(["DROP_SHADOW"]);
    expect(f.source.exportAsync).toHaveBeenCalledWith({format:"SVG_STRING",svgOutlineText:true});
    f.source.exportAsync.mockImplementationOnce(async()=>{f.source.absoluteRenderBounds.width=891;return f.svg();});
    await expect(nativeContinuationCapture(scope,f.base,f.source.id,f.readBase)).rejects.toThrow(/changed/);
  });
});
