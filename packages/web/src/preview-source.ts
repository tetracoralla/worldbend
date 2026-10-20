export async function createPreviewSource(
  source: HTMLImageElement,
  width: number,
  height: number,
): Promise<TexImageSource> {
  if (width === source.naturalWidth && height === source.naturalHeight) return source;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Unable to prepare the perspective preview");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  // The downscaled preview never mutates, so freeze it into an ImageBitmap:
  // the renderer treats bitmaps as immutable and keeps the uploaded texture
  // across frames, while a live canvas would force texImage2D plus a mipmap
  // regeneration on every render.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(canvas);
    } catch {
      // Fall back to the canvas: older hosts re-upload per render but still
      // display correctly.
    }
  }
  return canvas;
}

/**
 * Release a preview source's resources. Only ImageBitmaps need an explicit
 * close; the instanceof guard is duck-typed because non-browser globals may
 * not define ImageBitmap at all.
 */
export function closePreviewSource(source: TexImageSource | undefined): void {
  if (source && typeof (source as ImageBitmap).close === "function") {
    (source as ImageBitmap).close();
  }
}
