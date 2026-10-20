import { describe, expect, it } from "vitest";
import {
  buildNativeVectorProjectionInput,
  canUseNativeVectorSource,
  nativeVectorFingerprint,
  readNativeVectorProjection,
  serializeNativeVectorProjection,
} from "./native-vector";
import {compactNativeVectorGeometry} from "./native-vector-capture";
import { isValidVectorProjectionOutput,isValidVectorArtworkOutputs } from "./native-vector-guard";

const straightSegments = [
  { start: 0, end: 1, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
  { start: 1, end: 2, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
  { start: 2, end: 3, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
  { start: 3, end: 0, tangentStart: { x: 0, y: 0 }, tangentEnd: { x: 0, y: 0 } },
];

const curvedSegments = [
  { start: 0, end: 1, tangentStart: { x: 27, y: 0 }, tangentEnd: { x: 0, y: -27 } },
  { start: 1, end: 2, tangentStart: { x: 0, y: 27 }, tangentEnd: { x: 27, y: 0 } },
  { start: 2, end: 3, tangentStart: { x: -27, y: 0 }, tangentEnd: { x: 0, y: 27 } },
  { start: 3, end: 0, tangentStart: { x: 0, y: -27 }, tangentEnd: { x: -27, y: 0 } },
];

function vector(overrides: Record<string, unknown> = {}): VectorNode {
  return {
    id: "source", type: "VECTOR", name: "Card", width: 100, height: 50, x: 10, y: 20,
    visible: true, locked: false, opacity: 1, blendMode: "PASS_THROUGH", isMask: false,
    maskType: "ALPHA", effects: [], constraints: { horizontal: "MIN", vertical: "MIN" },
    fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }], strokes: [],
    strokeWeight: 2, strokeAlign: "CENTER", strokeCap: "NONE", strokeJoin: "MITER",
    strokeMiterLimit: 4, dashPattern: [],
    relativeTransform: [[1, 0, 10], [0, 1, 20]],
    absoluteBoundingBox: { x: 10, y: 20, width: 100, height: 50 },
    absoluteTransform: [[1, 0, 10], [0, 1, 20]],
    vectorNetwork: {
      vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }],
      segments: straightSegments,
      regions: [{ windingRule: "NONZERO", loops: [[0, 1, 2, 3]] }],
    },
    ...overrides,
  } as unknown as VectorNode;
}

