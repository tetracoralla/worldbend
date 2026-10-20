import {describe,expect,it} from "vitest";
import {decodeExactJson,encodeExactJson} from "./exact-json-codec";
import {sha256Hex} from "../../web/src/sha256";
describe("bounded exact JSON transport",()=>{
  it("retains all Unicode, numbers and handle presence through lossless data compression",()=>{
    const value={name:"汉字😀",lone:"\ud800",vertices:Array.from({length:7323},(_,i)=>({x:i/7323,y:Math.sin(i)})),tangentStart:{x:0,y:-0.000001},holes:[[0,1,2],[3,4,5]]};
    const wire=encodeExactJson(value);expect(wire.data.length).toBeLessThan(JSON.stringify(value).length);expect(decodeExactJson(wire)).toEqual(value);
    expect(decodeExactJson(encodeExactJson(value,false))).toEqual(value);
  });
  it("refuses truncated/mutated/mixed data and stops a lying decompression expansion",()=>{
    const wire=encodeExactJson({content:"x".repeat(2*1024*1024)});
    expect(()=>decodeExactJson({...wire,data:wire.data.slice(0,-4)})).toThrow(/changed/);
    expect(()=>decodeExactJson({...wire,decodedBytes:1})).toThrow(/length/);
    expect(()=>decodeExactJson({...wire,extra:"汉"})).toThrow(/changed/);
    const data=wire.data.slice(0,-4);expect(()=>decodeExactJson({...wire,data,digest:sha256Hex(data)})).toThrow();
    expect(decodeExactJson(encodeExactJson({recovered:true}))).toEqual({recovered:true});
  });
});
