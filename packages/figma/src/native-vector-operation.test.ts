import {vector_artwork_json} from "../../wasm/pkg-figma/worldbend_wasm.js";
import {describe,it,expect} from "vitest";
import {planVectorArtwork,planVectorProjection,planVectorOperation} from "@worldbend/web";
import {nativeVectorArtworkFromInputs,nativeVectorOperationInput} from "./native-vector-operation";
import type {VectorProjectionInput,VectorOperation,TransformSpec} from "@worldbend/web/types";
const spec:TransformSpec={schema:"worldbend.transform",version:"0.1",destination:{space:"normalized",quad:{tl:{x:0,y:0},tr:{x:1,y:0},br:{x:1,y:1},bl:{x:0,y:1}}},content:{fit:"stretch"}};
function input(count=4):VectorProjectionInput {
  const vertices=Array.from({length:count},(_,i)=>({x:.5+.4*Math.cos(i/count*Math.PI*2),y:.5+.4*Math.sin(i/count*Math.PI*2)}));
  return {schema:"worldbend.vector-projection",version:"0.1",path:{vertices,
    segments:vertices.map((_,i)=>({start:i,end:(i+1)%count})),regions:[{windingRule:"NONZERO",loops:[vertices.map((_,i)=>i)]}]},
    sourceTransform:[1,0,0,0,1,0],sourceBounds:{x:0,y:0,width:1,height:1},homography:[100,0,0,0,100,0,0,0,1],reference:{width:100,height:100},placement:{width:100,height:100}};
}
describe("canonical native artwork operation relay",()=>{
  it("projects outward work with the same complete frame as raster execution",async()=>{
    const operation:VectorOperation={kind:"deformationWork",spec:{schema:"worldbend.deformation-work",version:"0.1",transform:spec,
      targetSize:{width:100,height:100},boundary:"free",meshSubdivisions:4,
      meshEdits:[{column:2,row:0,warped:{x:.5,y:-.2}},{column:2,row:4,warped:{x:.5,y:1.2}}]}};
    const output=await planVectorArtwork(nativeVectorArtworkFromInputs(operation,[input()]));
    expect(output.plan.reference).toEqual({width:100,height:140});
    expect(output.plan.executionFrame!).toMatchObject({reference:{width:100,height:140},transform:{destination:{space:"normalized"}}});
    expect(output.plan.mesh!.vertices.every(v=>v.warped.y>=0&&v.warped.y<=1)).toBe(true);
    expect(operation.spec.targetSize).toEqual({width:100,height:100});
  });
  it("uses one actual WASM job and keeps legacy projection bytes and next-call recovery",async()=>{
    const inputs=[input(4),input(669)],operation:VectorOperation={kind:"transform",spec};
    const job=nativeVectorArtworkFromInputs(operation,inputs);const result=await planVectorArtwork(job);
    expect(result.outputs).toEqual(await Promise.all(inputs.map(planVectorProjection)));
    expect(result.usage.inputVertices).toBe(673);expect(result.usage.outputBytes).toBe(vector_artwork_json(JSON.stringify(job)).length);
    await expect(planVectorArtwork(nativeVectorArtworkFromInputs(operation,Array.from({length:9},()=>input(1024))))).rejects.toThrow();
    expect((await planVectorArtwork(job)).usage.parts).toBe(2);
  });
  it("does not reduce complete Pin/Liquify/Mesh values to outer transforms",async()=>{
    const operation:VectorOperation={kind:"deformationWork",spec:{schema:"worldbend.deformation-work",version:"0.1",transform:spec,
      meshSubdivisions:4,meshEdits:[{column:1,row:1,warped:{x:.26,y:.24}}],
      liquify:{strokes:[{id:"brush",mode:"push",samples:[{position:{x:.7,y:.7},delta:{x:0,y:.01},radius:.2,strength:1}]}]}}};
    const before=JSON.stringify(operation);const resolved=await planVectorOperation(nativeVectorOperationInput(operation,{width:100,height:100}));
    const job=nativeVectorArtworkFromInputs(operation,[input()]);expect(job.operation).toBe(operation);
    expect((await planVectorArtwork(job)).plan).toEqual(resolved);expect(JSON.stringify(operation)).toBe(before);
    expect(resolved.mesh!.vertices.some(v=>v.source.x!==v.warped.x||v.source.y!==v.warped.y)).toBe(true);
  });
  it("refuses a heterogeneous relay instead of choosing one part's authored meaning",()=>{
    const second=input();second.placement.width=101;
    expect(()=>nativeVectorArtworkFromInputs({kind:"transform",spec},[input(),second])).toThrow("canonical basis");
  });
  it("compares the actual shared basis rather than JSON object member order",async()=>{
    const second=input();
    second.sourceBounds={height:1,width:1,y:0,x:0};
    second.reference={height:100,width:100};second.placement={height:100,width:100};
    const job=nativeVectorArtworkFromInputs({kind:"transform",spec},[input(),second]);
    const result=await planVectorArtwork(job);
    expect(result.outputs).toHaveLength(2);expect(result.outputs[0]).toEqual(result.outputs[1]);
  });
});
