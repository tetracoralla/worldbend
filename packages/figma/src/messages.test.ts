import { describe, expect, it } from "vitest";
import { isUiToMainMessage } from "./messages";

const projectionOutput = {
  network: {
    vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }],
    segments: [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }, { start: 3, end: 0 }],
    regions: [{ windingRule: "NONZERO", loops: [[0, 1, 2, 3]] }],
  },
  bounds: { x: 0, y: 0, width: 100, height: 50 },
  report: {
    fidelity: "exact", strokeOutlined: false, tolerancePx: 0.25, reasons: [],
    inputVertices: 4, inputSegments: 4, inputRegions: 1,
    outputVertices: 4, outputSegments: 4, outputRegions: 1, maxSubdivisionDepth: 0,
  },
};

function nativeVectorPayload(overrides: Record<string, unknown> = {}): unknown {
  return {
    generation: 1,
    spec: {
      schema: "worldbend.transform",
      version: "0.1",
      destination: { space: "normalized", quad: {
        tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 },
      } },
      content: { fit: "stretch" },
    },
    matrix: [100, 0, 0, 0, 50, 0, 0, 0, 1],
    sourceNodeId: "source",
    renderWidth: 100,
    renderHeight: 50,
    placement: { x: 0, y: 0, width: 100, height: 50 },
    ...overrides,
  };
}

function nativeVectorMessage(overrides: Record<string, unknown> = {}): unknown {
  return {
    type: "apply-native-vector",
    payload: nativeVectorPayload({
      projection: { outputs: [projectionOutput], sourceFingerprint: "source32x2:123:0123456789abcdef" },
      ...overrides,
    }),
  };
}

describe("Figma scene context messages", () => {
  it("allows a read-only published scene capture only without a canvas draft", () => {
    const request = { type: "request-scene-context", generation: 1, requestId: 2, bytes: new Uint8Array([7]), showCanvas: false };
    expect(isUiToMainMessage(request)).toBe(true);
    expect(isUiToMainMessage({ ...request, readPublished: true })).toBe(true);
    expect(isUiToMainMessage({ ...request, readPublished: false })).toBe(false);
    expect(isUiToMainMessage({ ...request, showCanvas: true, readPublished: true })).toBe(false);
  });
});

describe("Figma native Vector messages", () => {
  it("correlates prepared batch vectors without admitting a duplicate or a different target",()=>{
    const base=nativeVectorPayload() as Record<string,any>;
    const payload=nativeVectorPayload({batchResultId:"result",batchRunId:1,targetNodeId:"result",operation:{kind:"transform",spec:base.spec},sourceNodeIds:["source"]});
    const request=(extra={})=>({type:"request-native-vector-projection",payload:{...(payload as object),...extra}});
    expect(isUiToMainMessage(request())).toBe(true);
    expect(isUiToMainMessage(request({batchRunId:undefined}))).toBe(false);
    expect(isUiToMainMessage(request({batchRunId:0}))).toBe(false);
    expect(isUiToMainMessage(request({duplicate:true}))).toBe(false);
    expect(isUiToMainMessage(request({targetNodeId:"another"}))).toBe(false);
    expect(isUiToMainMessage(request({operation:undefined}))).toBe(false);
  });

  it("rejects extended tangent data before it can cross the UI/main publication boundary",()=>{
    const output=structuredClone(projectionOutput);
    Object.assign(output.network.segments[0]!,{tangentStart:{x:0,y:0}});
    const relay=()=>nativeVectorMessage({projection:{outputs:[output],sourceFingerprint:"source32x2:123:0123456789abcdef"}});
    expect(isUiToMainMessage(relay())).toBe(true);
    Object.assign(output.network.segments[0]!,{tangentStart:{x:0,y:0,extra:"汉"}});
    expect(isUiToMainMessage(relay())).toBe(false);
  });
  it("accepts one canonical core-solved forward projection and its request form", () => {
    expect(isUiToMainMessage(nativeVectorMessage())).toBe(true);
    expect(isUiToMainMessage(nativeVectorMessage({ targetNodeId: "result", duplicate: true }))).toBe(true);
    expect(isUiToMainMessage({
      type: "request-native-vector-projection",
      payload: nativeVectorPayload({ targetNodeId: "result" }),
    })).toBe(true);
  });

  it("admits canonical Warp while rejecting unknown fields and invalid matrices", () => {
    expect(isUiToMainMessage(nativeVectorMessage({ extra: true }))).toBe(false);
    const message = nativeVectorMessage() as { payload: Record<string, any> };
    expect(isUiToMainMessage(nativeVectorMessage({
      spec: { ...message.payload["spec"], content: { fit: "stretch", warp: { preset: "arc", amount: .5 } } },
    }))).toBe(true);
    expect(isUiToMainMessage(nativeVectorMessage({ matrix: [1, 0, 0] }))).toBe(false);
    expect(isUiToMainMessage(nativeVectorMessage({ matrix: [1, 0, 0, 0, 1, 0, 0, 0, Number.NaN] }))).toBe(false);
  });

  it("rejects a relayed projection that is missing, unfingerprinted, or malformed", () => {
    const payload = () => (nativeVectorMessage() as { payload: Record<string, any> }).payload;
    expect(isUiToMainMessage({ type: "apply-native-vector", payload: nativeVectorPayload() })).toBe(false);
    expect(isUiToMainMessage(nativeVectorMessage({
      projection: { outputs: payload().projection["outputs"], sourceFingerprint: "not-a-fingerprint" },
    }))).toBe(false);
    expect(isUiToMainMessage(nativeVectorMessage({
      projection: { outputs: [{ ...projectionOutput, network: { ...projectionOutput.network, vertices: [] } }],
        sourceFingerprint: "source32x2:123:0123456789abcdef" },
    }))).toBe(false);
    expect(isUiToMainMessage(nativeVectorMessage({
      projection: { outputs: [{ ...projectionOutput, report: { ...projectionOutput.report, fidelity: "wrong" } }],
        sourceFingerprint: "source32x2:123:0123456789abcdef" },
    }))).toBe(false);
  });
});

