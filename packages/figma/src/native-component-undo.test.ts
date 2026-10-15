import { afterEach, describe, expect, it, vi } from "vitest";
import { componentSnapshot } from "./native-component";
import { restoreNativePublicationUndo, type NativePublicationUndo } from "./native-document";

const identity=[[1,0,0],[0,1,0]];
afterEach(()=>vi.unstubAllGlobals());

describe("native component undo recovery",()=>{
  it.each([false,true])("leaves a restored host graph untouched even with reordered shader properties (%s)",async(reordered)=>{
    vi.stubGlobal("figma",{skipInvisibleInstanceChildren:true});
    const frame=(id:string,type="FRAME")=>({id,type,width:300,height:180,x:0,y:0,children:[] as unknown[],
      relativeTransform:structuredClone(identity),effects:[],clipsContent:false,resizeWithoutConstraints:vi.fn()});
    const result=frame("result"),surface=frame("surface"),basis=frame("basis"),master=frame("master","COMPONENT");
    const content=frame("content"),masterContent=frame("masterContent"),instance={...frame("instance","INSTANCE"),scaleFactor:1,getMainComponentAsync:async()=>master};
    result.children=[surface,master];surface.children=[basis];basis.children=[instance];instance.children=[content];master.children=[masterContent];
    const slots:Record<string,string>={native:"native-before",binding:"binding-before",transform:"operation-before"};
    Object.assign(result,{getSharedPluginData:(_ns:string,key:string)=>slots[key]??"",removed:false});
    const parts={surface,basis,instance,master,content,masterContent};
    const properties={h00:1,h01:0,h02:0,h10:0,h11:1,h12:0,h20:0,h21:0,h22:1,sourceRight:1,sourceBottom:1};
    Object.assign(surface,{effects:[{type:"SHADER",id:"pinned-renderer",visible:true,properties}]});
    const saved:NativePublicationUndo={resultNodeId:result.id,contentNodeId:content.id,surfaceNodeId:surface.id,masterNodeId:master.id,instanceNodeId:instance.id,
      component:componentSnapshot(result as unknown as FrameNode,parts as never),sourceWidth:300,sourceHeight:180,width:300,height:180,x:0,y:0,surfaceWidth:300,surfaceHeight:180,effects:[],
      native:"native-before",binding:"binding-before",operation:"operation-before",publishedNative:"native-after"};
    if(reordered)Object.assign(surface,{effects:[{type:"SHADER",id:"pinned-renderer",visible:true,
      properties:Object.fromEntries(Object.entries(properties).reverse())}]});
    const beforeWrite=vi.fn();
    await restoreNativePublicationUndo(result as unknown as FrameNode,saved,beforeWrite);
    expect(beforeWrite).not.toHaveBeenCalled();
    for(const node of [result,surface,basis])expect(node.resizeWithoutConstraints).not.toHaveBeenCalled();
  });
});
