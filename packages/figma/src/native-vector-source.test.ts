import {appendNativeTestChild,installNativeTestBasis} from "./native-capture-test-host";
import { describe, expect, it, vi } from "vitest";
import { canCaptureNativeVectorSource, captureNativeVectorSource, nativeVectorArtworkFingerprint } from "./native-vector-source";
import { buildNativeVectorProjectionInput } from "./native-vector";
import { planVectorProjection } from "@worldbend/web";

function fixture() {
  const paint = { type: "SOLID", color: { r: .1, g: .6, b: .5 } };
  const network = { vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }],
    segments: [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }, { start: 3, end: 0 }],
    regions: [{ windingRule: "NONZERO", loops: [[0, 1, 2, 3]], fills: [paint] }] };
  const children: any[] = [];
  let nextId = 1;
  const page:any = {type:"PAGE", children, appendChild:vi.fn((value:any)=>appendNativeTestChild(page,value))};
  const source: any = { type: "RECTANGLE", name: "Native card", visible: true, removed: false,
    width: 100, height: 50, opacity: .6, blendMode: "MULTIPLY", effects: [], isMask: false,
    fills: [paint], strokes: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: .2 }],
    strokeWeight: 2, strokeAlign: "INSIDE", strokeCap: "NONE", strokeJoin: "MITER", strokeMiterLimit: 4, dashPattern: [],
    topLeftRadius: 10, topRightRadius: 20, bottomRightRadius: 30, bottomLeftRadius: 5, cornerSmoothing: .4,
    absoluteBoundingBox: { x: 300, y: 400, width: 100, height: 50 },
    absoluteTransform: [[1, 0, 300], [0, -1, 450]],
    clone: vi.fn(() => { throw Error("must not clone the auto-layout source"); }),
  };
  installNativeTestBasis(source);
  function node(type = "VECTOR"): any {
    const value: any = { id: `temp-${nextId++}`, type, removed: false, width: 100, height: 50,
      visible: true, opacity: 1, blendMode: "NORMAL", effects: [], isMask: false, fills: [paint], strokes: [],
      strokeWeight: 2, strokeAlign: "INSIDE", strokeCap: "NONE", strokeJoin: "MITER", strokeMiterLimit: 4, dashPattern: [],
      vectorNetwork: structuredClone(network), absoluteBoundingBox: source.absoluteBoundingBox,
      absoluteTransform: [[1, 0, 300], [0, 1, 400]],
      resize: vi.fn((width, height) => { value.width = width; value.height = height; }),
      setVectorNetworkAsync: vi.fn(async (geometry: VectorNetwork) => { value.vectorNetwork = geometry; }),
      outlineStroke: vi.fn(() => { const out = node(); out.fills = structuredClone(source.strokes);
        out.vectorNetwork.regions[0].fills = structuredClone(source.strokes); return out; }),
      remove() { value.removed = true;const siblings=value.parent?.children,index=siblings?.indexOf(value);if(index>=0)siblings.splice(index,1); },
    };
    children.push(value);value.parent=page; return installNativeTestBasis(value);
  }
  const host: any = { currentPage: page,createFrame:vi.fn(()=>{const f=node("FRAME");f.children=[];return installNativeTestBasis(f);}),
    createRectangle: vi.fn(() => node("RECTANGLE")), createEllipse: vi.fn(() => node("ELLIPSE")),
    createPolygon: vi.fn(() => node("POLYGON")), createStar: vi.fn(() => node("STAR")), createVector: vi.fn(() => node()),
    flatten: vi.fn((nodes: any[]) => {
      const fills = nodes.flatMap(n => Array.isArray(n.fills) ? [n.fills] : n.vectorNetwork.regions.map((r: any) => r.fills));
      for (const n of nodes) n.remove();
      const result = node();
      result.fills = Symbol("mixed");
      result.vectorNetwork.regions = fills.map((paints: any[]) => ({ windingRule: "NONZERO", loops: [[0, 1, 2, 3]], fills: paints }));
      return result;
    }),
  };
  source.clone.mockImplementation(()=>{const copy=node(source.type);copy.vectorNetwork=structuredClone(source.vectorNetwork??network);
    copy.strokeCap=source.strokeCap;copy.strokeJoin=source.strokeJoin;copy.dashPattern=structuredClone(source.dashPattern);return copy;});
  return { source, host, page, children, network };
}

