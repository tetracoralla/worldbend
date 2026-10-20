import {describe,it,expect} from "vitest";
import {surfaceLocalSize} from "./surface-local-size";

describe("local material surface dimensions",()=>{
  const element={offsetWidth:280,offsetHeight:420,getBoundingClientRect:()=>{throw Error("Projected bounds cannot define local material units");}} as unknown as HTMLElement;
  const style=(patch:Record<string,string>)=>({width:"279.398px",height:"420px",boxSizing:"border-box",...patch}) as unknown as CSSStyleDeclaration;
  it("retains fractional local border-box dimensions independently of screen transforms",()=>{
    expect(surfaceLocalSize(element,style({}))).toEqual({width:279.398,height:420});
  });
  it("includes actual padding and borders for content-box receivers",()=>{
    expect(surfaceLocalSize(element,style({boxSizing:"content-box",width:"240px",height:"340px",paddingLeft:"12px",paddingRight:"16px",paddingTop:"20px",paddingBottom:"24px",borderLeftWidth:"1.5px",borderRightWidth:"2.5px",borderTopWidth:"3px",borderBottomWidth:"4px"})))
      .toEqual({width:272,height:391});
  });
  it("falls back to local layout dimensions for automatic inline sizes and bounds hidden surfaces",()=>{
    expect(surfaceLocalSize(element,style({width:"auto",height:"auto"}))).toEqual({width:280,height:420});
    expect(surfaceLocalSize(element,style({width:"0px",height:"0px"}))).toEqual({width:1,height:1});
  });
});
