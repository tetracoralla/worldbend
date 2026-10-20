import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultPresetEffect, parsePresetEffectRecord, PRESET_EFFECT_KEY, isPresetEffectSpec, type PresetEffectRaster } from "./preset-effect";
import { presetParts, presetOwner, publishPresetEffect, loadPresetFonts, presetSourceSnapshot } from "./preset-effect-main";
import { isUiToMainMessage } from "./messages";

const raster:PresetEffectRaster={width:202,height:162,origin:{x:-1,y:-1},layers:[{name:"card",bytes:"iVBORw==",quad:{tl:{x:1,y:1},tr:{x:201,y:1},br:{x:201,y:161},bl:{x:1,y:161}}}]};
function fixture() {
  let id=0;
  const nodes=new Map<string,Node>();
  class Node {
    id=String(++id); type:string; name="My original"; parent:Node|null=null; children:Node[]=[];
    width=200;height=160;visible=true;removed=false;fills:unknown[]=[];effects:unknown[]=[];
    clipsContent=false;layoutMode="NONE";layoutSizingHorizontal="FIXED";layoutSizingVertical="FIXED";layoutPositioning="AUTO";
    nativeTransform:Transform=[[1,0,0],[0,1,0]];shared=new Map<string,string>();
    autoSlots?:{x:number;y:number;step:number};
    get relativeTransform():Transform {
      const slots=this.parent?.autoSlots;
      if(slots&&this.layoutPositioning==="AUTO")return [[this.nativeTransform[0][0],this.nativeTransform[0][1],slots.x+this.parent!.children.indexOf(this)*slots.step],
        [this.nativeTransform[1][0],this.nativeTransform[1][1],slots.y]];
      return this.nativeTransform;
    }
    set relativeTransform(value:Transform){this.nativeTransform=value;}
    characters="Editable original";fontName={family:"Actual font",style:"Regular"};fontSize=16;
    constructor(type:string){this.type=type;nodes.set(this.id,this);}
    get x(){return this.relativeTransform[0][2];}set x(value:number){this.relativeTransform[0][2]=value;}
    get y(){return this.relativeTransform[1][2];}set y(value:number){this.relativeTransform[1][2]=value;}
    get absoluteTransform():Transform {
      const [[a,c,e],[b,d,f]]=this.parent?.type!=="PAGE"?this.parent?.absoluteTransform??[[1,0,0],[0,1,0]]:[[1,0,0],[0,1,0]];
      const [[u,v,x],[w,z,y]]=this.relativeTransform;
      return [[a*u+c*w,a*v+c*z,a*x+c*y+e],[b*u+d*w,b*v+d*z,b*x+d*y+f]];
    }
    get absoluteBoundingBox(){return {x:this.absoluteTransform[0][2],y:this.absoluteTransform[1][2],width:this.width,height:this.height};}
    get absoluteRenderBounds(){return this.absoluteBoundingBox;}
    plugin=new Map<string,string>();
    getPluginData(key:string){return this.plugin.get(key)??"";}
    setPluginData(key:string,value:string){this.plugin.set(key,value);}
    getSharedPluginDataKeys(){return [...this.shared.keys()];}
    async exportAsync(){return png;}
    findAllWithCriteria(criteria:{types:string[]}){return this.findAll(n=>criteria.types.includes(n.type));}
    on=vi.fn();off=vi.fn();selection:Node[]=[];
    getSharedPluginData(_namespace:string,key:string){return this.shared.get(key)??"";}
    setSharedPluginData(_namespace:string,key:string,value:string){this.shared.set(key,value);}
    insertChild(index:number,node:Node){node.parent?.children.splice(node.parent.children.indexOf(node),1);this.children.splice(index,0,node);node.parent=this;}
    appendChild(node:Node){this.insertChild(this.children.length,node);}
    resize(width:number,height:number){this.width=width;this.height=height;}
    resizeWithoutConstraints(width:number,height:number){this.resize(width,height);}
    remove(){this.parent?.children.splice(this.parent.children.indexOf(this),1);this.parent=null;this.removed=true;for(const child of [...this.children])child.remove();}
    findAll(predicate:(node:Node)=>boolean):Node[]{return this.children.flatMap(child=>[...(predicate(child)?[child]:[]),...child.findAll(predicate)]);}
    getStyledTextSegments(){return [{fontName:this.fontName,fontSize:this.fontSize,characters:this.characters}];}
    clone():Node{const copy=new Node(this.type);Object.assign(copy,{name:this.name,relativeTransform:structuredClone(this.relativeTransform),width:this.width,height:this.height,visible:this.visible,shared:new Map(this.shared),characters:this.characters});for(const child of this.children)copy.appendChild(child.clone());return copy;}
  }
  const page=new Node("PAGE"),parent=new Node("FRAME"),source=new Node("FRAME"),text=new Node("TEXT");
  page.appendChild(parent);parent.relativeTransform=[[0,-1,500],[1,0,100]];parent.appendChild(source);source.relativeTransform=[[1,0,30],[0,1,40]];source.appendChild(text);
  const before=structuredClone(source.absoluteTransform);
  const png=new Uint8Array(24);png[0]=137;png[1]=80;new DataView(png.buffer).setUint32(16,200);new DataView(png.buffer).setUint32(20,160);
  const posts:unknown[]=[];
  const loadFontAsync=vi.fn(async (_font:unknown)=>{}),createImage=vi.fn(()=>({hash:"generated-image"}));
  const mock={currentPage:page,loadFontAsync,createImage,base64Decode:()=>png,base64Encode:()=>"iVBORw==",
    root:{children:[page]},mixed:Symbol("mixed"),getNodeByIdAsync:async(id:string)=>nodes.get(id)??null,
    clientStorage:{getAsync:vi.fn(async()=>undefined),setAsync:vi.fn()},showUI:vi.fn(),on:vi.fn(),commitUndo:vi.fn(),notify:vi.fn(),
    viewport:{scrollAndZoomIntoView:vi.fn()},ui:{on:vi.fn(),onmessage:undefined as ((message:unknown)=>Promise<void>)|undefined,postMessage:(message:unknown)=>posts.push(message)},
    createFrame:()=>{const node=new Node("FRAME");page.appendChild(node);return node;},
    createRectangle:()=>{const node=new Node("RECTANGLE");page.appendChild(node);return node;},
    createVector:()=>{const node=new Node("VECTOR");page.appendChild(node);return node;}};
  vi.stubGlobal("figma",mock);vi.stubGlobal("__html__","");
  const input={source:source as unknown as SceneNode,spec:defaultPresetEffect(),raster,sourceBox:{x:300,y:130,width:200,height:160},beforeWrite:vi.fn()};
  return {page,parent,source,text,before,input,Node,loadFontAsync,createImage,mock,posts};
}
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});

