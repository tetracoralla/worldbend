import {describe,expect,it} from "vitest";
import {nativePagePlacement,pointInCoordinateParent} from "./coordinate-parent";
import {nativePlacementPagePoint,nativePlacementPointFromPage,nativeOutputBounds,nativeOutputAtBounds} from "./native-output-position";
describe("native placement coordinates",()=>{
  it("retains intrinsic output size instead of repeatedly expanding a rotated bounding box",()=>{
    const result={width:400,height:260,absoluteTransform:[[.98,-.19,91332],[.19,.98,24828]],absoluteBoundingBox:{x:91282,y:24828,width:442,height:332}} as unknown as FrameNode;
    expect(nativePagePlacement(result)).toEqual({x:91332,y:24828,width:400,height:260});
    expect(nativePagePlacement(result,{width:600,height:390}).width).toBe(600);
  });
  it("round trips rotated, reflected and sheared parents through Groups",()=>{
    for(const matrix of [[[0,-1,91000],[1,0,25000]],[[-1,.6,91000],[0,1,25000]],[[1,.9,91000],[.1,1,25000]]]){
      const parent={type:"FRAME",absoluteTransform:matrix,parent:null};
      const node={parent:{type:"GROUP",parent:{type:"BOOLEAN_OPERATION",parent}}} as unknown as BaseNode;
      const x=280,y=220,point={x:matrix[0]![0]!*x+matrix[0]![1]!*y+matrix[0]![2]!,y:matrix[1]![0]!*x+matrix[1]![1]!*y+matrix[1]![2]!};
      const local=pointInCoordinateParent(node,point);expect(local.x).toBeCloseTo(x,8);expect(local.y).toBeCloseTo(y,8);
    }
  });
  it("refuses a singular parent before changing the native result",()=>{
    expect(()=>pointInCoordinateParent({parent:{type:"FRAME",absoluteTransform:[[1,1,0],[1,1,0]]}} as unknown as BaseNode,{x:10,y:20})).toThrow(/coordinate basis/);
  });
  it("maps tight-frame displacement through the native root rather than page axes",()=>{
    const basis:[ [number,number,number],[number,number,number] ]=[[-1.2585,.2369,91456],[-.2817,.5298,24832]];
    const page=nativePlacementPagePoint({x:91456,y:24858},basis);
    expect(page.x).toBeCloseTo(91456+.2369*26,8);expect(page.y).toBeCloseTo(24832+.5298*26,8);
    expect(nativePlacementPointFromPage(page,basis).x).toBeCloseTo(91456,8);
    expect(nativePlacementPointFromPage(page,basis).y).toBeCloseTo(24858,8);
    const desiredPage={x:page.x+10,y:page.y};
    const intrinsic=nativePlacementPointFromPage(desiredPage,basis);
    const actual=nativePlacementPagePoint(intrinsic,basis);
    expect(actual.x).toBeCloseTo(desiredPage.x,8);expect(actual.y).toBeCloseTo(desiredPage.y,8);
  });
  it("places an independent page copy by its bounds while retaining all native axes",()=>{
    const basis:[[number,number,number],[number,number,number]]=[[-1.2585,.2369,91456],[-.2817,.5298,24832]];
    const size={width:400,height:260},origin={x:92000,y:25000};
    const copy=nativeOutputAtBounds(size,origin,basis),bounds=nativeOutputBounds(size,copy);
    expect(bounds.x).toBeCloseTo(origin.x,8);expect(bounds.y).toBeCloseTo(origin.y,8);
    expect(bounds.width).toBeCloseTo(1.2585*400+.2369*260,8);
    expect(bounds.height).toBeCloseTo(.2817*400+.5298*260,8);
    expect(copy.map(row=>row.slice(0,2))).toEqual(basis.map(row=>row.slice(0,2)));
  });
});
