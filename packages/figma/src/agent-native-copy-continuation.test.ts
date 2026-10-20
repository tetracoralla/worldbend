import {afterEach,expect,it,vi} from "vitest";
import * as component from "./native-component";
import * as topology from "./native-component-topology";
import * as document from "./native-document";
import * as records from "./native-projective";
import {apply,inspect} from "./agent-handoff";

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

it("reads the visible copied Source extent and publishes that Source, not the inactive live instance",async()=>{
  const page={id:"page",type:"PAGE"};
  const content={id:"content",type:"FRAME",width:375,height:225};
  const masterContent={id:"editing",type:"FRAME",width:520,height:300};
  const surface={id:"surface",type:"FRAME",width:412,height:270};
  const result={id:"copy",type:"FRAME",parent:page,children:[surface],x:10,y:20,width:520,height:300,
    getSharedPluginData:(_ns:string,key:string)=>key==="nativePlacement"?"":key};
  const parts={content,masterContent,surface,master:{type:"INSTANCE"}};
  const spec={schema:"worldbend.transform",version:"0.1",content:{fit:"stretch"},
    destination:{space:"normalized",quad:{tl:{x:0,y:0},tr:{x:1,y:0},br:{x:1,y:1},bl:{x:0,y:1}}}};
  vi.spyOn(records,"readNativeProjection").mockReturnValue({version:"0.3",sourceEditing:true,outputSize:{width:412,height:270}} as never);
  vi.spyOn(topology,"componentNativeTopology").mockReturnValue(parts as never);
  vi.spyOn(component,"componentNativeParts").mockResolvedValue(parts as never);
  vi.spyOn(document,"nativeDocumentParts").mockResolvedValue({...parts,binding:{revision:2},copied:true,spec} as never);
  const publish=vi.spyOn(document,"publishNativeResult").mockResolvedValue(result as never);
  vi.stubGlobal("figma",{fileKey:"file",currentPage:page,getNodeByIdAsync:async(id:string)=>id===result.id?result:content});
  const before=await inspect(result.id,"file","page");
  expect(before.source).toEqual({nodeId:"content",width:520,height:300});
  expect(before.placement).toEqual({x:10,y:20,width:412,height:270});
  masterContent.width=530;
  expect((await inspect(result.id,"file","page")).expected).not.toBe(before.expected);
  masterContent.width=520;
  await apply({...before,width:412,height:270,inverse:[1,0,0,0,1,0,0,0,1],nativePlan:{kind:"affine"}} as never);
  expect(publish).toHaveBeenCalledWith(expect.objectContaining({source:masterContent,existing:result}));
});