describe("native Vector source eligibility", () => {
  it("accepts explicit differently painted regions but never invents missing mixed fills", () => {
    const source = vector();
    const regions = [{ ...source.vectorNetwork.regions![0]!, fills: source.fills as Paint[] },
      { ...source.vectorNetwork.regions![0]!, fills: [{ type: "SOLID", color: { r: 0, g: 1, b: 0 } }] }];
    expect(canUseNativeVectorSource(vector({ fills: Symbol("mixed"),
      vectorNetwork: { ...source.vectorNetwork, regions } }))).toBe(true);
    expect(canUseNativeVectorSource(vector({ fills: Symbol("mixed") }))).toBe(false);
  });

  it("keeps variable-width and brush semantics out of the uniform core stroke fast path", () => {
    const strokes = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }];
    expect(canUseNativeVectorSource(vector({ strokes, variableWidthStrokeProperties: { type: "CUSTOM" } }))).toBe(false);
    expect(canUseNativeVectorSource(vector({ strokes, complexStrokeProperties: { type: "BRUSH" } }))).toBe(false);
  });
  it("accepts straight and curved filled paths and rejects unsupported appearance", () => {
    expect(canUseNativeVectorSource(vector())).toBe(true);
    expect(canUseNativeVectorSource(vector({
      vectorNetwork: { ...vector().vectorNetwork, segments: curvedSegments },
    }))).toBe(true);
    expect(canUseNativeVectorSource(vector({ visible: false }))).toBe(false);
    expect(canUseNativeVectorSource(vector({ opacity: 0 }))).toBe(false);
    expect(canUseNativeVectorSource(vector({
      vectorNetwork: { ...vector().vectorNetwork,
        vertices: [{ x: 0, y: 0, cornerRadius: 4 }, ...vector().vectorNetwork.vertices.slice(1)] },
    }))).toBe(false);
    expect(canUseNativeVectorSource(vector({
      fills: [{ type: "GRADIENT_LINEAR", gradientHandlePositions: [], gradientStops: [] }],
    }))).toBe(false);
    expect(canUseNativeVectorSource(vector({ effects: [{ type: "DROP_SHADOW", visible: true }] }))).toBe(false);
    // The shared core rejects vertices that no segment references.
    expect(canUseNativeVectorSource(vector({
      vectorNetwork: { ...vector().vectorNetwork,
        vertices: [...vector().vectorNetwork.vertices, { x: 50, y: 10 }] },
    }))).toBe(false);
    // Figma's "NONE" winding rule is not representable in the shared core,
    // so it reports the HD route at selection time instead of failing later.
    expect(canUseNativeVectorSource(vector({
      vectorNetwork: { ...vector().vectorNetwork,
        regions: [{ windingRule: "NONE", loops: [[0, 1, 2, 3]] }] },
    }))).toBe(false);
  });

  it("accepts one solid center stroke and rejects unreliable stroke appearance", () => {
    const stroke = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }];
    expect(canUseNativeVectorSource(vector({ strokes: stroke }))).toBe(true);
    // This native appearance is representable, but its acute reversal is a
    // genuine Core fidelity refusal, not malformed geometry. The UI must
    // retain the disclosed HD fallback for this admitted source.
    expect(canUseNativeVectorSource(vector({strokes:stroke,strokeWeight:1,
      vectorNetwork:{vertices:[{x:0,y:0},{x:100,y:0},{x:.01,y:.001}],
        segments:[{start:0,end:1},{start:1,end:2},{start:2,end:0}],
        regions:[{windingRule:"NONZERO",loops:[[0,1,2]]}]}}))).toBe(true);
    expect(canUseNativeVectorSource(vector({
      strokes: [{ type: "GRADIENT_LINEAR", gradientHandlePositions: [], gradientStops: [] }],
    }))).toBe(false);
    expect(canUseNativeVectorSource(vector({ strokes: [...stroke, ...stroke] }))).toBe(false);
    expect(canUseNativeVectorSource(vector({ strokeAlign: "INSIDE", strokes: stroke }))).toBe(false);
    expect(canUseNativeVectorSource(vector({ strokeAlign: "OUTSIDE", strokes: stroke }))).toBe(false);
    expect(canUseNativeVectorSource(vector({ dashPattern: [4, 4], strokes: stroke }))).toBe(false);
    expect(canUseNativeVectorSource(vector({ strokeCap: "ROUND_ARROW", strokes: stroke }))).toBe(false);
    expect(canUseNativeVectorSource(vector({ strokeJoin: "mixed", strokes: stroke }))).toBe(false);
    expect(canUseNativeVectorSource(vector({ strokeWeight: 0, strokes: stroke }))).toBe(false);
    // A non-isometric absolute transform makes the uniform stroke width
    // ambiguous, so the stroke route falls back.
    expect(canUseNativeVectorSource(vector({
      strokes: stroke,
      absoluteTransform: [[2, 0, 10], [0, 1, 20]],
    }))).toBe(false);
    // Rotation keeps the stroke uniform and stays eligible.
    expect(canUseNativeVectorSource(vector({
      strokes: stroke,
      absoluteTransform: [[0, -1, 10], [1, 0, 20]],
    }))).toBe(true);
    // Without a visible stroke any affine transform remains fine.
    expect(canUseNativeVectorSource(vector({
      absoluteTransform: [[2, 0, 10], [0, 1, 20]],
    }))).toBe(true);
  });
});

