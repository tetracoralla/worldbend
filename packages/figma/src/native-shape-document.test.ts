import { afterEach, describe, expect, it, vi } from "vitest";
import { captureDocumentShapeForSource } from "./native-shape-document";

function fixture() {
  const source: any = { type: "VECTOR", absoluteTransform: [[1, 0, 300], [0, -1, 460]],
    absoluteBoundingBox: { x: 300, y: 400, width: 80, height: 60 },
    vectorNetwork: { vertices: [{ x: 0, y: 0, cornerRadius: 12 }], segments: [] },
    vectorPaths: [{ windingRule: "EVENODD", data: "M 0 0 L 80 0 L 80 60 L 0 60 Z" }],
    fillGeometry: [{ windingRule: "EVENODD", data: "M 0 12 C 0 5.37258 5.37258 0 12 0 L 80 0 L 80 60 L 0 60 Z M 20 20 L 40 20 L 40 40 L 20 40 Z" },
      { windingRule: "NONZERO", data: "M 60 20 L 70 20 L 70 40 L 60 40 Z" }],
  };
  const forbidden = () => { throw Error("guide reads must preserve native redo"); };
  const host: any = { createVector: vi.fn(forbidden), flatten: vi.fn(forbidden) };
  vi.stubGlobal("figma", host);
  return { source, host };
}
afterEach(() => vi.unstubAllGlobals());

describe("native shape document read", () => {
  it("reads native corner curves, holes and independent winding regions without any document writes", async () => {
    const { source, host } = fixture(); const before = JSON.stringify(source);
    const shape = await captureDocumentShapeForSource(source);
    expect(shape?.contours).toHaveLength(3);
    expect(shape?.contours[0]?.segments[0]).toEqual({ kind: "cubic",
      c1: { x: 300, y: 454.62742 }, c2: { x: 305.37258, y: 460 }, to: { x: 312, y: 460 } });
    expect(shape?.regions).toEqual([{ contourIndices: [0, 1], fillRule: "evenOdd" },
      { contourIndices: [2], fillRule: "nonZero" }]);
    expect(shape?.bounds).toEqual(source.absoluteBoundingBox);
    expect(JSON.stringify(source)).toBe(before);
    expect(host.createVector).not.toHaveBeenCalled(); expect(host.flatten).not.toHaveBeenCalled();
  });

  it("retains original sharp-network precision and does not require resolved geometry", async () => {
    const { source } = fixture(); source.vectorNetwork.vertices[0].cornerRadius = 0;
    Object.defineProperty(source, "fillGeometry", { get: () => { throw Error("not needed"); } });
    const shape = await captureDocumentShapeForSource(source);
    expect(shape?.contours).toHaveLength(1); expect(shape?.contours[0]?.start).toEqual({ x: 300, y: 460 });
    expect(shape?.contours[0]?.segments.every(segment => segment.kind === "line")).toBe(true);
  });

  it.each(["absent", "unsupported", "open", "oversized"])("rejects %s resolved geometry without a write fallback", async condition => {
    const { source, host } = fixture();
    if (condition === "absent") source.fillGeometry = undefined;
    if (condition === "unsupported") source.fillGeometry[0].data = "M0 0 Q20 20 40 0 Z";
    if (condition === "open") source.fillGeometry[0].data = "M0 0 L80 0 L80 60";
    if (condition === "oversized") source.fillGeometry[0].data = `M0 0 ${"L1 1 ".repeat(513)}Z`;
    expect(await captureDocumentShapeForSource(source)).toBeUndefined();
    expect(host.createVector).not.toHaveBeenCalled(); expect(host.flatten).not.toHaveBeenCalled();
  });
});
