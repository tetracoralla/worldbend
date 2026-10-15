import {describe,expect,it} from "vitest";
import {isNativeVectorSourceView,resolvedNativeVectorSourceView} from "./native-vector-view";
import {nativeVectorSourceView,nativeVectorSourceViewMatches,retainedNativeVectorSourceView,sourceRasterViewBox} from "./source-raster";
describe("persisted full-appearance input window",()=>{
  it("keeps the original reported rectangle as a freshness witness while reopening the exact resolved domain",()=>{
    const reported={x:80000,y:20000,width:10,height:9.9999},source={absoluteRenderBounds:reported} as SceneNode;
    const old={policy:"appearance" as const,bounds:reported},resolved=resolvedNativeVectorSourceView(old,{...reported,height:10.000000001});
    expect(nativeVectorSourceViewMatches(source,resolved)).toBe(true);
    expect(retainedNativeVectorSourceView(source,resolved)).toEqual(old);
    expect(sourceRasterViewBox(source,false,resolved)).toEqual(reported);
    expect(resolvedNativeVectorSourceView(resolved,resolved.bounds)).toBe(resolved);
    reported.height=9.9998;expect(nativeVectorSourceViewMatches(source,resolved)).toBe(false);
    expect(retainedNativeVectorSourceView(source,resolved)).toEqual({policy:"appearance",bounds:reported});
  });
  it("rejects shrinking, logical corrections, malformed witnesses and overflowing rectangle endpoints",()=>{
    const view={policy:"appearance",bounds:{x:0,y:0,width:10,height:10},reportedBounds:{x:0,y:0,width:10,height:9.9999}};
    expect(isNativeVectorSourceView(view)).toBe(true);
    for(const invalid of [{...view,policy:"logical"},{...view,bounds:{...view.bounds,height:9}},
      {...view,reportedBounds:{...view.reportedBounds,extra:1}},{...view,bounds:{x:Number.MAX_VALUE,y:0,width:Number.MAX_VALUE,height:10}},
      {...view,reportedBounds:{...view.reportedBounds,height:0}}])expect(isNativeVectorSourceView(invalid)).toBe(false);
  });
  it("refreshes an automatic source window like a fresh capture, while preserving explicit and legacy logical policy",()=>{
    const source={type:"FRAME",width:120,height:80,relativeTransform:[[1,0,0],[0,1,0]],absoluteTransform:[[1,0,0],[0,1,0]],
      absoluteBoundingBox:{x:0,y:0,width:120,height:80},absoluteRenderBounds:{x:0,y:0,width:120,height:80},fills:[],strokes:[],effects:[],
      opacity:1,blendMode:"NORMAL",clipsContent:true,children:[]} as unknown as SceneNode;
    const auto=nativeVectorSourceView(source),explicit=nativeVectorSourceView(source,"logical"),legacy={policy:"logical" as const,bounds:{...source.absoluteBoundingBox!}};
    expect(auto).toMatchObject({policy:"logical",selection:"automatic"});
    Object.assign(source,{strokes:[{type:"SOLID",color:{r:1,g:0,b:0}}],strokeWeight:8,strokeAlign:"OUTSIDE",
      absoluteRenderBounds:{x:-8,y:-8,width:136,height:96}});
    expect(nativeVectorSourceViewMatches(source,auto)).toBe(false);
    expect(retainedNativeVectorSourceView(source,auto)).toEqual(nativeVectorSourceView(source));
    expect(retainedNativeVectorSourceView(source,auto)).toMatchObject({policy:"appearance",selection:"automatic"});
    expect(retainedNativeVectorSourceView(source,explicit)).toEqual(explicit);expect(retainedNativeVectorSourceView(source,legacy)).toEqual(legacy);
    expect(isNativeVectorSourceView({...auto,selection:"invented"})).toBe(false);
  });
  it("never promotes a stale derived enclosure into a fixed crop, even with unchanged getters and explicit policy",()=>{
    const reported={x:87000,y:18000,width:100,height:80},source={absoluteRenderBounds:reported} as SceneNode;
    for(const selection of [undefined,"automatic","explicit"] as const){
      const stale={policy:"appearance" as const,...(selection?{selection}:{}),reportedBounds:reported,bounds:{x:-60.5,y:-50.5,width:87300.5,height:18180.5}};
      expect(nativeVectorSourceViewMatches(source,stale)).toBe(true);
      const current=retainedNativeVectorSourceView(source,stale);
      expect(current.bounds).toEqual(reported);expect(current.selection).toBe(selection);expect(current).not.toHaveProperty("reportedBounds");
      expect(resolvedNativeVectorSourceView(current,current.bounds)).toBe(current);
    }
  });
});