describe("native artwork vector capture", () => {
  it.each(["inside","crossing"])("does not bypass an external clip for a directly supported Vector (%s)",async(place)=>{
    const h=fixture();h.source.id="selected";h.source.type="VECTOR";h.source.vectorNetwork=structuredClone(h.network);h.source.strokes=[];
    const clip:any=installNativeTestBasis({id:"external-clip",type:"FRAME",parent:h.page,relativeTransform:[[1,0,0],[0,1,0]],width:place==="inside"?500:350,height:500,
      clipsContent:true,children:[h.source],topLeftRadius:0,topRightRadius:0,bottomLeftRadius:0,bottomRightRadius:0,cornerSmoothing:0});
    h.source.parent=clip;
    h.host.intersect=vi.fn(()=>{const boolean=h.host.createVector();boolean.type="BOOLEAN_OPERATION";boolean.fillGeometry=[{data:"host contour"}];return boolean;});
    const before=nativeVectorArtworkFingerprint(h.source);
    const geometry=await captureNativeVectorSource(h.source,h.host,()=>{});
    expect(geometry).toBeDefined();expect(h.host.flatten).toHaveBeenCalled();
    expect(h.host.intersect).toHaveBeenCalledTimes(place==="inside"?0:1);
    expect(nativeVectorArtworkFingerprint(h.source)).toBe(before);expect(clip.children).toEqual([h.source]);expect(h.children).toEqual([]);
  });
  it("freezes resolved bound colors before page-level native flattening", async () => {
    const h = fixture(), color = { r: .05, g: .2, b: .8 };
    h.source.fills = [{ type: "SOLID", color, opacity: .7,
      boundVariables: { color: { type: "VARIABLE_ALIAS", id: "color" } } }];
    h.source.strokes = [];
    const before = structuredClone(h.source.fills), flatten = h.host.flatten.getMockImplementation()!;
    // Like the real host, an alias on a page-level temporary resolves in the
    // page's default mode rather than its source parent's selected mode.
    h.host.flatten.mockImplementation((nodes: any[]) => {
      for (const n of nodes) n.fills = n.fills.map((p: any) => p.boundVariables ? { ...p, color: { r: .8, g: .1, b: .05 } } : p);
      return flatten(nodes);
    });
    const geometry = await captureNativeVectorSource(h.source, h.host, () => {});
    expect(geometry!.vectorNetwork.regions![0]!.fills).toEqual([{ type: "SOLID", color, opacity: .7 }]);
    expect(h.source.fills).toEqual(before); expect(h.children).toEqual([]);
  });

  it("freezes direct Vector region paints and expandable strokes without changing source bindings", async () => {
    const h = fixture(), bound = { type: "SOLID", color: { r: .1, g: .6, b: .5 },
      boundVariables: { color: { type: "VARIABLE_ALIAS", id: "color" } } };
    h.source.type = "VECTOR"; h.source.vectorNetwork = structuredClone(h.network);
    h.source.vectorNetwork.regions[0].fills = [bound]; h.source.vectorNetwork.regions[0].fillStyleId = "style";
    h.source.fills = [bound]; h.source.strokes = [bound]; h.source.strokeAlign = "CENTER";
    h.source.absoluteTransform = [[1, 0, 300], [0, 1, 400]];
    const before = JSON.stringify(h.source.vectorNetwork);
    const geometry = await captureNativeVectorSource(h.source, h.host, () => {});
    expect(Array.isArray(geometry!.fills) && geometry!.fills[0]).not.toHaveProperty("boundVariables");
    expect(geometry!.strokes[0]).not.toHaveProperty("boundVariables");
    expect(geometry!.vectorNetwork.regions![0]).not.toHaveProperty("fillStyleId");
    expect(geometry!.vectorNetwork.regions![0]!.fills![0]).not.toHaveProperty("boundVariables");
    expect(JSON.stringify(h.source.vectorNetwork)).toBe(before); expect(h.host.flatten).not.toHaveBeenCalled();
  });
  it("decides primitive and rounded-vector availability without temporary document writes", () => {
    const h = fixture(); const before = JSON.stringify(h.source);
    expect(canCaptureNativeVectorSource(h.source)).toBe(true);
    expect(JSON.stringify(h.source)).toBe(before);
    h.source.type = "VECTOR"; h.source.vectorNetwork = structuredClone(h.network);
    h.source.vectorNetwork.vertices[0].cornerRadius = 12;
    expect(canCaptureNativeVectorSource(h.source)).toBe(true);
    expect(h.children).toEqual([]); expect(h.host.createVector).not.toHaveBeenCalled();
    expect(h.host.flatten).not.toHaveBeenCalled();
  });
  it("uses native independent rounding/inside outlining, retains paints and projects detached data through the core", async () => {
    const h = fixture(); const before = nativeVectorArtworkFingerprint(h.source);
    const observed: any[] = [];
    const geometry = await captureNativeVectorSource(h.source, h.host, node => observed.push(node));
    expect(geometry).toMatchObject({ nativeStrokeOutlined: true, opacity: .6, blendMode: "MULTIPLY",
      fills: [], strokes: [], absoluteBoundingBox: h.source.absoluteBoundingBox });
    expect(geometry!.vectorNetwork.regions?.map(region => region.fills)).toEqual([h.source.fills, h.source.strokes]);
    expect(h.host.createRectangle.mock.results[0]!.value).toMatchObject({
      topLeftRadius: 10, topRightRadius: 20, bottomRightRadius: 30, bottomLeftRadius: 5,
      cornerSmoothing: .4, relativeTransform: h.source.absoluteTransform, opacity: 1, blendMode: "NORMAL" });
    expect(h.source.clone).not.toHaveBeenCalled();
    expect(nativeVectorArtworkFingerprint(h.source)).toBe(before);
    expect(h.children).toEqual([]); expect(observed).toHaveLength(5);
    expect(observed.every(node => node.removed)).toBe(true);
    const projected = await planVectorProjection(buildNativeVectorProjectionInput({ source: geometry!,
      matrix: [100, 0, 0, 0, 50, 0, 0, 0, 1], reference: { width: 100, height: 50 }, placement: { width: 100, height: 50 } }));
    expect(projected.network.regions).toHaveLength(2);
    expect(projected.bounds).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });

  it.each(["ELLIPSE", "POLYGON", "STAR"])("passes %s's native shape settings without inventing its geometry", async type => {
    const h = fixture(); h.source.type = type; h.source.strokes = [];
    h.source.arcData = { startingAngle: 0, endingAngle: Math.PI, innerRadius: .4 };
    h.source.pointCount = 7; h.source.innerRadius = .65; h.source.cornerRadius = 6;
    await captureNativeVectorSource(h.source, h.host, () => {});
    const create = h.host[type === "ELLIPSE" ? "createEllipse" : type === "POLYGON" ? "createPolygon" : "createStar"];
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.results[0].value).toMatchObject(type === "ELLIPSE" ? { arcData: h.source.arcData }
      : type === "STAR" ? { pointCount: 7, innerRadius: .65, cornerRadius: 6 } : { pointCount: 7, cornerRadius: 6 });
    expect(h.children).toEqual([]);
  });

  it.each(["gradient", "effect", "mask", "complexity"])("keeps %s on the image route without temporary nodes", async condition => {
    const h = fixture();
    if (condition === "gradient") h.source.fills = [{ type: "GRADIENT_LINEAR" }];
    if (condition === "effect") h.source.effects = [{ type: "DROP_SHADOW" }];
    if (condition === "mask") h.source.isMask = true;
    if (condition === "complexity") { h.source.type = "POLYGON"; h.source.pointCount = 8193; }
    expect(await captureNativeVectorSource(h.source, h.host, () => {})).toBeUndefined();
    expect(h.children).toEqual([]); expect(h.host.flatten).not.toHaveBeenCalled();
  });

  it.each(["outside", "dash", "multiple strokes", "per-side"])("natively outlines %s instead of rejecting standalone selection", async condition => {
    const h = fixture();
    if (condition === "outside") h.source.strokeAlign = "OUTSIDE";
    if (condition === "dash") h.source.dashPattern = [12, 6];
    if (condition === "multiple strokes") h.source.strokes.push({ type: "SOLID", color: { r: 0, g: 0, b: 0 } });
    if (condition === "per-side") {
      Object.assign(h.source, { strokeWeight: Symbol("mixed"), strokeTopWeight: 2, strokeRightWeight: 5, strokeBottomWeight: 9, strokeLeftWeight: 12 });
      h.host.createRectangle.mockImplementationOnce(() => {
        const temp = h.host.createEllipse(); temp.type = "RECTANGLE";
        Object.assign(temp, { strokeTopWeight: 0, strokeRightWeight: 0, strokeBottomWeight: 0, strokeLeftWeight: 0 }); return temp;
      });
    }
    const before = nativeVectorArtworkFingerprint(h.source);
    expect(canCaptureNativeVectorSource(h.source)).toBe(true);
    const geometry = await captureNativeVectorSource(h.source, h.host, () => {});
    expect(geometry).toMatchObject({ nativeStrokeOutlined: true, strokes: [], opacity: .6 });
    expect(geometry!.vectorNetwork.regions!.at(-1)!.fills).toEqual(h.source.strokes);
    const temp = h.host.createRectangle.mock.results[0]!.value;
    expect(temp.dashPattern).toEqual(h.source.dashPattern);
    if (condition === "per-side") expect(temp).toMatchObject({ strokeTopWeight: 2, strokeRightWeight: 5, strokeBottomWeight: 9, strokeLeftWeight: 12 });
    expect(nativeVectorArtworkFingerprint(h.source)).toBe(before);
    expect(h.children).toEqual([]);
  });

  it("cleans up after outline/flatten failure and never falls back to source mutation", async () => {
    const h = fixture(); h.host.flatten.mockImplementationOnce(() => { throw Error("native conversion failed"); });
    await expect(captureNativeVectorSource(h.source, h.host, () => {})).rejects.toThrow("native conversion failed");
    expect(h.children).toEqual([]); expect(h.source.clone).not.toHaveBeenCalled();
  });

  it.each(["source", "page"])("rejects %s drift during rounded-vector preparation and removes its capture", async condition => {
    const h = fixture(); h.source.type = "VECTOR"; h.source.vectorNetwork = structuredClone(h.network);
    h.source.vectorNetwork.vertices[0].cornerRadius = 12;
    const flatten=h.host.flatten.getMockImplementation()!;
    h.host.flatten.mockImplementationOnce((nodes:any[])=>{const result=flatten(nodes);
      if(condition==="source")h.source.opacity=.4;else h.host.currentPage={};return result;});
    await expect(captureNativeVectorSource(h.source, h.host, () => {})).rejects.toThrow("source changed");
    expect(h.children).toEqual([]);expect(h.source.removed).toBe(false);
  });

  it("detects native parameter edits even when the bounds and paints are unchanged", () => {
    const h = fixture(); const before = nativeVectorArtworkFingerprint(h.source);
    h.source.cornerSmoothing = .6;
    expect(nativeVectorArtworkFingerprint(h.source)).not.toBe(before);
  });

  it("retains rounded fills without assigning mixed or unused stroke settings", async () => {
    const h = fixture(); h.source.type = "VECTOR"; h.source.vectorNetwork = structuredClone(h.network);
    h.source.vectorNetwork.vertices[0].cornerRadius = 12; h.source.strokes = [];
    h.source.strokeCap = Symbol("mixed"); h.source.strokeJoin = Symbol("mixed"); h.source.dashPattern = [4, 4];
    expect(await captureNativeVectorSource(h.source, h.host, () => {})).toBeDefined();
    const clone=h.source.clone.mock.results[0]!.value;
    expect(clone.strokeCap).toBe(h.source.strokeCap);expect(clone.strokeJoin).toBe(h.source.strokeJoin);
    expect(clone.setVectorNetworkAsync).not.toHaveBeenCalled();
    expect(h.children).toEqual([]);
  });
});
