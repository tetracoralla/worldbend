import { describe, expect, it, vi } from "vitest";
import { CanvasRasterRenderer } from "./canvas-renderer";
import type { CanvasPlan } from "./canvas-types";

function plan(): CanvasPlan {
  return {
    schema: "worldbend.canvas-plan",
    version: "0.1",
    sourceSize: { width: 800, height: 400 },
    sourceRect: { x: 0, y: 0, width: 800, height: 400 },
    outputSize: { width: 300, height: 300 },
    placement: { x: 0, y: 75, width: 300, height: 150 },
    scale: { x: 0.375, y: 0.375 },
    operation: "contain",
    background: { kind: "color", space: "srgb8", rgba: [10, 20, 30, 128] },
  };
}

describe("CanvasRasterRenderer", () => {
  it("draws only with the core-resolved rectangles and explicit background", () => {
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      globalCompositeOperation: "source-over",
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
      fillStyle: "",
    };
    const canvas = {
      width: 1,
      height: 1,
      getContext: vi.fn(() => context),
      toBlob: vi.fn(),
      remove: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const source = {} as CanvasImageSource;
    const renderer = new CanvasRasterRenderer(canvas);
    renderer.render(source, plan(), "high");

    expect(context.fillStyle).toBe("rgba(10, 20, 30, 0.5019607843137255)");
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 300, 300);
    expect(context.drawImage).toHaveBeenCalledWith(source, 0, 0, 800, 400, 0, 75, 300, 150);
    expect(context.imageSmoothingQuality).toBe("high");
  });

  it("rejects malformed plan data before allocating the output canvas", () => {
    const canvas = {
      width: 1,
      height: 1,
      getContext: vi.fn(() => ({ save: vi.fn() })),
      remove: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const renderer = new CanvasRasterRenderer(canvas);
    expect(() =>
      renderer.render({} as CanvasImageSource, {
        ...plan(),
        placement: { ...plan().placement, width: Number.NaN },
      }),
    ).toThrow("invalid Canvas plan");
    expect(canvas.width).toBe(1);
    expect(() =>
      renderer.render({} as CanvasImageSource, {
        ...plan(),
        sourceRect: { x: 700, y: 0, width: 200, height: 400 },
      }),
    ).toThrow("invalid Canvas plan");
    expect(() =>
      renderer.render({} as CanvasImageSource, { ...plan(), scale: { x: 0, y: 1 } }),
    ).toThrow("invalid Canvas plan");
  });

  it("uniformly view-scales a large plan for preview without changing source sampling", () => {
    const context = {
      save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(),
      drawImage: vi.fn(), globalCompositeOperation: "source-over", imageSmoothingEnabled: false,
      imageSmoothingQuality: "low", fillStyle: "",
    };
    const canvas = { width: 1, height: 1, getContext: vi.fn(() => context), remove: vi.fn() } as unknown as HTMLCanvasElement;
    const renderer = new CanvasRasterRenderer(canvas);
    renderer.render({} as CanvasImageSource, plan(), "preview", 150);
    expect(canvas.width).toBe(150);
    expect(canvas.height).toBe(150);
    expect(context.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 400, 0, 37.5, 150, 75);
  });
});
