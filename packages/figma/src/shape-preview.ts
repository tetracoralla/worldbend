import { validateMeshTopology, type MockupClipPlan, type Point, type WarpMesh } from "@worldbend/web";

/** A small, artwork-free diagram of core-produced geometry. Never persisted. */
export function shapePreview(lines: readonly (readonly { x: number; y: number }[])[]): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 120 80");
  svg.setAttribute("aria-hidden", "true");
  const points = lines.flat();
  if (!points.length || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return svg;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const left = Math.min(...xs), top = Math.min(...ys);
  const width = Math.max(...xs) - left, height = Math.max(...ys) - top;
  const scale = Math.min(96 / Math.max(width, 0.001), 56 / Math.max(height, 0.001));
  for (const line of lines) {
    const path = document.createElementNS(ns, "polyline");
    path.setAttribute("points", line.map(p => `${60 + (p.x - left - width / 2) * scale},${40 + (p.y - top - height / 2) * scale}`).join(" "));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
  }
  return svg;
}

export function meshPreview(mesh: WarpMesh, project: (point: Point) => Point = point => point): SVGSVGElement {
  if (!("subdivisions" in mesh)) {
    const ring = validateMeshTopology(mesh).boundary.map(i => project(mesh.vertices[i]!.warped));
    return shapePreview([[...ring, ring[0]!]]);
  }
  const n = mesh.subdivisions;
  const lines: { x: number; y: number }[][] = [];
  for (const row of new Set([0, Math.round(n / 3), Math.round(2 * n / 3), n])) {
    lines.push(Array.from({ length: n + 1 }, (_, column) => project(mesh.vertices[row * (n + 1) + column]!.warped)));
    lines.push(Array.from({ length: n + 1 }, (_, column) => project(mesh.vertices[column * (n + 1) + row]!.warped)));
  }
  return shapePreview(lines);
}

/** Display the core-projected compound fill, including all holes and regions.
 * This is a carrier drawing of declared curves, not an adapter geometry solve. */
export function clipPreview(clip: MockupClipPlan, reference: {width:number;height:number}): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 120 80");
  svg.setAttribute("aria-hidden", "true");
  const {x,y,width,height} = clip.bounds;
  const scale = Math.min(96 / Math.max(width,.001),56 / Math.max(height,.001));
  const project = (point: Point) => `${60+(point.x*reference.width-x-width/2)*scale} ${40+(point.y*reference.height-y-height/2)*scale}`;
  const regions = clip.regions?.length ? clip.regions : [{
    contourIndices: clip.contours.map((_,index)=>index), fillRule: clip.fillRule ?? "nonZero",
  }];
  for (const region of regions) {
    const path = document.createElementNS(ns,"path");
    path.setAttribute("d",region.contourIndices.map(index=>{
      const contour = clip.contours[index]!;
      return `M ${project(contour.start)} `+contour.segments.map(segment=>segment.kind === "line"
        ? `L ${project(segment.to)}`
        : `C ${project(segment.c1)} ${project(segment.c2)} ${project(segment.to)}`).join(" ")+" Z";
    }).join(" "));
    path.setAttribute("fill","currentColor");
    path.setAttribute("fill-opacity","0.18");
    path.setAttribute("fill-rule",region.fillRule === "evenOdd" ? "evenodd" : "nonzero");
    path.setAttribute("stroke","currentColor");
    path.setAttribute("stroke-width","1.5");
    path.setAttribute("stroke-linejoin","round");
    svg.append(path);
  }
  return svg;
}