describe("core projection input mapping", () => {
  it("maps the Figma vector network onto the shared core input", () => {
    const source = vector({
      vectorNetwork: {
        vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }],
        segments: curvedSegments,
        regions: [
          { windingRule: "EVENODD", loops: [[0, 1, 2, 3]], fills: [{ type: "SOLID", color: { r: 0, g: 1, b: 0 } }] },
        ],
      },
      strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
      strokeWeight: 3,
      strokeCap: "ROUND",
      strokeJoin: "BEVEL",
      strokeMiterLimit: 7,
    });
    const input = buildNativeVectorProjectionInput({
      source,
      matrix: [200, 0, 0, 0, 100, 0, 0, 0, 1],
      reference: { width: 200, height: 100 },
      placement: { width: 400, height: 200 },
    });
    expect(input.schema).toBe("worldbend.vector-projection");
    expect(input.sourceTransform).toEqual([1, 0, 10, 0, 1, 20]);
    expect(input.sourceBounds).toEqual({ x: 10, y: 20, width: 100, height: 50 });
    expect(input.homography).toEqual([200, 0, 0, 0, 100, 0, 0, 0, 1]);
    expect(input.reference).toEqual({ width: 200, height: 100 });
    expect(input.placement).toEqual({ width: 400, height: 200 });
    expect(input.path.segments[0]).toEqual({
      start: 0, end: 1, tangentStart: { x: 27, y: 0 }, tangentEnd: { x: 0, y: -27 },
    });
    expect(input.path.regions[0]?.windingRule).toBe("EVENODD");
    expect(input.stroke).toEqual({ weight: 3, cap: "ROUND", join: "BEVEL", miterLimit: 7 });
    expect(input.tolerancePx).toBeUndefined();
  });

  it("refuses ineligible sources and non-positive frame data", () => {
    const source = vector();
    expect(() => buildNativeVectorProjectionInput({
      source, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      reference: { width: 100, height: 0 }, placement: { width: 100, height: 100 },
    })).toThrow("Unsupported native vector source");
  });
});

describe("core output guard", () => {
  it("admits exact zero handles but rejects tangent extensions at the artwork byte boundary", () => {
    const valid = {
      network: { vertices: [{x:0,y:0},{x:1,y:0},{x:1,y:1}],
        segments: [{start:0,end:1,tangentStart:{x:0,y:0}},{start:1,end:2},{start:2,end:0}],
        regions: [{windingRule:"NONZERO",loops:[[0,1,2]]}] },
      bounds:{x:0,y:0,width:1,height:1},
      report:{fidelity:"exact",strokeOutlined:false,tolerancePx:.25,reasons:[],
        inputVertices:3,inputSegments:3,inputRegions:1,outputVertices:3,outputSegments:3,outputRegions:1,maxSubdivisionDepth:0},
    };
    expect(isValidVectorArtworkOutputs([valid])).toBe(true);
    for(const extra of ["small", "汉".repeat(3*1024*1024)]) {
      const extended=structuredClone(valid);
      Object.assign(extended.network.segments[0]!.tangentStart!,{extra});
      expect(JSON.stringify([extended]).length).toBeLessThan(8*1024*1024);
      if(extra.length>5)expect(new TextEncoder().encode(JSON.stringify([extended])).length).toBeGreaterThan(8*1024*1024);
      expect(isValidVectorProjectionOutput(extended)).toBe(false);
      expect(isValidVectorArtworkOutputs([extended])).toBe(false);
    }
  });
  it("accepts a representative projection and rejects malformed relays", () => {
    const valid = {
      network: {
        vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
        segments: [
          { start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 0 },
        ],
        regions: [{ windingRule: "NONZERO", loops: [[0, 1, 2]] }],
      },
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      report: {
        fidelity: "approximated", strokeOutlined: false, maxError: 0.2,
        tolerancePx: 0.25, reasons: ["curveSubdivision"],
        inputVertices: 3, inputSegments: 3, inputRegions: 1,
        outputVertices: 3, outputSegments: 3, outputRegions: 1,
        maxSubdivisionDepth: 2,
      },
    };
    expect(isValidVectorProjectionOutput(valid)).toBe(true);
    expect(isValidVectorProjectionOutput({ ...valid, report: { ...valid.report, fidelity: "wrong" } })).toBe(false);
    expect(isValidVectorProjectionOutput({ ...valid, network: { ...valid.network, segments: [{ start: 0, end: 9 }] } })).toBe(false);
    expect(isValidVectorProjectionOutput({ ...valid, report: { ...valid.report, maxError: -1 } })).toBe(false);
    expect(isValidVectorProjectionOutput({ ...valid, bounds: { x: 0, y: 0, width: 1 } })).toBe(false);
    expect(isValidVectorProjectionOutput({ ...valid, bounds: { x: 0, y: 0, width: 2, height: 1 } })).toBe(false);
    expect(isValidVectorProjectionOutput({ ...valid, report: { ...valid.report, outputVertices: 4 } })).toBe(false);
    expect(isValidVectorProjectionOutput({ ...valid, network: { ...valid.network,
      regions: [{ windingRule: "NONZERO", loops: [[0, 1, 1]] }] } })).toBe(false);
    expect(isValidVectorProjectionOutput({ ...valid, extra: true })).toBe(false);
    expect(isValidVectorProjectionOutput({ ...valid, network: { ...valid.network,
      regions: [{ windingRule: "NONZERO", loops: Array.from({ length: 174763 }, () => [0, 1, 2]) }] } })).toBe(false);
  });
});

