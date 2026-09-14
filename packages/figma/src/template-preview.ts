import { planMeshWarp, planMockup, planSurfaceDeformation } from "./designer-plan";
import { planeCoordinates } from "./plane-coordinates";
import { meshPreview, shapePreview } from "./shape-preview";
import { ownedCanvasOperationOutput } from "./stored-canvas";
import type { FigmaTaskTemplate } from "./stored-template-library";

/** Geometry-only previews: artwork is never copied into the saved library. */
export async function templatePreview(template: FigmaTaskTemplate): Promise<SVGSVGElement> {
  const operation = template.operation;
  if (operation.kind === "mesh" || operation.kind === "surface") {
    const plan = operation.kind === "mesh"
      ? await planMeshWarp(operation.spec)
      : (await planSurfaceDeformation(operation.spec)).meshWarp;
    const coordinates = planeCoordinates(plan.solve);
    return meshPreview({ ...plan.spec.mesh, vertices: plan.spec.mesh.vertices.map(vertex => ({
      ...vertex, warped: (() => { const p = coordinates.project(vertex.warped); return { x: p.x * plan.solve.resolvedDestination.reference.width, y: p.y * plan.solve.resolvedDestination.reference.height }; })(),
    })) });
  }
  if (operation.kind === "mockup") {
    const plan = await planMockup(operation.spec);
    return shapePreview(plan.planes.map(plane => {
      const project = planeCoordinates(plane.solve).project;
      return [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1},{x:0,y:0}].map(point => { const p = project(point); return {x: p.x * plan.canvas.width, y: p.y * plan.canvas.height}; });
    }));
  }
  // These are size diagrams, not previews of content-dependent Trim output.
  let offset = 0;
  return shapePreview(operation.spec.variants.map(variant => {
    const size = ownedCanvasOperationOutput(variant.operation);
    const ratio = size ? size.width / size.height : 1;
    const width = Math.min(1, ratio), height = Math.min(1, 1 / ratio);
    const x = offset;
    offset += width + 0.15;
    return [{x,y:0},{x:x+width,y:0},{x:x+width,y:height},{x,y:height},{x,y:0}];
  }));
}
