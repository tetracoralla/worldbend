import { describe, expect, it } from "vitest";
import {changeRasterCanvas,type RasterCanvasChange} from "./raster-canvas-change";

describe("deformation canvas transport",()=>{
  it.each(([
    [[1,0,120],[0,1,80]],[[.8,-.6,120],[.6,.8,80]],[[1,.3,120],[0,-1,80]],
  ] as [[number,number,number],[number,number,number]][]).map(matrix=>[matrix] as const))("retains authored pixel positions in rotated, reflected and sheared node axes",(matrix)=>{
    const node={width:200,height:100,relativeTransform:structuredClone(matrix),resize(w:number,h:number){this.width=w;this.height=h;}};
    const change:RasterCanvasChange={workExpected:"a".repeat(64),from:{origin:{x:0,y:0},reference:{width:100,height:100}},to:{origin:{x:-10,y:-20},reference:{width:120,height:140}}};
    const pagePoint=(x:number,y:number)=>{const m=node.relativeTransform;return{x:m[0][0]*x+m[0][1]*y+m[0][2],y:m[1][0]*x+m[1][1]*y+m[1][2]};};
    const before=pagePoint(60,40);
    changeRasterCanvas(node,change);
    const after=pagePoint(80,60);
    expect(after.x).toBeCloseTo(before.x,10);expect(after.y).toBeCloseTo(before.y,10);
    expect([node.width,node.height]).toEqual([240,140]);
    changeRasterCanvas(node,{from:change.to,to:change.from,workExpected:change.workExpected});
    expect(node.relativeTransform).toEqual(matrix);expect([node.width,node.height]).toEqual([200,100]);
  });
});
