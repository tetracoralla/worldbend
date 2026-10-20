import { createMeshCoordinateMap, type BezierEnvelope, type DeformationWorkPlanOutput, type MeshCoordinateMap, type Point } from "@worldbend/web";
import { planeCoordinates } from "./plane-coordinates";

export interface DeformationCoordinates {
  project(point: Point, controlId?: string): Point;
  unproject(point: Point, controlId?: string): Point | undefined;
}

/** Reuse the immutable fit during interior edits. Cubic lattice controls have
 * fixed nominal anchors; image/mesh/brush coordinates use exact fit lookup. */
export function createDeformationCoordinateCache() {
  let key: string | undefined;
  let fit: MeshCoordinateMap | undefined;
  let pendingGeneration = 0;
  return {
    async resolve(plan: DeformationWorkPlanOutput, envelope?: BezierEnvelope): Promise<DeformationCoordinates> {
      const mesh = plan.shapeFitView?.fit.mesh;
      const nextKey = mesh ? JSON.stringify(mesh) : undefined;
      const generation = ++pendingGeneration;
      if (nextKey !== key) {
        const next = mesh ? await createMeshCoordinateMap(mesh) : undefined;
        if (generation !== pendingGeneration) { next?.dispose(); throw new Error("Mesh coordinate request was superseded"); }
        fit?.dispose(); fit = next; key = nextKey;
      }
      const mapper = fit;
      const plane = planeCoordinates(plan.authoredView?.solve ?? plan.meshWarp.solve);
      const anchor = (id?: string): Point | undefined => {
        if (!envelope || id === undefined) return undefined;
        const index = Number(id), columns = envelope.columns * 3 + 1, rows = envelope.rows * 3 + 1;
        // Pin targets use column,row IDs, whereas cubic controls use indices.
        if (!Number.isInteger(index)) return undefined;
        if (index < 0 || index >= columns * rows) throw new Error("Unknown cubic control");
        return {x: (index % columns) / (columns - 1), y: Math.floor(index / columns) / (rows - 1)};
      };
      return {
        project(point, id) {
          const local = anchor(id);
          const fitted = !mapper ? point : local ? mapper.mapControl(point, local) : mapper.map(point);
          if (!fitted) throw new Error("Mesh point has no fitted image coordinate");
          return plane.project(fitted);
        },
        unproject(point, id) {
          const fitted = plane.unproject(point), local = anchor(id);
          return !mapper ? fitted : local ? mapper.mapControl(fitted, local, true) : mapper.map(fitted, true);
        },
      };
    },
    dispose() { pendingGeneration += 1; fit?.dispose(); fit = undefined; key = undefined; },
  };
}