describe("Preset workpiece publication",()=>{
  it("keeps the original identity, native edits and world placement inside exactly one in-place workpiece",()=>{
    const f=fixture(),root=publishPresetEffect(f.input),parts=presetParts(root)!;
    expect(f.parent.children.map(n=>n.id)).toEqual([root.id]);expect(parts.source.id).toBe(f.source.id);
    expect(f.source.absoluteTransform).toEqual(f.before);expect(f.text.characters).toBe("Editable original");
    expect(parts.holder.visible).toBe(false);expect(parts.presentation.visible).toBe(true);
    expect(parts.presentation.findAll(n=>n.type==="VECTOR")).toHaveLength(1);
    expect(parts.presentation.findAll(n=>n.type==="RECTANGLE")).toHaveLength(1);
    expect(presetOwner(f.text as unknown as SceneNode)?.root.id).toBe(root.id);
    expect(f.input.beforeWrite).toHaveBeenCalledOnce();
  });
  it("updates a saved result and edited original without adding another workpiece",()=>{
    const f=fixture(),root=publishPresetEffect(f.input),parts=presetParts(root)!;
    const old=parts.presentation,sourceTransform=structuredClone(f.source.absoluteTransform);
    f.text.characters="New artwork";parts.holder.visible=true;parts.presentation.visible=false;
    const next=publishPresetEffect({...f.input,existing:parts,spec:{...f.input.spec,amount:.5},raster:{...raster,width:210}});
    expect(next).toBe(root);expect(f.parent.children).toHaveLength(1);expect(root.children).toHaveLength(2);
    expect(old.removed).toBe(true);expect(presetParts(root)?.record.spec.amount).toBe(.5);
    expect(f.source.absoluteTransform).toEqual(sourceTransform);expect(f.text.characters).toBe("New artwork");
  });
  it("preserves the original size when inserting the workpiece temporarily shares auto-layout FILL space",()=>{
    const f=fixture();f.parent.layoutMode="HORIZONTAL";f.source.layoutSizingHorizontal="FILL";
    const insert=f.parent.insertChild.bind(f.parent);
    f.parent.insertChild=(index,node)=>{insert(index,node);if(node!==f.source)f.source.width=100;};
    const parts=presetParts(publishPresetEffect(f.input))!;
    expect(parts.source.width).toBe(200);expect(parts.source.height).toBe(160);
    expect(f.source.absoluteTransform).toEqual(f.before);expect(f.parent.children).toEqual([parts.root]);
    expect(parts.root.layoutSizingHorizontal).toBe("FILL");
  });
  it("native duplicates resolve to their own original and updating a copy leaves the first workpiece intact",()=>{
    const f=fixture(),root=publishPresetEffect(f.input),originalRecord=root.getSharedPluginData("worldbend",PRESET_EFFECT_KEY);
    const copy=(root as unknown as InstanceType<typeof f.Node>).clone();f.parent.appendChild(copy);
    const parts=presetParts(copy as unknown as SceneNode)!;
    expect(parts.source.id).not.toBe(f.source.id);expect(parts.record.rootNodeId).toBe(copy.id);
    publishPresetEffect({...f.input,source:parts.source,existing:parts,spec:{...f.input.spec,effect:"card-turn"}});
    expect(root.getSharedPluginData("worldbend",PRESET_EFFECT_KEY)).toBe(originalRecord);
    expect(presetParts(root)?.source.id).toBe(f.source.id);expect(f.parent.children).toHaveLength(2);
  });
  it("constructs the stationary native content and local mask from a lone original",()=>{
    const f=fixture();const root=publishPresetEffect({...f.input,spec:{...f.input.spec,effect:"fold-screen"},raster:{...raster,baseWidth:100,layers:[{...raster.layers[0]!,name:"fold-inner"}]}});
    const parts=presetParts(root)!,base=parts.presentation.children[0] as FrameNode;
    expect(base.name).toBe("Stationary content");expect(base.width).toBe(100);expect(base.clipsContent).toBe(true);
    expect(base.children[0]?.id).not.toBe(f.source.id);expect(base.children[0]?.type).toBe("FRAME");
    expect(base.children[0]?.visible).toBe(true);expect(f.text.characters).toBe("Editable original");
    const glass=parts.presentation.children.find(n=>n.name==="Folding glass") as VectorNode;
    expect(glass.type).toBe("VECTOR");expect(glass.parent).toBe(parts.presentation);
    expect(glass.effects[0]?.type).toBe("DROP_SHADOW");expect(glass.fills).toHaveLength(1);expect(glass.strokes).toHaveLength(1);
    const face=parts.presentation.children.find(n=>n.name==="fold-inner") as FrameNode;
    expect(face.children.map(n=>n.name)).toEqual(["Effect mask","Projected artwork"]);
    expect(glass.vectorPaths).toEqual((face.children[0] as VectorNode).vectorPaths);
  });
  it("keeps the hinge and native original fixed when a new pose changes the output bounds",()=>{
    const f=fixture(),root=publishPresetEffect(f.input),parts=presetParts(root)!;
    const before=structuredClone(f.source.absoluteTransform);
    const nextRaster={...raster,origin:{x:-32,y:-113},width:280,height:320};
    publishPresetEffect({...f.input,existing:parts,raster:nextRaster});
    expect(f.source.absoluteTransform).toEqual(before);
    expect(root.absoluteTransform).toEqual([[1,0,268],[0,1,17]]);
    expect(parts.holder.relativeTransform).toEqual([[1,0,32],[0,1,113]]);
    expect(root.children).toHaveLength(2);
  });
  it("uses current world artwork bounds when reopening a moved and rotated workpiece",()=>{
    const f=fixture(),root=publishPresetEffect(f.input),parts=presetParts(root)!;
    root.relativeTransform=[[0,-1,70],[1,0,90]];
    const before=structuredClone(f.source.absoluteTransform);
    const box={x:before[0][2],y:before[1][2]-200,width:160,height:200};
    publishPresetEffect({...f.input,existing:parts,sourceBox:box});
    f.source.absoluteTransform.forEach((row,i)=>row.forEach((value,j)=>expect(value).toBeCloseTo(before[i]![j]!,10)));
    expect(root.absoluteTransform).toEqual([[1,0,box.x-1],[0,1,box.y-1]]);
  });
  it("leaves a zero fold as the unadorned artwork",()=>{
    const f=fixture(),root=publishPresetEffect({...f.input,spec:{...f.input.spec,effect:"fold-screen",amount:0},
      raster:{...raster,baseWidth:100,layers:[{...raster.layers[0]!,name:"fold-inner"}]}});
    expect(presetParts(root)!.presentation.children.some(n=>n.name==="Folding glass")).toBe(false);
  });
  it("restores the stationary copy's full width when native auto-layout cloning temporarily shrinks it",()=>{
    const f=fixture();f.parent.layoutMode="HORIZONTAL";f.source.layoutSizingHorizontal="FILL";
    const clone=f.source.clone.bind(f.source);f.source.clone=()=>{const copy=clone();copy.width=100;return copy;};
    const root=publishPresetEffect({...f.input,spec:{...f.input.spec,effect:"fold-screen"},
      raster:{...raster,baseWidth:100,layers:[{...raster.layers[0]!,name:"fold-inner"}]}});
    const base=presetParts(root)!.presentation.children[0] as FrameNode;
    expect(base.children[0]!.width).toBe(200);expect(base.children[0]!.height).toBe(160);
    expect(f.source.width).toBe(200);
  });
  it("aligns the visible artwork with its original when auto-layout controls the wrapper position",()=>{
    const f=fixture();f.parent.relativeTransform=[[1,0,700],[0,1,900]];
    f.parent.layoutMode="HORIZONTAL";f.parent.autoSlots={x:30,y:40,step:212};
    f.source.layoutSizingHorizontal="FILL";
    const neighbor=new f.Node("RECTANGLE");f.parent.appendChild(neighbor);
    const before=structuredClone(f.source.absoluteTransform),neighborBefore=structuredClone(neighbor.absoluteTransform);
    const input={...f.input,sourceBox:{x:730,y:940,width:200,height:160},spec:{...f.input.spec,effect:"fold-screen" as const},
      raster:{...raster,origin:{x:-32,y:-55},baseWidth:100}};
    const root=publishPresetEffect(input);
    for(const nextRaster of [input.raster,{...input.raster,origin:{x:-1,y:-1}}]) {
      if(nextRaster!==input.raster)publishPresetEffect({...input,existing:presetParts(root),raster:nextRaster,spec:{...input.spec,amount:0}});
      const parts=presetParts(root)!,base=parts.presentation.children[0] as FrameNode;
      expect(base.children[0]!.absoluteTransform).toEqual(before);
      expect(f.source.absoluteTransform).toEqual(before);expect(neighbor.absoluteTransform).toEqual(neighborBefore);
      expect(parts.presentation.absoluteTransform).toEqual([[1,0,730+nextRaster.origin.x],[0,1,940+nextRaster.origin.y]]);
      expect(root.layoutSizingHorizontal).toBe("FILL");expect(f.parent.children.map(n=>n.id)).toEqual([root.id,neighbor.id]);
    }
  });
  it("rolls back a failed new publication without moving or destroying the original",()=>{
    const f=fixture();f.createImage.mockImplementationOnce(()=>{throw Error("Image refused");});
    expect(()=>publishPresetEffect(f.input)).toThrow("Image refused");
    expect(f.parent.children).toEqual([f.source]);expect(f.source.absoluteTransform).toEqual(f.before);
    expect(f.source.removed).toBe(false);expect(f.page.children).toEqual([f.parent]);
  });
  it("rolls back a failed saved-record write with the previous view and edit state intact",()=>{
    const f=fixture(),root=publishPresetEffect(f.input),parts=presetParts(root)!;
    const before=root.getSharedPluginData("worldbend",PRESET_EFFECT_KEY);
    const rootTransform=structuredClone(root.relativeTransform),sourceTransform=structuredClone(f.source.absoluteTransform),
      holderTransform=structuredClone(parts.holder.relativeTransform);
    parts.holder.visible=true;parts.presentation.visible=false;
    const real=root.setSharedPluginData.bind(root);let fail=true;
    root.setSharedPluginData=(_namespace,key,value)=>{if(key===PRESET_EFFECT_KEY&&fail){fail=false;throw Error("Record refused");}real(_namespace,key,value);};
    expect(()=>publishPresetEffect({...f.input,existing:parts,raster:{...raster,width:240,origin:{x:-32,y:-70}}})).toThrow("Record refused");
    expect(root.width).toBe(raster.width);expect(root.children).toHaveLength(2);
    expect(root.getSharedPluginData("worldbend",PRESET_EFFECT_KEY)).toBe(before);
    expect(parts.holder.visible).toBe(true);expect(parts.presentation.visible).toBe(false);expect(parts.presentation.removed).toBe(false);
    expect(root.relativeTransform).toEqual(rootTransform);expect(parts.holder.relativeTransform).toEqual(holderTransform);
    expect(f.source.absoluteTransform).toEqual(sourceTransform);
  });
  it("refuses a damaged owned structure instead of treating it as a new source",()=>{
    const f=fixture(),root=publishPresetEffect(f.input);presetParts(root)!.presentation.remove();
    expect(()=>presetOwner(root)).toThrow("lost its original");expect(f.source.removed).toBe(false);
  });
  it("loads actual fonts and detects native source changes",async()=>{
    const f=fixture();await loadPresetFonts(f.source as unknown as SceneNode);
    expect(f.loadFontAsync).toHaveBeenCalledWith(f.text.fontName);
    const snapshot=presetSourceSnapshot(f.source as unknown as SceneNode);f.text.fontSize=24;
    expect(presetSourceSnapshot(f.source as unknown as SceneNode)).not.toBe(snapshot);
  });
});
describe("Closed preset wire contract",()=>{
  const message=()=>({type:"apply-preset-effect",generation:1,sourceNodeId:"original",sourceState:"current",spec:defaultPresetEffect(),raster:structuredClone(raster)});
  it("admits only the supported still spec and local publication record",()=>{
    expect(isPresetEffectSpec(defaultPresetEffect())).toBe(true);
    expect(isPresetEffectSpec({...defaultPresetEffect(),amount:NaN})).toBe(false);
    expect(isPresetEffectSpec({...defaultPresetEffect(),animated:true})).toBe(false);
    const f=fixture(),root=publishPresetEffect(f.input);
    expect(parsePresetEffectRecord(root.getSharedPluginData("worldbend",PRESET_EFFECT_KEY))?.sourceNodeId).toBe(f.source.id);
    expect(isUiToMainMessage(message())).toBe(true);
  });
  it("rejects mismatched effects, out-of-canvas masks, excess payloads and unknown fields",()=>{
    const m=message();m.spec.effect="fold-screen";expect(isUiToMainMessage(m)).toBe(false);
    const outside=message();outside.raster.layers[0]!.quad.tl.x=-1;expect(isUiToMainMessage(outside)).toBe(false);
    const huge=message();huge.raster.width=8193;expect(isUiToMainMessage(huge)).toBe(false);
    expect(isUiToMainMessage({...message(),extra:true})).toBe(false);
  });
});