describe("native Vector record integrity", () => {
  it("fingerprints visible geometry and rejects aliased or extended records", () => {
    const source = vector();
    const before = nativeVectorFingerprint(source);
    source.vectorNetwork = { ...source.vectorNetwork,
      vertices: [{ x: 1, y: 0 }, ...source.vectorNetwork.vertices.slice(1)] };
    expect(nativeVectorFingerprint(source)).not.toBe(before);

    const renamed = vector({ name: "Renamed output" });
    expect(nativeVectorFingerprint(renamed)).not.toBe(nativeVectorFingerprint(vector()));
    const masked = vector({ isMask: true });
    expect(nativeVectorFingerprint(masked)).not.toBe(nativeVectorFingerprint(vector()));

    const record = {
      schema: "worldbend.figma.native-vector", version: "0.1", resultNodeId: "result",
      contentNodeId: "content", sourceNodeId: "source", fingerprint: before,
      outputSize: { width: 100, height: 50 }, placement: { x: 0, y: 0, width: 100, height: 50 },
      operation: JSON.stringify({ schema: "worldbend.transform", version: "0.1" }),
    };
    const node = (value: unknown) => ({ id: "result", getSharedPluginData: () => JSON.stringify(value) });
    const normalized = {
      schema: "worldbend.figma.native-vector" as const, version: "0.1" as const, resultNodeId: "result",
      sourceNodeId: "source", outputSize: record.outputSize, placement: record.placement,
      operation: record.operation, fidelity: { class: "exact" as const, reasons: [] },
      parts: [{ contentNodeId: "content", fingerprint: before }],
    };
    // Legacy straight-path records read back as exact, normalized to one part.
    expect(readNativeVectorProjection(node(record))).toEqual(normalized);
    // Current records carry the core-reported fidelity.
    const withFidelity = { ...record, fidelity: { class: "outlined", reasons: ["strokeOutlined"] } };
    expect(readNativeVectorProjection(node(withFidelity))).toEqual({ ...normalized,
      fidelity: { class: "outlined", reasons: ["strokeOutlined"] } });
    const badFidelity = { ...record, fidelity: { class: "unknown", reasons: [] } };
    expect(readNativeVectorProjection(node(badFidelity))).toBeUndefined();
    expect(readNativeVectorProjection(node({ ...record,
      placement: { ...record.placement, width: 99 },
    }))).toBeUndefined();
    expect(readNativeVectorProjection(node({ ...record, sourceNodeId: "content" }))).toBeUndefined();
    expect(readNativeVectorProjection(node({ ...record, sourceNodeId: "result" }))).toBeUndefined();
    expect(readNativeVectorProjection(node({ ...record, extra: true }))).toBeUndefined();
  });

  it("reads multi-part 0.2 records, keeps versions writable in their own shape, and rejects bad parts", () => {
    const fingerprint = nativeVectorFingerprint(vector());
    const record = {
      schema: "worldbend.figma.native-vector", version: "0.2", resultNodeId: "result",
      sourceNodeId: "source", outputSize: { width: 100, height: 50 },
      placement: { x: 0, y: 0, width: 100, height: 50 },
      operation: JSON.stringify({ schema: "worldbend.transform", version: "0.1" }),
      fidelity: { class: "outlined", reasons: ["textOutlined"] },
      parts: [{ contentNodeId: "content-a", fingerprint }, { contentNodeId: "content-b", fingerprint }],
    };
    const node = (value: unknown) => ({ id: "result", getSharedPluginData: () => JSON.stringify(value) });
    const read = readNativeVectorProjection(node(record));
    expect(read).toEqual(record);
    if (!read) throw Error("unreachable");
    // 0.2 serialization round-trips; a 0.1 record stays single-content.
    expect(readNativeVectorProjection(node(JSON.parse(serializeNativeVectorProjection(read))))).toEqual(record);
    expect(JSON.parse(serializeNativeVectorProjection({ ...read, version: "0.1", parts: read.parts.slice(0, 1) })))
      .toMatchObject({ version: "0.1", contentNodeId: "content-a", fingerprint });
    expect(readNativeVectorProjection(node({ ...record, parts: [] }))).toBeUndefined();
    expect(readNativeVectorProjection(node({ ...record, sourceNodeId: "result" }))).toBeUndefined();
    expect(readNativeVectorProjection(node({ ...record, parts: [{ contentNodeId: "source", fingerprint }] }))).toBeUndefined();
    expect(readNativeVectorProjection(node({ ...record,
      parts: [{ contentNodeId: "content-a", fingerprint }, { contentNodeId: "content-a", fingerprint }] }))).toBeUndefined();
    expect(readNativeVectorProjection(node({ ...record,
      parts: [{ contentNodeId: "content-a", fingerprint: "vector32x2:1:nothex" }] }))).toBeUndefined();
    expect(readNativeVectorProjection(node({ ...record, version: "0.1" }))).toBeUndefined();
  });
});


