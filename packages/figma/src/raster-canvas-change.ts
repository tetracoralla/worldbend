import type { Point, Size } from "@worldbend/web";
import { isRecord } from "./stored-plane";

/** Both frames come from the shared planner, in the original reference pixels. */
export interface RasterCanvasFrame { origin: Point; reference: Size }
export interface RasterCanvasFrames { from: RasterCanvasFrame; to: RasterCanvasFrame }
export interface RasterCanvasChange extends RasterCanvasFrames { workExpected: string }

type RasterTransform = [[number, number, number], [number, number, number]];
interface RasterNode {
  width: number;
  height: number;
  relativeTransform: RasterTransform;
  resize(width: number, height: number): void;
}

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

const hasExactKeys = (value: object, expected: string) =>
  Object.keys(value).sort().join(",") === expected;
const isFinitePoint = (value: unknown): value is Point =>
  isRecord(value) && hasExactKeys(value, "x,y") &&
  [value["x"], value["y"]].every(coordinate => typeof coordinate === "number" && Number.isFinite(coordinate));
const isRasterCanvasFrame = (value: unknown): value is RasterCanvasFrame =>
  isRecord(value) && hasExactKeys(value, "origin,reference") && isFinitePoint(value["origin"]) &&
  isRecord(value["reference"]) && hasExactKeys(value["reference"], "height,width") &&
  [value["reference"]["width"], value["reference"]["height"]].every(
    dimension => typeof dimension === "number" && Number.isFinite(dimension) && dimension > 0);

export function isRasterCanvasChange(value: unknown): value is RasterCanvasChange {
  return isRecord(value) && hasExactKeys(value, "from,to,workExpected") &&
    typeof value["workExpected"] === "string" && DIGEST_PATTERN.test(value["workExpected"]) &&
    isRasterCanvasFrame(value["from"]) && isRasterCanvasFrame(value["to"]);
}

/** Prepared Agent publications already bind the complete old operation in
 * their guarded proposal. They reuse the same physical frame transport. */
export function isRasterCanvasFrames(value: unknown): value is RasterCanvasFrames {
  return isRecord(value) && hasExactKeys(value, "from,to") &&
    isRasterCanvasChange({ ...value, workExpected: "0".repeat(64) });
}

/** Apply a core canvas change in the node's own axes, preserving rotation,
 * reflection and containing transforms. This transports a frame, not artwork. */
export function changeRasterCanvas(node: RasterNode, change: RasterCanvasChange): void {
  if (!isRasterCanvasChange(change)) throw Error("Invalid deformation canvas change");
  transportRasterCanvas(node, change);
}

export function transportRasterCanvas(node: RasterNode, change: RasterCanvasFrames): void {
  if (!isRasterCanvasFrames({ from: change.from, to: change.to })) throw Error("Invalid deformation canvas frames");
  const { from, to } = change;
  const matrix = node.relativeTransform.map(row => [...row]) as RasterTransform;
  const dx = (to.origin.x - from.origin.x) * node.width / from.reference.width;
  const dy = (to.origin.y - from.origin.y) * node.height / from.reference.height;
  const width = node.width * to.reference.width / from.reference.width;
  const height = node.height * to.reference.height / from.reference.height;
  const x = matrix[0][2] + matrix[0][0] * dx + matrix[0][1] * dy;
  const y = matrix[1][2] + matrix[1][0] * dx + matrix[1][1] * dy;
  if (![width, height, x, y].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw Error("Invalid deformation canvas placement");
  }
  node.resize(width, height);
  node.relativeTransform = [[matrix[0][0], matrix[0][1], x], [matrix[1][0], matrix[1][1], y]];
}