describe("Figma native Motion context messages",()=>{
  it("accepts only one bounded correlated context refresh",()=>{
    expect(isUiToMainMessage({type:"request-native-motion-context",generation:1,targetNodeId:"result"})).toBe(true);
    expect(isUiToMainMessage({type:"request-native-motion-context",generation:0,targetNodeId:"result"})).toBe(false);
    expect(isUiToMainMessage({type:"request-native-motion-context",generation:1,targetNodeId:""})).toBe(false);
    expect(isUiToMainMessage({type:"request-native-motion-context",generation:1,targetNodeId:"result",extra:true})).toBe(false);
  });
});

describe("Figma raster apply fallback marker", () => {
  const apply = (overrides: Record<string, unknown>) => ({
    type: "apply",
    payload: {
      generation: 1,
      bytes: new Uint8Array([1]),
      spec: {
        schema: "worldbend.transform",
        version: "0.1",
        destination: { space: "normalized", quad: {
          tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 },
        } },
        content: { fit: "stretch" },
      },
      sourceNodeId: "source",
      renderWidth: 100,
      renderHeight: 80,
      placement: { x: 0, y: 0, width: 100, height: 80 },
      ...overrides,
    },
  });

  it("accepts the boolean marker and rejects unknown or mistyped shapes", () => {
    expect(isUiToMainMessage(apply({ nativeVectorFallback: true }))).toBe(true);
    expect(isUiToMainMessage(apply({ nativeVectorFallback: "yes" }))).toBe(false);
  });
});

function canvasMessage(overrides: Record<string, unknown> = {}): unknown {
  const operation = {
    kind: "contain",
    output: { width: 1200, height: 628 },
    anchor: { x: 0.5, y: 0.5 },
    background: { kind: "transparent" },
  };
  return {
    type: "apply-canvas",
    payload: {
      generation: 1,
      sourceNodeId: "source",
      setSpec: {
        schema: "worldbend.canvas-set",
        version: "0.1",
        variants: [{ id: "wide", operation }],
      },
      outputs: [
        {
          id: "wide",
          bytes: new Uint8Array([1]),
          renderWidth: 1200,
          renderHeight: 628,
          placement: { x: 0, y: 0, width: 1200, height: 628 },
        },
      ],
      ...overrides,
    },
  };
}

