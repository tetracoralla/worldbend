import { describe, expect, it } from "vitest";
import type { RectifySpecInput, TransformSpec } from "@worldbend/web/types";
import { isUiToMainMessage } from "./messages";
import {
  isOwnedRectifySpec,
  isOwnedTransformSpec,
  parseOwnedRectifySpec,
  parseOwnedTransformSpec,
} from "./stored-plane";

const spec: TransformSpec = {
  schema: "worldbend.transform",
  version: "0.1",
  destination: {
    space: "normalized",
    quad: {
      tl: { x: 0, y: 0 },
      tr: { x: 1, y: 0 },
      br: { x: 0.9, y: 1 },
      bl: { x: 0.1, y: 1 },
    },
  },
  content: { fit: "stretch" },
};

const rectification: RectifySpecInput = {
  schema: "worldbend.rectify",
  version: "0.1",
  source: {
    space: "normalized",
    quad: spec.destination.quad,
  },
  output: { width: 1440, height: 900 },
};

describe("shared Figma transform data", () => {
  it("round-trips the canonical TransformSpec directly", () => {
    expect(parseOwnedTransformSpec(JSON.stringify(spec))).toEqual(spec);
  });

  it("accepts finite normalized coordinates outside the reference rectangle", () => {
    const outward = {
      ...spec,
      destination: {
        ...spec.destination,
        quad: {
          tl: { x: -0.2, y: -0.1 },
          tr: { x: 1.2, y: 0 },
          br: { x: 1, y: 1.1 },
          bl: { x: 0, y: 1 },
        },
      },
    };
    expect(isOwnedTransformSpec(outward)).toBe(true);
    expect(parseOwnedTransformSpec(JSON.stringify(outward))).toEqual(outward);
    expect(
      isOwnedTransformSpec({
        ...outward,
        destination: {
          ...outward.destination,
          quad: { ...outward.destination.quad, tl: { x: Number.NaN, y: 0 } },
        },
      }),
    ).toBe(false);
  });

  it("rejects unknown fields and non-normalized editor specs", () => {
    expect(isOwnedTransformSpec({ ...spec, extra: true })).toBe(false);
    expect(
      isOwnedTransformSpec({
        ...spec,
        destination: { ...spec.destination, space: "pixel", reference: { width: 1, height: 1 } },
      }),
    ).toBe(false);
  });
});

describe("shared Figma rectification data", () => {
  it("round-trips one normalized source plane with explicit bounded output", () => {
    expect(parseOwnedRectifySpec(JSON.stringify(rectification))).toEqual(rectification);
    expect(isOwnedRectifySpec(rectification)).toBe(true);
  });

  it("rejects pixel source coordinates, missing output, and Figma-oversized output", () => {
    expect(
      isOwnedRectifySpec({
        ...rectification,
        source: {
          space: "pixel",
          reference: { width: 100, height: 100 },
          quad: rectification.source.quad,
        },
      }),
    ).toBe(false);
    expect(isOwnedRectifySpec({ ...rectification, output: undefined })).toBe(false);
    expect(
      isOwnedRectifySpec({ ...rectification, output: { width: 4097, height: 900 } }),
    ).toBe(false);
  });
});

