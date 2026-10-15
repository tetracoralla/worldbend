import { planSourceCapture, solveTransform, normalizedSpec, unitQuad, TransformWebGLRenderer, awaitImageDecoded } from "@worldbend/web";
import type { SourceCaptureFacts } from "@worldbend/web/types";

async function decode(bytes: Uint8Array): Promise<HTMLImageElement> {
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error("Source image is empty");
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
  try { const image = new Image(); image.src = url; await awaitImageDecoded(image); if(image.naturalWidth<=0||image.naturalHeight<=0)throw new Error("Source image could not be decoded"); return image; }
  finally { URL.revokeObjectURL(url); }
}

/** Materialize the owned logical plane at the Figma ingress boundary. All
 * workspaces then receive the same upright source, including ones whose
 * effects require intermediate rasters. The original Figma graph is untouched.
 * A high-resolution request repeats this step from fresh source pixels. */
export async function decodeSourceRaster(bytes: Uint8Array, facts?: SourceCaptureFacts) {
  const image = await decode(bytes);
  if (!facts) return { image, bytes };
  const view = await planSourceCapture(facts);
  if (image.naturalWidth !== view.pixelSize.width || image.naturalHeight !== view.pixelSize.height) throw new Error("Source capture header changed");
  if (JSON.stringify(view.logicalUvToTextureUv) === "[[1,0,0],[0,1,0]]") return { image, bytes };
  // Density is a carrier resource policy, not transform geometry. Keep the
  // logical aspect ratio while respecting the shared Figma raster edge limit.
  const scale = Math.min(facts.captureScale, 4096 / Math.max(facts.logicalSize.width, facts.logicalSize.height));
  const size = { width: Math.max(1, Math.round(facts.logicalSize.width * scale)), height: Math.max(1, Math.round(facts.logicalSize.height * scale)) };
  const renderer = new TransformWebGLRenderer(undefined, { preserveDrawingBuffer: true });
  try {
    renderer.render(image, await solveTransform(normalizedSpec(unitQuad()), size), undefined, "high", undefined, view);
    const blob = await new Promise<Blob>((resolve,reject) => renderer.canvas.toBlob(value => value ? resolve(value) : reject(new Error("Source normalization failed")), "image/png"));
    const normalized = new Uint8Array(await blob.arrayBuffer());
    return { image: await decode(normalized), bytes: normalized };
  } finally { renderer.dispose(); }
}
