import { buildMockupPlaneMesh, type TransformWebGLRenderer } from "@worldbend/web";
import { planMockup } from "./designer-plan";
import { scaleSolveByFactor } from "./designer-preview";
import { readyScene, readySceneDetails, readySceneMockup, type ReadySceneGradient, type ReadySceneId, type SceneArtworkFit } from "./ready-scenes";

/** Native decorations surround an actual canonical raster. One shared GPU
 * context serves the library; thumbnails own no live source or native nodes. */
export async function readyScenePreview(id: ReadySceneId, renderer: () => TransformWebGLRenderer,
  image?: HTMLImageElement, fit: SceneArtworkFit = "cover"): Promise<SVGSVGElement> {
  const scene = readyScene(id);
  const source = document.createElement("canvas");
  const factor = Math.min(1, 640 / Math.max(scene.surface.width, scene.surface.height));
  source.width = Math.round(scene.surface.width * factor);
  source.height = Math.round(scene.surface.height * factor);
  const context = source.getContext("2d");
  if (!context) throw Error("Canvas 2D is required for scene previews");
  if (image) {
    const scale = (fit === "contain" ? Math.min : Math.max)(source.width / image.naturalWidth, source.height / image.naturalHeight);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    context.drawImage(image, (source.width - width) / 2, (source.height - height) / 2, width, height);
  } else {
    context.fillStyle = "#173436"; context.fillRect(0, 0, source.width, source.height);
    context.fillStyle = "#E4F390";
    context.fillRect(source.width * .12, source.height * .12, source.width * .65, source.height * .03);
    context.fillRect(source.width * .12, source.height * .18, source.width * .48, source.height * .02);
    context.beginPath(); context.arc(source.width * .5, source.height * .58, source.width * .26, 0, Math.PI * 2); context.fill();
  }
  const plan = await planMockup(readySceneMockup(scene));
  const plane = plan.planes[0]!;
  const mesh = await buildMockupPlaneMesh(plane);
  const gpu = renderer();
  gpu.render(source, scaleSolveByFactor(plane.solve, 320 / scene.width), mesh, "high");
  const artwork = gpu.canvas.toDataURL("image/png");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${scene.width} ${scene.height}`);
  svg.style.isolation = "isolate";
  const defs: string[] = [];
  const paint = (color: string, gradient?: ReadySceneGradient): string => {
    if (!gradient) return `#${color}`;
    const name = `${id}-gradient-${defs.length}`;
    defs.push(`<linearGradient id="${name}" x1="0" y1="0" x2="${gradient.direction === "horizontal" ? 1 : 0}" y2="${gradient.direction === "vertical" ? 1 : 0}">${gradient.stops.map(stop => `<stop offset="${stop.at}" stop-color="#${stop.color}" stop-opacity="${stop.opacity ?? 1}"/>`).join("")}</linearGradient>`);
    return `url(#${name})`;
  };
  const body = paint(scene.body, scene.bodyGradient);
  const background = paint(scene.background, scene.backgroundGradient);
  const details = readySceneDetails(scene);
  const paths = (foreground: boolean) => details.filter(detail => Boolean(detail.foreground) === foreground).map(detail => {
    const shadow = foreground && detail.shadow !== false;
    let filter = "";
    if (detail.blur) {
      const name = `${id}-blur-${defs.length}`;
      defs.push(`<filter id="${name}" x="-50%" y="-100%" width="200%" height="300%"><feGaussianBlur stdDeviation="${detail.blur / 2}"/>${shadow ? '<feDropShadow dx="0" dy="4" stdDeviation="2" flood-opacity=".24"/>' : ""}</filter>`);
      filter = ` filter="url(#${name})"`;
    } else if (shadow) filter = ` filter="url(#${id}-detail-shadow)"`;
    return `<path d="${detail.path}" fill="${paint(detail.color, detail.gradient)}" fill-rule="${(detail.windingRule ?? "NONZERO").toLowerCase()}" opacity="${detail.opacity ?? 1}"${detail.blendMode ? ` style="mix-blend-mode:${detail.blendMode.toLowerCase()}"` : ""}${filter}/>`;
  }).join("");
  const behind = paths(false), front = paths(true);
  svg.innerHTML = `<defs>${defs.join("")}<filter id="${id}-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="18" dy="32" stdDeviation="16" flood-color="#141F1A" flood-opacity=".22"/></filter><filter id="${id}-detail-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="4" stdDeviation="2" flood-opacity=".24"/></filter></defs><rect width="${scene.width}" height="${scene.height}" fill="${background}"/><path d="${scene.outer}" fill="${body}" filter="url(#${id}-shadow)"/>${behind}<image href="${artwork}" width="${scene.width}" height="${scene.height}"/>${front}`;
  return svg;
}
