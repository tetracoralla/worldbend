import { describe, expect, it } from "vitest";
import { classifySurfacePointer } from "./editor-gestures";
import { unitQuad, type Quad } from "./types";

describe("classifySurfacePointer", () => {
  const previewSize = { width: 200, height: 100 };

  it("classifies an inside pointer as move", () => {
    expect(
      classifySurfacePointer({ quad: unitQuad(), pointer: { x: 0.5, y: 0.5 }, previewSize }),
    ).toBe("move");
  });

  it("keeps the band just outside the outline inert", () => {
    // 4 display px above the top edge with an 8 px margin.
    expect(
      classifySurfacePointer({ quad: unitQuad(), pointer: { x: 0.5, y: -0.04 }, previewSize }),
    ).toBe("none");
  });

  it("classifies a pointer inside the bounded outer band as rotate", () => {
    expect(
      classifySurfacePointer({ quad: unitQuad(), pointer: { x: 0.5, y: -0.2 }, previewSize }),
    ).toBe("rotate");
    expect(
      classifySurfacePointer({ quad: unitQuad(), pointer: { x: 1.2, y: 0.5 }, previewSize }),
    ).toBe("rotate");
  });

  it("keeps far-away workspace inert instead of turning every blank click into rotation", () => {
    expect(
      classifySurfacePointer({ quad: unitQuad(), pointer: { x: 0.5, y: -1 }, previewSize }),
    ).toBe("none");
    expect(
      classifySurfacePointer({ quad: unitQuad(), pointer: { x: 1.5, y: 0.5 }, previewSize }),
    ).toBe("none");
  });

  it("measures the rotate band in display pixels on both axes", () => {
    // 0.05 of the 200 px width is 10 px, despite being only 5 px on the
    // preview's shorter normalized axis.
    expect(
      classifySurfacePointer({ quad: unitQuad(), pointer: { x: 1.05, y: 0.5 }, previewSize }),
    ).toBe("rotate");
  });

  it("handles a rotated quad's free corners as rotate zones", () => {
    const quad: Quad = {
      tl: { x: 0.25, y: 0 },
      tr: { x: 1, y: 0.25 },
      br: { x: 0.75, y: 1 },
      bl: { x: 0, y: 0.75 },
    };
    expect(
      classifySurfacePointer({ quad, pointer: { x: 0.02, y: 0.02 }, previewSize }),
    ).toBe("rotate");
    expect(classifySurfacePointer({ quad, pointer: { x: 0.5, y: 0.5 }, previewSize })).toBe(
      "move",
    );
  });

  it("returns none for a degenerate preview size", () => {
    expect(
      classifySurfacePointer({
        quad: unitQuad(),
        pointer: { x: 0.5, y: 0.5 },
        previewSize: { width: 0, height: 0 },
      }),
    ).toBe("none");
  });
});
