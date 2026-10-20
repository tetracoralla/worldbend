import {afterEach,expect,it,vi} from "vitest";
import * as component from "./native-component";
import * as records from "./native-projective";
import {nativePublicationUndoFor,publishNativeResult} from "./native-document";

afterEach(()=>vi.restoreAllMocks());

it("captures Undo dimensions before native copy publication retires the old instance sublayers",async()=>{
  let retired=false;
  const content={id:"old-content",get width(){if(retired)throw Error("instance sublayer does not exist");return 375;},
    get height(){if(retired)throw Error("instance sublayer does not exist");return 225;}};
  const parts={content,surface:{id:"surface"},master:{id:"proxy-source"},instance:{id:"old-instance"}};
  const result={id:"result",getSharedPluginData:(_ns:string,key:string)=>key==="native"?(retired?"published":"prior"):key};
  vi.spyOn(records,"readNativeProjection").mockReturnValue({version:"0.3"} as never);
  vi.spyOn(component,"componentNativeParts").mockResolvedValue(parts as never);
  vi.spyOn(component,"componentSnapshot").mockReturnValue({result:{width:400,height:240,x:10,y:20},
    surfaceSize:{width:400,height:240},effects:[]} as never);
  vi.spyOn(component,"publishComponentNativeResult").mockImplementation(async()=>{retired=true;return result as never;});
  await expect(publishNativeResult({existing:result,nativePlan:{kind:"affine"}} as never)).resolves.toBe(result);
  expect(nativePublicationUndoFor(result as never)).toMatchObject({contentNodeId:"old-content",sourceWidth:375,sourceHeight:225,
    width:400,height:240,x:10,y:20,publishedNative:"published"});
});
