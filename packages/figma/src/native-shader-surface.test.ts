import {afterEach,describe,expect,it,vi} from "vitest";
import {createNativeShaderSurface} from "./native-shader-surface";

afterEach(()=>vi.unstubAllGlobals());

interface TestFrame {
  id:string;type:string;visible:boolean;locked:boolean;children:unknown[];layoutMode:string;width:number;height:number;removed:boolean;
  effects:Array<{type:string;visible:boolean;id:string;properties:Record<string,number>}>;
  resizeWithoutConstraints(width:number,height:number):void;
  getSharedPluginData(ns:string,key:string):string;
  setSharedPluginData(ns:string,key:string,value:string):void;
  remove():void;clone():TestFrame;
}
const shaderProperties=(node:FrameNode)=>(node.effects[0] as {properties:Record<string,number>}).properties;

function host() {
  let sequence=0;
  const pageData=new Map<string,string>();
  const nodes:TestFrame[]=[];
  const page={children:nodes,getSharedPluginData:(_ns:string,key:string)=>pageData.get(key)??"",
    setSharedPluginData:(_ns:string,key:string,value:string)=>pageData.set(key,value)};
  function frame():TestFrame {
    const data=new Map<string,string>();
    const node:TestFrame={id:`frame:${++sequence}`,type:"FRAME",visible:true,locked:false,children:[],layoutMode:"NONE",width:100,height:100,
      effects:[] as Array<{type:string;visible:boolean;id:string;properties:Record<string,number>}>,removed:false,
      resizeWithoutConstraints(width:number,height:number){this.width=width;this.height=height;},
      getSharedPluginData:(_ns:string,key:string)=>data.get(key)??"",
      setSharedPluginData:(_ns:string,key:string,value:string)=>data.set(key,value),
      remove(){this.removed=true;nodes.splice(nodes.indexOf(this),1);},
      clone(){const clone=frame();clone.width=this.width;clone.height=this.height;clone.effects=structuredClone(this.effects);
        for(const [key,value] of data)clone.setSharedPluginData("worldbend",key,value);return clone;}};
    nodes.push(node);return node;
  }
  vi.stubGlobal("figma",{currentPage:page,createFrame:frame});
  return {page,frame,nodes};
}

describe("immutable native Shader surfaces",()=>{
  it("keeps earlier projections independent while reusing one hidden resource",async()=>{
    const {nodes}=host();
    const first=(await createNativeShaderSurface({shaderId:"pinned",properties:{h00:1},width:300,height:180}))();
    const second=(await createNativeShaderSurface({shaderId:"pinned",properties:{h00:2},width:400,height:240}))();
    expect(shaderProperties(first)).toEqual({h00:1});
    expect(shaderProperties(second)).toEqual({h00:2});
    expect(first).not.toBe(second);
    expect(nodes.filter(node=>!node.visible)).toHaveLength(1);
    expect(first.getSharedPluginData("worldbend","nativeShaderTemplate")).toBe("");
    expect(second.getSharedPluginData("worldbend","nativeShaderTemplate")).toBe("");
    expect(first.locked).toBe(false);
    expect(second.locked).toBe(false);
    expect([first.width,first.height,second.width,second.height]).toEqual([300,180,400,240]);
  });

  it("preserves a resource that someone revealed or repurposed",async()=>{
    const {nodes}=host();
    (await createNativeShaderSurface({shaderId:"pinned",properties:{h00:1},width:300,height:180}))();
    const old=nodes.find(node=>!node.visible)!;old.visible=true;
    (await createNativeShaderSurface({shaderId:"pinned",properties:{h00:2},width:400,height:240}))();
    expect(old.visible).toBe(true);expect(old.effects[0]?.properties).toEqual({h00:1});
    expect(nodes.filter(node=>!node.visible)).toHaveLength(1);
  });

  it("holds preparation until synchronous cloning and releases it after a rejected scene proof",async()=>{
    const {nodes}=host();
    const first=await createNativeShaderSurface({shaderId:"pinned",properties:{h00:1},width:300,height:180,
      beforeCreate:()=>{throw Error("source changed");}});
    let admitted=false;
    const second=createNativeShaderSurface({shaderId:"pinned",properties:{h00:2},width:400,height:240}).then(create=>{admitted=true;return create;});
    await Promise.resolve();expect(admitted).toBe(false);
    expect(nodes.filter(node=>node.visible)).toHaveLength(0);
    expect(first).toThrow("source changed");
    const result=(await second)();expect(shaderProperties(result)).toEqual({h00:2});
    expect(nodes.filter(node=>!node.visible)).toHaveLength(1);
    expect(nodes.filter(node=>node.visible)).toHaveLength(1);
  });
});
