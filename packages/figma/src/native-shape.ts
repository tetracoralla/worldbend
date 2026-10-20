import type { MockupClip } from "@worldbend/web/types";
import type { DocumentPoint } from "./native-quad";

export interface DocumentShapeSegment {
  kind: "line" | "cubic";
  to: DocumentPoint;
  c1?: DocumentPoint;
  c2?: DocumentPoint;
}
export interface DocumentShapeContour {
  start: DocumentPoint;
  segments: DocumentShapeSegment[];
}
export interface DocumentShapeRegion {
  contourIndices: number[];
  fillRule: "nonZero" | "evenOdd";
}
/** Native paths preserve region winding, direction and curves.
 * Coordinates are adapted to the document; the shared core owns clipping. */
export interface DocumentShape {
  contours: DocumentShapeContour[];
  fillRule: "nonZero" | "evenOdd";
  regions?: DocumentShapeRegion[];
  bounds: { x: number; y: number; width: number; height: number };
}
export const MAX_SHAPE_CONTOURS = 8;
export const MAX_SHAPE_SEGMENTS_PER_CONTOUR = 128;
export const MAX_SHAPE_TOTAL_SEGMENTS = 512;
const MAX_NATIVE_PATH_BYTES = 128 * 1024;

interface VectorSourceLike {
  type: "VECTOR";
  vectorPaths: readonly { windingRule: "NONZERO" | "EVENODD" | "NONE"; data: string }[];
  absoluteTransform: readonly [readonly [number, number, number], readonly [number, number, number]];
  absoluteBoundingBox: DocumentShape["bounds"];
}

/** Read Figma's resolved filled paths, whose rules belong to each path rather
 * than to the Vector node. Unfilled paths contribute no clipping region. */
export function documentShapeForSource(source: unknown): DocumentShape | undefined {
  if (!isVectorSource(source)) return undefined;
  const transform = source.absoluteTransform;
  const toDocument = (x: number, y: number): DocumentPoint => ({
    x: transform[0][0] * x + transform[0][1] * y + transform[0][2],
    y: transform[1][0] * x + transform[1][1] * y + transform[1][2],
  });
  const contours: DocumentShapeContour[] = [];
  const regions: DocumentShapeRegion[] = [];
  let totalSegments = 0;
  let totalBytes = 0;
  for (const path of source.vectorPaths) {
    if (path.windingRule === "NONE") continue;
    if (path.windingRule !== "NONZERO" && path.windingRule !== "EVENODD") return undefined;
    if (typeof path.data !== "string") return undefined;
    totalBytes += path.data.length;
    if (totalBytes > MAX_NATIVE_PATH_BYTES) return undefined;
    const captured = readNativePath(path.data, toDocument);
    if (!captured?.length) return undefined;
    const indices = captured.map((_, index) => contours.length + index);
    contours.push(...captured);
    totalSegments += captured.reduce((sum, contour) => sum + contour.segments.length, 0);
    if (contours.length > MAX_SHAPE_CONTOURS || totalSegments > MAX_SHAPE_TOTAL_SEGMENTS) return undefined;
    regions.push({ contourIndices: indices, fillRule: path.windingRule === "EVENODD" ? "evenOdd" : "nonZero" });
  }
  if (!regions.length) return undefined;
  return {
    contours,
    fillRule: regions[0]!.fillRule,
    ...(regions.length > 1 ? { regions } : {}),
    // This supported native bound includes curve extrema and corner treatment,
    // excluding strokes and shadows. Sampling the curve could crop its peaks.
    bounds: { ...source.absoluteBoundingBox },
  };
}

function readNativePath(data: string, toDocument: (x: number, y: number) => DocumentPoint): DocumentShapeContour[] | undefined {
  // Figma's getter emits absolute M/L/C/Z and resolves quadratic paths.
  // The resolved fillGeometry getter supplies native corner curves.
  // Reject unsupported tokens instead of dropping
  // them and changing the outline silently.
  const token = /[MLCZ]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  const tokens = data.match(token) ?? [];
  if (data.replace(token, "").replace(/[\s,]/g, "") !== "") return undefined;
  let cursor = 0;
  const point = (): DocumentPoint | undefined => {
    const x = Number(tokens[cursor++]);
    const y = Number(tokens[cursor++]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    const mapped = toDocument(x, y);
    return Number.isFinite(mapped.x) && Number.isFinite(mapped.y) ? mapped : undefined;
  };
  const contours: DocumentShapeContour[] = [];
  let current: DocumentShapeContour | undefined;
  while (cursor < tokens.length) {
    const command = tokens[cursor++];
    if (command === "M") {
      if (current) return undefined;
      const start = point();
      if (!start) return undefined;
      current = { start, segments: [] };
    } else if (command === "Z") {
      if (!current || current.segments.length < 2) return undefined;
      contours.push(current);
      if (contours.length > MAX_SHAPE_CONTOURS) return undefined;
      current = undefined;
    } else if (command === "L" || command === "C") {
      if (!current) return undefined;
      let segment: DocumentShapeSegment;
      if (command === "C") {
        const c1 = point(), c2 = point(), to = point();
        if (!c1 || !c2 || !to) return undefined;
        segment = { kind: "cubic", c1, c2, to };
      } else {
        const to = point();
        if (!to) return undefined;
        segment = { kind: "line", to };
      }
      current.segments.push(segment);
      if (current.segments.length > MAX_SHAPE_SEGMENTS_PER_CONTOUR) return undefined;
    } else return undefined;
  }
  return current ? undefined : contours;
}

function isVectorSource(value: unknown): value is VectorSourceLike {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const transform = record["absoluteTransform"];
  const bounds = record["absoluteBoundingBox"] as Record<string, unknown> | null | undefined;
  return record["type"] === "VECTOR" && Array.isArray(record["vectorPaths"]) &&
    record["vectorPaths"].every(path => typeof path === "object" && path !== null &&
      typeof path.data === "string" && ["NONE", "NONZERO", "EVENODD"].includes(path.windingRule)) && Array.isArray(transform) &&
    transform.length === 2 && transform.every(row => Array.isArray(row) && row.length === 3 &&
      row.every(item => typeof item === "number" && Number.isFinite(item))) &&
    !!bounds && ["x", "y", "width", "height"].every(key => typeof bounds[key] === "number" && Number.isFinite(bounds[key])) &&
    (bounds["width"] as number) > 0 && (bounds["height"] as number) > 0;
}

/** Convert document coordinates once. Curves, fill rules and every region keep
 * their declared meaning; the core chooses and resolves connected domains. */
export function normalizedDocumentShape(shape: DocumentShape): MockupClip {
  const {x,y,width,height}=shape.bounds;
  if (![x,y,width,height].every(Number.isFinite)||width<=0||height<=0) throw new Error("The shape needs visible bounds");
  const point=(p:{x:number;y:number})=>({x:(p.x-x)/width,y:(p.y-y)/height});
  return {contours:shape.contours.map(contour=>({start:point(contour.start),segments:contour.segments.map(segment=>
    segment.kind === "line" ? {kind:"line",to:point(segment.to)} :
      {kind:"cubic",c1:point(segment.c1!),c2:point(segment.c2!),to:point(segment.to)})})),
    fillRule:shape.fillRule,...(shape.regions ? {regions:shape.regions.map(region=>({...region,contourIndices:[...region.contourIndices]}))} : {})};
}