describe("exact compact admitted capture",()=>{
  it("recognizes the current native uniform descriptor but rejects variable semantics",()=>{
    const source=vector({strokes:[{type:"SOLID",color:{r:0,g:0,b:0}}],variableWidthStrokeProperties:{widthProfile:"UNIFORM",variableWidthPoints:[]},complexStrokeProperties:{type:"BASIC"}});
    expect(canUseNativeVectorSource(source)).toBe(true);
    source.vectorNetwork={...source.vectorNetwork,vertices:source.vectorNetwork.vertices.map(v=>({...v,strokeJoin:"MITER",strokeCap:"NONE",cornerRadius:0}))};
    const compact=compactNativeVectorGeometry(source);
    expect(compact.vectorNetwork.vertices.every(v=>Object.keys(v).length===2)).toBe(true);
    expect(buildNativeVectorProjectionInput({source:compact,matrix:[100,0,0,0,50,0,0,0,1],reference:{width:100,height:50},placement:{width:100,height:50}}).path)
      .toEqual(buildNativeVectorProjectionInput({source,matrix:[100,0,0,0,50,0,0,0,1],reference:{width:100,height:50},placement:{width:100,height:50}}).path);
    for(const profile of [{widthProfile:"CUSTOM",variableWidthPoints:[]},{widthProfile:"UNIFORM",variableWidthPoints:[{position:.5,width:3}]},{widthProfile:"UNIFORM",variableWidthPoints:[],unknownAppearance:true}])
      expect(canUseNativeVectorSource(vector({...source,variableWidthStrokeProperties:profile}))).toBe(false);
    source.vectorNetwork={...source.vectorNetwork,vertices:source.vectorNetwork.vertices.map((v,i)=>(i===0?{...v,strokeJoin:"ROUND"}:v))};expect(canUseNativeVectorSource(source)).toBe(false);
    expect(()=>compactNativeVectorGeometry(source)).toThrow("Unsupported");
  });
  it("retains coordinate precision, zero handle presence, holes and resolved region paints",()=>{
    const source=vector(),n=source.vectorNetwork;
    const vertices=[...n.vertices,...n.vertices.map(v=>({...v,x:v.x*.1+.1234567890123456,y:v.y*.1+.9876543210987654}))];
    const segments=[...curvedSegments,...straightSegments.map(s=>({...s,start:s.start+4,end:s.end+4}))];
    const region={windingRule:"EVENODD" as const,loops:[[0,1,2,3],[4,5,6,7]],fills:[{type:"SOLID" as const,color:{r:.123456789,g:.3,b:.4}}]};
    const whole=vector({vectorNetwork:{vertices:vertices.map(v=>({...v,cornerRadius:0,strokeJoin:"MITER",strokeCap:"NONE"})),segments,regions:[region]}});
    const before=JSON.stringify(whole.vectorNetwork),compact=compactNativeVectorGeometry(whole);
    expect(compact.vectorNetwork.vertices).toEqual(vertices);expect(compact.vectorNetwork.segments).toEqual(segments);
    expect(compact.vectorNetwork.regions).toEqual([region]);expect(JSON.stringify(whole.vectorNetwork)).toBe(before);
    expect(JSON.stringify(compact.vectorNetwork).length).toBeLessThan(before.length);
  });
});
