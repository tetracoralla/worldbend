import {describe,it,expect} from "vitest";
import {nativeOutlineInsideClip} from "./native-vector-clip-proof";
const clip={transform:[[1,0,0],[0,1,0]] as Transform,width:120,height:80,inset:0};
describe("native outline no-crop certificate",()=>{
  it("admits interior bounds but keeps actual near-boundary overhangs and edge uncertainty",()=>{
    expect(nativeOutlineInsideClip({x:10,y:10,width:100,height:50},clip)).toBe(true);
    expect(nativeOutlineInsideClip({x:110,y:10,width:10.0000801086,height:50},clip)).toBe(false);
    expect(nativeOutlineInsideClip({x:110,y:10,width:10,height:50},clip)).toBe(false);
    expect(nativeOutlineInsideClip({x:110,y:10,width:10.08,height:50},{...clip,height:100000})).toBe(false);
  });
  it("proves against every transformed corner and a rounded clip's inner rectangle",()=>{
    const rotated={...clip,transform:[[0,-1,200],[1,0,300]] as Transform};
    expect(nativeOutlineInsideClip({x:130,y:310,width:50,height:90},rotated)).toBe(true);
    expect(nativeOutlineInsideClip({x:119,y:310,width:50,height:90},rotated)).toBe(false);
    expect(nativeOutlineInsideClip({x:31,y:31,width:20,height:10},{...clip,inset:30})).toBe(true);
    expect(nativeOutlineInsideClip({x:1,y:1,width:10,height:10},{...clip,inset:30})).toBe(false);
  });
  it("refuses singular, nonfinite and cancellation-uncertain native bases",()=>{
    expect(nativeOutlineInsideClip({x:10,y:10,width:1,height:1},{...clip,transform:[[1,1,0],[1,1,0]]})).toBe(false);
    expect(nativeOutlineInsideClip({x:Infinity,y:0,width:1,height:1},clip)).toBe(false);
    expect(nativeOutlineInsideClip({x:1e16,y:1e16,width:1,height:1},{...clip,transform:[[1,0,1e16],[0,1,1e16]]})).toBe(false);
  });
});
