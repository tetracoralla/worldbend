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
  it("accepts the narrow human Contain/Cover projection", () => {
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
