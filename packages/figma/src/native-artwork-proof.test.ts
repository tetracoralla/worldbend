import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeArtworkProof } from "./native-artwork-proof";

function fixture() {
  const page: any = { id: "page", type: "PAGE", parent: null };
  const node: any = { id: "source", type: "STAR", parent: page, removed: false,
    width: 100, height: 100, x: 10, y: 20, visible: true, opacity: 1,
    absoluteTransform: [[1, 0, 10], [0, 1, 20]], absoluteBoundingBox: { x: 10, y: 20, width: 100, height: 100 },
    fills: [], strokes: [], effects: [], pointCount: 5, innerRadius: .3, strokeMiterLimit: 4,
    resolvedVariableModes: { colors: "cool" }, boundVariables: {},
    getSharedPluginData: () => "", getSharedPluginDataKeys: () => [],
  };
  const api = { currentPage: page, fileKey: "file" }; vi.stubGlobal("figma", api);
  return { page, node, api };
}
afterEach(() => vi.unstubAllGlobals());

describe("current native artwork proof", () => {
  it.each(["pointCount", "innerRadius", "strokeMiterLimit", "paragraphSpacing"])(
    "rejects %s changes even when bounds, paints and source identity stay unchanged", field => {
      const h = fixture(); h.node[field] = 4;
      const proof = nativeArtworkProof(h.node); h.node[field] = 6;
      expect(() => proof.validate()).toThrow("changed"); expect(h.node[field]).toBe(6);
    });
  it("protects inherited modes and every physical child without requiring an obsolete binding's source", () => {
    const h = fixture(); h.node.type = "FRAME";
    const child = { ...h.node, id: "child", type: "STAR", parent: h.node };
    h.node.children = [child];
    h.node.getSharedPluginDataKeys = () => ["binding"];
    h.node.getSharedPluginData = () => JSON.stringify({ sourceNodeIds: ["missing-old-source"] });
    const proof = nativeArtworkProof(h.node);
    expect([...proof.originals.keys()]).toEqual(["source", "child"]);
    expect(() => proof.validate()).not.toThrow();
    child.resolvedVariableModes = { colors: "warm" };
    expect(() => proof.validate()).toThrow("changed");
  });
  it("rejects an explicit-mode edit even when the currently resolved mode stays the same",()=>{
    const h=fixture();h.node.explicitVariableModes={};const proof=nativeArtworkProof(h.node);
    h.node.explicitVariableModes={colors:"cool"};
    expect(h.node.resolvedVariableModes).toEqual({colors:"cool"});
    expect(()=>proof.validate()).toThrow("changed");
  });
  it("rejects changed scope and oversized trees before native capture or publication", () => {
    const h = fixture(), proof = nativeArtworkProof(h.node); h.api.fileKey = "another";
    expect(() => proof.validate()).toThrow("scope changed"); h.api.fileKey = "file";
    let parent = h.node;
    for (let i = 0; i < 66; i++) {
      const child = { ...h.node, id: `nested-${i}`, parent, children: [] };
      parent.children = [child]; parent = child;
    }
    expect(() => nativeArtworkProof(h.node)).toThrow("64 levels");
  });
  it.each(["clipsContent","topLeftRadius","cornerSmoothing","width"])("protects external %s without acquiring unrelated ancestor artwork",field=>{
    const h=fixture(),parent:any={id:"external",type:"FRAME",parent:h.page,removed:false,clipsContent:true,width:100,height:80,
      absoluteTransform:[[1,0,0],[0,1,0]],topLeftRadius:0,topRightRadius:0,bottomLeftRadius:0,bottomRightRadius:0,cornerSmoothing:0,children:[h.node]};
    h.node.parent=parent;const proof=nativeArtworkProof(h.node);
    expect([...proof.originals.keys()]).toEqual(["source"]);
    parent[field]=field==="clipsContent"?false:30;
    expect(()=>proof.validate()).toThrow("changed");
    const fresh=nativeArtworkProof(h.node);expect(()=>fresh.validate()).not.toThrow();
    parent.children.push({id:"unrelated"});expect(()=>fresh.validate()).not.toThrow();
  });
});