describe("Figma Canvas messages", () => {
  it("accepts only the fixed native-effect listing action", () => {
    expect(isUiToMainMessage({ type: "open-native-effect-listing" })).toBe(true);
    expect(isUiToMainMessage({
      type: "open-native-effect-listing",
      url: "https://example.com",
    })).toBe(false);
  });

  it("accepts one closed ordered Canvas set", () => {
    expect(isUiToMainMessage(canvasMessage())).toBe(true);
  });

  it("rejects output/spec mismatch and a multi-result replacement", () => {
    expect(
      isUiToMainMessage(
        canvasMessage({
          outputs: [
            {
              id: "wrong",
              bytes: new Uint8Array([1]),
              renderWidth: 1200,
              renderHeight: 628,
              placement: { x: 0, y: 0, width: 1200, height: 628 },
            },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      isUiToMainMessage(
        canvasMessage({
          outputs: [
            {
              id: "wide",
              bytes: new Uint8Array([1]),
              renderWidth: 1200,
              renderHeight: 628,
              placement: { x: 0, y: 0, width: 300, height: 300 },
            },
          ],
        }),
      ),
    ).toBe(false);
    const base = canvasMessage() as { payload: Record<string, unknown> };
    const variants = (base.payload["setSpec"] as { variants: unknown[] }).variants;
    const outputs = base.payload["outputs"] as unknown[];
    expect(
      isUiToMainMessage(
        canvasMessage({ targetNodeId: "target", setSpec: {
          schema: "worldbend.canvas-set",
          version: "0.1",
          variants: [...variants, { ...(variants[0] as object), id: "square" }],
        }, outputs: [...outputs, { ...(outputs[0] as object), id: "square" }] }),
      ),
    ).toBe(false);
  });

  it("rejects the cumulative 32 Mi-pixel carrier limit before main-side mutation", () => {
    const operation = {
      kind: "cover",
      output: { width: 4096, height: 4096 },
      anchor: { x: 0.5, y: 0.5 },
      background: { kind: "transparent" },
    };
    const variants = ["one", "two", "three"].map((id) => ({ id, operation }));
    const outputs = variants.map(({ id }) => ({
      id,
      bytes: new Uint8Array([1]),
      renderWidth: 4096,
      renderHeight: 4096,
      placement: { x: 0, y: 0, width: 4096, height: 4096 },
    }));
    expect(
      isUiToMainMessage(canvasMessage({
        setSpec: { schema: "worldbend.canvas-set", version: "0.1", variants },
        outputs,
      })),
    ).toBe(false);
  });
});

describe("Figma template mutation messages", () => {
  it("requires a positive correlation id on save and delete", () => {
    expect(isUiToMainMessage({
      type: "delete-template",
      requestId: 1,
      id: "template-1",
    })).toBe(true);
    expect(isUiToMainMessage({
      type: "delete-template",
      id: "template-1",
    })).toBe(false);
    expect(isUiToMainMessage({
      type: "delete-template",
      requestId: 0,
      id: "template-1",
    })).toBe(false);
  });

  it("accepts a bounded canonical Sizes task template", () => {
    expect(isUiToMainMessage({
      type: "save-template",
      workspace: "canvas",
      requestId: 1,
      name: "Social",
      template: {
        schema: "worldbend.figma-task-template",
        version: "0.1",
        operation: {
          kind: "canvas",
          spec: {
            schema: "worldbend.canvas-set",
            version: "0.1",
            variants: [{
              id: "square",
              operation: {
                kind: "stretch",
                output: { width: 1080, height: 1080 },
              },
            }],
          },
        },
      },
    })).toBe(true);

    expect(isUiToMainMessage({
      type: "save-template",
      workspace: "mockup",
      requestId: 1,
      name: "Social",
      template: {
        schema: "worldbend.figma-task-template",
        version: "0.1",
        operation: {
          kind: "canvas",
          spec: {
            schema: "worldbend.canvas-set",
            version: "0.1",
            variants: [{
              id: "square",
              operation: {
                kind: "stretch",
                output: { width: 1080, height: 1080 },
              },
            }],
          },
        },
      },
    })).toBe(false);
  });
});
