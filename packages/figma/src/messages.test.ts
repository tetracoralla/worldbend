import { describe, expect, it } from "vitest";
import { isUiToMainMessage } from "./messages";

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
