import { afterEach, describe, expect, it, vi } from "vitest";
import { createPreviewSource } from "./preview-source";

function fakeImage(width: number, height: number): HTMLImageElement {
  return { naturalWidth: width, naturalHeight: height } as unknown as HTMLImageElement;
}

function stubCanvasDocument(context: unknown) {
  const canvas = {
    width: 0,
    height: 0,
    getContext: (type: string) => (type === "2d" ? context : null),
  };
  vi.stubGlobal("document", { createElement: () => canvas });
  return canvas;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createPreviewSource", () => {
  it("returns the source image itself when no downscale is needed", async () => {
    const createImageBitmap = vi.fn();
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    const image = fakeImage(800, 600);
    const result = await createPreviewSource(image, 800, 600);
    expect(result).toBe(image);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("freezes a downscaled preview into an immutable ImageBitmap", async () => {
    // Regression guard: the WebGL renderer skips texture re-upload only for
    // immutable sources, so the downscaled preview must not stay a canvas.
    const bitmap = { kind: "image-bitmap" };
    const createImageBitmap = vi.fn().mockResolvedValue(bitmap);
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    const context = {
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "",
      drawImage: vi.fn(),
    };
    const canvas = stubCanvasDocument(context);

    const image = fakeImage(2048, 1024);
    const result = await createPreviewSource(image, 1024, 512);

    expect(result).toBe(bitmap);
    expect(canvas.width).toBe(1024);
    expect(canvas.height).toBe(512);
    expect(context.imageSmoothingEnabled).toBe(true);
    expect(context.imageSmoothingQuality).toBe("high");
    expect(context.drawImage).toHaveBeenCalledWith(image, 0, 0, 1024, 512);
    expect(createImageBitmap).toHaveBeenCalledWith(canvas);
  });

  it("falls back to the downscaled canvas when ImageBitmap creation is unavailable", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    const canvas = stubCanvasDocument({
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "",
      drawImage: vi.fn(),
    });

    const result = await createPreviewSource(fakeImage(2048, 1024), 1024, 512);

    expect(result).toBe(canvas);
  });

  it("fails clearly when a 2D context cannot be created", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn());
    stubCanvasDocument(null);

    await expect(createPreviewSource(fakeImage(2048, 1024), 1024, 512)).rejects.toThrow(
      "Unable to prepare the perspective preview",
    );
  });
});