describe("UI message guard", () => {
  const validApply = {
    type: "apply",
    payload: {
      generation: 3,
      bytes: new Uint8Array([137, 80, 78, 71]),
      spec,
      sourceNodeId: "1:2",
      renderWidth: 1440,
      renderHeight: 900,
      placement: { x: -20, y: 10, width: 720, height: 450 },
    },
  };

  it("accepts a bounded structurally owned apply request", () => {
    expect(isUiToMainMessage(validApply)).toBe(true);
    expect(
      isUiToMainMessage({
        ...validApply,
        payload: { ...validApply.payload, duplicate: true },
      }),
    ).toBe(true);
    expect(
      isUiToMainMessage({
        ...validApply,
        payload: {
          ...validApply.payload,
          spec: undefined,
          rectification,
        },
      }),
    ).toBe(true);
    expect(
      isUiToMainMessage({
        ...validApply,
        payload: { ...validApply.payload, rectification },
      }),
    ).toBe(false);
    expect(
      isUiToMainMessage({
        ...validApply,
        payload: { ...validApply.payload, duplicate: "yes" },
      }),
    ).toBe(false);
    expect(isUiToMainMessage({ type: "ready", systemLocales: ["zh-CN", "en-US"], sceneDraftSessionId: "test-session-00001" })).toBe(
      true,
    );
    expect(isUiToMainMessage({ type: "set-locale", preference: "system" })).toBe(true);
    expect(isUiToMainMessage({ type: "set-locale", preference: "zh-CN" })).toBe(true);
    expect(
      isUiToMainMessage({
        type: "request-source-raster",
        generation: 3,
        requestId: 7,
        sourceNodeId: "1:2",
        desiredWidth: 4096,
        desiredHeight: 2048,
      }),
    ).toBe(true);
    expect(
      isUiToMainMessage({
        ...validApply,
        payload: {
          ...validApply.payload,
          spec: {
            ...spec,
            destination: {
              ...spec.destination,
              quad: { ...spec.destination.quad, tr: { x: 1.2, y: -0.1 } },
            },
          },
        },
      }),
    ).toBe(true);
  });

  it("rejects stale-shaped, oversized, and unknown-field requests", () => {
    expect(
      isUiToMainMessage({
        ...validApply,
        payload: { ...validApply.payload, generation: 0 },
      }),
    ).toBe(false);
    expect(
      isUiToMainMessage({
        ...validApply,
        payload: { ...validApply.payload, renderWidth: 4097 },
      }),
    ).toBe(false);
    expect(
      isUiToMainMessage({
        ...validApply,
        payload: { ...validApply.payload, extra: true },
      }),
    ).toBe(false);
    expect(
      isUiToMainMessage({
        ...validApply,
        payload: {
          ...validApply.payload,
          placement: { ...validApply.payload.placement, width: 0 },
        },
      }),
    ).toBe(false);
    expect(isUiToMainMessage({ type: "ready" })).toBe(false);
    expect(isUiToMainMessage({ type: "ready", systemLocales: ["en-US"] })).toBe(false);
    expect(isUiToMainMessage({
      type: "ready",
      systemLocales: ["en-US"],
      sceneDraftSessionId: "short",
    })).toBe(false);
    expect(isUiToMainMessage({ type: "ready", systemLocales: [""], sceneDraftSessionId: "test-session-00001" })).toBe(false);
    expect(isUiToMainMessage({ type: "set-locale", preference: "fr" })).toBe(false);
    expect(
      isUiToMainMessage({
        type: "request-source-raster",
        generation: 3,
        requestId: 7,
        sourceNodeId: "1:2",
        desiredWidth: 4097,
        desiredHeight: 2048,
      }),
    ).toBe(false);
    expect(
      isUiToMainMessage({
        type: "request-source-raster",
        generation: 3,
        requestId: 7,
        sourceNodeId: "1:2",
        desiredWidth: 4096,
        desiredHeight: 2048,
        extra: true,
      }),
    ).toBe(false);
  });
});

describe("spec content orientation", () => {
  it("accepts explicit orientations and keeps rejecting unknown content fields", () => {
    const spec = {
      schema: "worldbend.transform",
      version: "0.1",
      destination: {
        space: "normalized",
        quad: {
          tl: { x: 0, y: 0 },
          tr: { x: 1, y: 0 },
          br: { x: 1, y: 1 },
          bl: { x: 0, y: 1 },
        },
      },
      content: { fit: "stretch", orientation: "flipHorizontal" },
    };
    expect(isOwnedTransformSpec(spec)).toBe(true);
    expect(
      isOwnedTransformSpec({ ...spec, content: { fit: "stretch", orientation: "flipBoth" } }),
    ).toBe(true);
    expect(
      isOwnedTransformSpec({ ...spec, content: { fit: "stretch", orientation: "mirror" } }),
    ).toBe(false);
  });
});

describe("bounded Warp content", () => {
  it("accepts the ten-preset shape and rejects custom or unbounded deformation", () => {
    expect(
      isOwnedTransformSpec({
        ...spec,
        content: { fit: "stretch", warp: { preset: "arc", amount: -1 } },
      }),
    ).toBe(true);
    expect(
      isOwnedTransformSpec({
        ...spec,
        content: {
          fit: "stretch",
          orientation: "flipBoth",
          warp: { preset: "twist", amount: 1 },
        },
      }),
    ).toBe(true);
    expect(
      isOwnedTransformSpec({
        ...spec,
        content: { fit: "stretch", warp: { preset: "custom", amount: 0.5 } },
      }),
    ).toBe(false);
    expect(
      isOwnedTransformSpec({
        ...spec,
        content: { fit: "stretch", warp: { preset: "wave", amount: 1.01 } },
      }),
    ).toBe(false);
  });
});
