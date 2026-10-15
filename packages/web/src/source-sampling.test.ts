import {readFile} from "node:fs/promises";
import {beforeAll,describe,expect,it} from "vitest";
import {initSync} from "@worldbend/wasm";
import {planSourceCapture,validateSourceSamplingFrame} from "./bridge";
import type {SourceCaptureFacts} from "./types";

beforeAll(async()=>{
  const bytes=await readFile(new URL("../../wasm/pkg/worldbend_wasm_bg.wasm",import.meta.url));
  initSync({module:new WebAssembly.Module(bytes)});
});

const capture:SourceCaptureFacts={logicalSize:{width:100,height:50},
  logicalToCaptureSpace:[[1,0,70000.25],[0,1,-1000.375]],
  captureOrigin:{x:70000.25,y:-1000.375},captureScale:2,
  pixelSize:{width:200,height:100},convention:"fixedDensityFromOrigin"};

describe("source capture through the actual WASM bridge",()=>{
  it("keeps logical and encoded sizes distinct with origin-relative precision",async()=>{
    const view=await planSourceCapture(capture);
    expect(view).toEqual({schema:"worldbend.source-sampling",version:"0.1",logicalSize:{width:100,height:50},
      pixelSize:{width:200,height:100},logicalUvToTextureUv:[[1,0,0],[0,1,0]]});
    expect(await validateSourceSamplingFrame(view)).toEqual(view);
    const rounded=await planSourceCapture({...capture,pixelSize:{width:201,height:100}});
    expect(rounded.logicalUvToTextureUv[0]![0]).toBe(200/201);
  });
  it("retains signed reflection and rejects malformed or singular input",async()=>{
    const reflected=await planSourceCapture({...capture,logicalToCaptureSpace:[[-1,0,100],[0,1,0]],captureOrigin:{x:0,y:0}});
    expect(reflected.logicalUvToTextureUv).toEqual([[-1,0,1],[0,1,0]]);
    await expect(planSourceCapture({...capture,logicalToCaptureSpace:[[1,0,0],[1,0,0]]})).rejects.toMatchObject({code:"E_HOMOGRAPHY_SINGULAR"});
    await expect(planSourceCapture({...capture,extra:true} as SourceCaptureFacts)).rejects.toMatchObject({code:"E_SCHEMA"});
  });
  it("bounds errors and rejects oversized metadata before parsing",async()=>{
    await expect(planSourceCapture({...capture,["x".repeat(12000)]:1} as SourceCaptureFacts)).rejects.toMatchObject({code:"E_OUTPUT_LIMIT"});
    try {await planSourceCapture({...capture,["x".repeat(4000)]:1} as SourceCaptureFacts);expect.fail("accepted extra field");}
    catch(error) {expect(String(error).length).toBeLessThan(400);}
  });
});
