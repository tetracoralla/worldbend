import { describe, expect, it } from "vitest";
import {
  isOwnedCanvasSetSpec,
  isOwnedCanvasSpec,
  parseOwnedCanvasSpec,
  singleCanvasSpec,
} from "./stored-canvas";

const operation = {
  kind: "contain" as const,
  output: { width: 1200, height: 628 },
  anchor: { x: 0.5 as const, y: 0.5 as const },
  background: { kind: "transparent" as const },
};

describe("stored Canvas data", () => {
  it("accepts all six task-native Canvas operations", () => {
    const spec = singleCanvasSpec(operation);
    expect(isOwnedCanvasSpec(spec)).toBe(true);
    expect(parseOwnedCanvasSpec(JSON.stringify(spec))).toEqual(spec);
    expect(
      isOwnedCanvasSetSpec({
        schema: "worldbend.canvas-set",
        version: "0.1",
        variants: [
          { id: "wide", operation },
          { id: "square", operation: { ...operation, kind: "cover" } },
        ],
      }),
    ).toBe(true);
    for (const candidate of [
      { kind: "crop", rect: { x: 1, y: 2, width: 10, height: 12 } },
      { kind: "trim", alphaThreshold: 7 },
      { kind: "pad", insets: { top: 1, right: 2, bottom: 3, left: 4 }, background: { kind: "transparent" } },
      operation,
      { ...operation, kind: "cover" },
      { kind: "stretch", output: { width: 40, height: 30 } },
    ]) expect(isOwnedCanvasSpec(singleCanvasSpec(candidate as never))).toBe(true);
  });

  it("rejects open fields, duplicate IDs, non-grid anchors, and carrier overflow", () => {
    expect(isOwnedCanvasSpec({ ...singleCanvasSpec(operation), planner: true })).toBe(false);
    expect(
      isOwnedCanvasSetSpec({
        schema: "worldbend.canvas-set",
        version: "0.1",
        variants: [
          { id: "same", operation },
          { id: "same", operation },
        ],
      }),
    ).toBe(false);
    expect(
      isOwnedCanvasSpec(singleCanvasSpec({ ...operation, anchor: { x: 0.25 as never, y: 0.5 } })),
    ).toBe(false);
    expect(
      isOwnedCanvasSpec(singleCanvasSpec({ ...operation, output: { width: 4097, height: 1 } })),
    ).toBe(false);
  });
});
