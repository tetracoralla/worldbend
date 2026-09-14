import type { WarpMesh } from "@worldbend/web";

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

export function meshPreview(mesh: WarpMesh): SVGSVGElement {
  const n = mesh.subdivisions;
  const lines: { x: number; y: number }[][] = [];
  for (const row of new Set([0, Math.round(n / 3), Math.round(2 * n / 3), n])) {
    lines.push(Array.from({ length: n + 1 }, (_, column) => mesh.vertices[row * (n + 1) + column]!.warped));
    lines.push(Array.from({ length: n + 1 }, (_, column) => mesh.vertices[column * (n + 1) + row]!.warped));
  }
  return shapePreview(lines);
}
