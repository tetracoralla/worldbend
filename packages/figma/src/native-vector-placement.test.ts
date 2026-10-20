import {describe,it,expect} from "vitest";
import {prepareNativeCapturePlacement,placeNativeCapture} from "./native-vector-placement";
import {installNativeTestBasis,appendNativeTestChild} from "./native-capture-test-host";
function fixture() {
  const page:any={type:"PAGE",children:[],appendChild:(node:any)=>appendNativeTestChild(page,node)};
  let next=0;const made:any[]=[];
  const node=(type:string,matrix:Transform,parent:any=page)=>{
    const n:any=installNativeTestBasis({id:`n${next++}`,type,relativeTransform:matrix,width:100,height:80,children:[],visible:true});
    parent.appendChild(n);return n;
  };
  const host:any={currentPage:page,createFrame:()=>node("FRAME",[[1,0,0],[0,1,0]])};
  return {page,node,host,track:<T>(n:T)=>{made.push(n);return n;},made};
}
describe("legal native capture ancestry",()=>{
  it("keeps compound legal columns in native ancestors instead of assigning their product to Page",()=>{
    const h=fixture(),u=h.node("FRAME",[[1,.2,200],[0,1,300]]),v=h.node("FRAME",[[.99,0,10],[0,.99,20]],u);
    const source=h.node("TEXT",[[1,0,30],[0,1,40]],v),clone=h.node("TEXT",[[1,0,0],[0,1,0]]);
    const before=JSON.stringify(source.absoluteTransform),frames=placeNativeCapture(clone,source,h.host,h.track);
    expect(frames.map(f=>f.relativeTransform)).toEqual([u.relativeTransform,v.relativeTransform]);
    expect(clone.relativeTransform).toEqual(source.relativeTransform);expect(JSON.stringify(clone.absoluteTransform)).toBe(before);
    expect(JSON.stringify(source.absoluteTransform)).toBe(before);expect(clone.parent).toBe(frames[1]);
  });
  it("includes Section basis but treats Group/Boolean parents as transparent containing-coordinate wrappers",()=>{
    const h=fixture(),section=h.node("SECTION",[[1,0,200],[0,1,300]]),group=h.node("GROUP",[[1,0,900],[0,1,800]],section);
    const boolean=h.node("BOOLEAN_OPERATION",[[1,0,70],[0,1,60]],group),source=h.node("VECTOR",[[1,0,10],[0,1,20]],boolean),clone=h.node("VECTOR",[[1,0,0],[0,1,0]]);
    const frames=placeNativeCapture(clone,source,h.host,h.track);
    expect(frames).toHaveLength(1);expect(frames[0]!.relativeTransform).toEqual(section.relativeTransform);
    expect(clone.absoluteTransform).toEqual(source.absoluteTransform);
  });
  it("refuses silent setter normalization and changed clone dimensions",()=>{
    const h=fixture(),source=h.node("TEXT",[[.99,.2,10],[0,.99,20]]),clone=h.node("TEXT",[[1,0,0],[0,1,0]]);
    Object.defineProperty(clone,"relativeTransform",{get:()=>[[1,.2,10],[0,1,20]],set:()=>{}});
    expect(()=>placeNativeCapture(clone,source,h.host,h.track)).toThrow("source basis");
    const changed=h.node("TEXT",[[1,0,0],[0,1,0]]);changed.width=101;
    expect(()=>placeNativeCapture(changed,source,h.host,h.track)).toThrow("size");
  });
  it("pins the pre-clone pose and enforces the ancestry resource bound",()=>{
    const h=fixture(),parent=h.node("FRAME",[[1,0,20],[0,1,30]]),source=h.node("TEXT",[[1,0,10],[0,1,10]],parent);
    const expected=structuredClone(source.absoluteTransform),prepared=prepareNativeCapturePlacement(source,h.host,h.track);
    source.relativeTransform=[[1,0,999],[0,1,999]];
    const clone=h.node("TEXT",[[1,0,0],[0,1,0]]);prepared.place(clone);expect(clone.absoluteTransform).toEqual(expected);
    let ancestor:any=h.page;for(let i=0;i<65;i++)ancestor=h.node("FRAME",[[1,0,0],[0,1,0]],ancestor);
    const deep=h.node("TEXT",[[1,0,0],[0,1,0]],ancestor);
    expect(()=>prepareNativeCapturePlacement(deep,h.host,h.track)).toThrow("depth budget");
  });
});

import {restoreNativeStrokeOutlineParent} from "./native-vector-placement";
describe("native outline parent-local recovery",()=>{
  it.each([
    [[1,0,87000],[0,1,18000]],
    [[0,-1,87000],[1,0,18000]],
    [[.9888927936553955,.2101956605911255,87000],[2.9289255465e-9,.9888927936553955,18000]],
  ].map(basis=>({basis})))("restores the native returned stroke offset before flatten in basis $basis",({basis})=>{
    const page:any={type:"PAGE",children:[],appendChild:(node:any)=>appendNativeTestChild(page,node)};
    const parent:any=installNativeTestBasis({type:"FRAME",relativeTransform:basis,children:[],parent:page});
    const working:any=installNativeTestBasis({type:"VECTOR",relativeTransform:[[1,0,-60],[0,1,-50]],parent});
    // Actual SDK outlineStroke returns Page + the source-parent-local matrix.
    const outline:any=installNativeTestBasis({type:"VECTOR",relativeTransform:[[1,0,-60.5],[0,1,-50.5]],width:301,height:181,parent:page});page.children.push(outline);
    restoreNativeStrokeOutlineParent(outline,working,page);
    expect(outline.parent).toBe(parent);expect(outline.relativeTransform).toEqual([[1,0,-60.5],[0,1,-50.5]]);
    expect(outline.absoluteTransform).toEqual([[basis[0]![0],basis[0]![1],basis[0]![0]!* -60.5+basis[0]![1]!* -50.5+basis[0]![2]!],
      [basis[1]![0],basis[1]![1],basis[1]![0]!* -60.5+basis[1]![1]!* -50.5+basis[1]![2]!]]);
    expect(page.children).not.toContain(outline);expect(outline.width).toBe(301);expect(outline.height).toBe(181);
    restoreNativeStrokeOutlineParent(outline,working,page);expect(parent.children).toEqual([outline]);
  });
  it("refuses silent normalization instead of accepting a changed native stroke",()=>{
    const page:any={type:"PAGE"},parent:any={appendChild:(node:any)=>{node.parent=parent;}},working:any={parent};
    const outline:any={parent:page,width:301,height:181};let value=[[.9,.2,-60.5],[0,.9,-50.5]];
    Object.defineProperty(outline,"relativeTransform",{get:()=>value,set:(next)=>{value=[[1,next[0][1],next[0][2]],[0,1,next[1][2]]];}});
    expect(()=>restoreNativeStrokeOutlineParent(outline,working,page)).toThrow("preserve");
  });
});