async function mainFixture(owned=false,configure?:(f:ReturnType<typeof fixture>)=>void) {
  const f=fixture();configure?.(f);const selected=owned?publishPresetEffect(f.input):f.source;
  f.page.selection=[selected as unknown as InstanceType<typeof f.Node>];
  await import("./main");await f.mock.ui.onmessage?.({type:"ready",systemLocales:["en-US"],sceneDraftSessionId:"test-preset-session-0001"});
  await vi.waitFor(()=>expect(f.posts).toContainEqual(expect.objectContaining({type:"source"})));
  await f.mock.ui.onmessage?.({type:"request-preset-state"});
  const state=f.posts.findLast((p:any)=>p.type==="preset-state") as {generation:number;node:{nodeId:string}};
  await f.mock.ui.onmessage?.({type:"request-preset-source",generation:state.generation,requestId:1,nodeId:state.node.nodeId});
  const exported=f.posts.findLast((p:any)=>p.type==="preset-source") as {sourceState:string};
  expect(exported).toBeDefined();
  const request={type:"apply-preset-effect",generation:state.generation,sourceNodeId:f.source.id,sourceState:exported.sourceState,spec:defaultPresetEffect(),raster};
  return {...f,selected,request};
}
describe("Preset real main-message boundary",()=>{
  it("exports FILL artwork at its original size even when native cloning temporarily shares auto-layout space",async()=>{
    const f=await mainFixture(false,f=>{
      f.parent.layoutMode="HORIZONTAL";f.source.layoutSizingHorizontal="FILL";
      const clone=f.source.clone.bind(f.source);
      // Observed native behavior: clone() is born in the auto-layout parent,
      // so its initial dimensions reflect the space shared with the source.
      f.source.clone=()=>{const copy=clone();copy.width=f.source.width/2;return copy;};
    });
    expect(f.posts.findLast((p:any)=>p.type==="preset-source")).toEqual(expect.objectContaining({width:200,height:160}));
    expect(f.source.width).toBe(200);expect(f.source.parent).toBe(f.parent);
  });
  it("rejects a selection changed during font preflight even before a host event is delivered",async()=>{
    const f=await mainFixture();let release!:()=>void;
    f.loadFontAsync.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
    const applying=f.mock.ui.onmessage!(f.request);await vi.waitFor(()=>expect(release).toBeDefined());
    const other=new f.Node("FRAME");f.page.appendChild(other);f.page.selection=[other];release();await applying;
    expect(f.posts.at(-1)).toEqual(expect.objectContaining({type:"preset-error"}));
    expect(f.source.parent).toBe(f.parent);expect(f.parent.children).toEqual([f.source]);
  });
  it("rejects changed smoothing while the exported still waits for font preflight",async()=>{
    const f=await mainFixture(false,f=>{Object.assign(f.source,{cornerSmoothing:0});});let release!:()=>void;
    f.loadFontAsync.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
    const applying=f.mock.ui.onmessage!(f.request);await vi.waitFor(()=>expect(release).toBeDefined());
    Object.assign(f.source,{cornerSmoothing:.75});release();await applying;
    expect(f.posts.at(-1)).toEqual(expect.objectContaining({type:"preset-error"}));
    expect(f.source.parent).toBe(f.parent);expect(f.parent.children).toEqual([f.source]);
  });
  it("rejects changed ellipse geometry while the exported still waits for fonts",async()=>{
    let ellipse:any;const f=await mainFixture(false,f=>{ellipse=new f.Node("ELLIPSE");ellipse.arcData={startingAngle:0,endingAngle:Math.PI*2,innerRadius:0};f.source.appendChild(ellipse);});
    let release!:()=>void;f.loadFontAsync.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
    const applying=f.mock.ui.onmessage!(f.request);await vi.waitFor(()=>expect(release).toBeDefined());
    ellipse.arcData={...ellipse.arcData,endingAngle:Math.PI};release();await applying;
    expect(f.posts.at(-1)).toEqual(expect.objectContaining({type:"preset-error"}));
    expect(f.source.parent).toBe(f.parent);expect(f.parent.children).toEqual([f.source]);
  });
  it("rejects a moved workpiece during font preflight without replacing its presentation",async()=>{
    const f=await mainFixture(true);let release!:()=>void;
    f.loadFontAsync.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
    const applying=f.mock.ui.onmessage!(f.request);await vi.waitFor(()=>expect(release).toBeDefined());
    const parts=presetParts(f.selected as unknown as SceneNode)!;const presentation=parts.presentation;
    f.selected.relativeTransform=[[1,0,500],[0,1,300]];release();await applying;
    expect(f.posts.at(-1)).toEqual(expect.objectContaining({type:"preset-error"}));
    expect(presentation.removed).toBe(false);expect(presetParts(f.selected as unknown as SceneNode)!.presentation).toBe(presentation);
  });
  it("rejects a newer saved effect changed during font preflight",async()=>{
    const f=await mainFixture(true);let release!:()=>void;
    f.loadFontAsync.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
    const applying=f.mock.ui.onmessage!(f.request);await vi.waitFor(()=>expect(release).toBeDefined());
    const saved=JSON.parse(f.selected.getSharedPluginData("worldbend",PRESET_EFFECT_KEY));saved.spec.amount=.3;
    const raw=JSON.stringify(saved);f.selected.setSharedPluginData("worldbend",PRESET_EFFECT_KEY,raw);release();await applying;
    expect(f.posts.at(-1)).toEqual(expect.objectContaining({type:"preset-error"}));
    expect(f.selected.getSharedPluginData("worldbend",PRESET_EFFECT_KEY)).toBe(raw);expect(f.selected.children).toHaveLength(2);
  });
});
