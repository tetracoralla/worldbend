import type { VectorProjectionOutput } from "@worldbend/web/types";
import { isRecord } from "./stored-plane";

/** Fidelity summary stored with every published native-vector record. */
export interface NativeVectorFidelity {
  class: "exact" | "approximated" | "outlined";
  maxError?: number;
  reasons: string[];
}

const MAX_NATIVE_VECTOR_OUTPUT_VERTICES = 32768;
const MAX_NATIVE_VECTOR_OUTPUT_SEGMENTS = 32768;
const MAX_NATIVE_VECTOR_OUTPUT_REGIONS = 4096;
const MAX_NATIVE_VECTOR_OUTPUT_LOOP_REFERENCES = 524288;

/**
 * Structural validation for a core projection relayed between plugin
 * threads. Kept free of Figma ambient types so both compilation graphs can
 * use it; the shared core owns the semantic validation.
 */
export function isValidVectorProjectionOutput(value: unknown): value is VectorProjectionOutput {
  if (!isRecord(value) || !isRecord(value["network"]) || !isRecord(value["report"]) ||
    !isRecord(value["bounds"]) || !hasKeys(value, ["network", "bounds", "report"])) return false;
  const network = value["network"];
  const vertices = network["vertices"];
  const segments = network["segments"];
  const regions = network["regions"];
  if (!hasKeys(network, ["vertices", "segments", "regions"]) ||
    !Array.isArray(vertices) || vertices.length < 3 ||
    vertices.length > MAX_NATIVE_VECTOR_OUTPUT_VERTICES ||
    !Array.isArray(segments) || segments.length < 3 ||
    segments.length > MAX_NATIVE_VECTOR_OUTPUT_SEGMENTS ||
    !Array.isArray(regions) || regions.length < 1 ||
    regions.length > MAX_NATIVE_VECTOR_OUTPUT_REGIONS) return false;
  if (!vertices.every((vertex) => isRecord(vertex) && hasKeys(vertex, ["x", "y"]) &&
    isFiniteNumber(vertex["x"]) && isFiniteNumber(vertex["y"]))) return false;
  if (!segments.every((segment) => isRecord(segment) &&
    hasKeys(segment, ["start", "end"], ["tangentStart", "tangentEnd"]) &&
    isSegmentIndex(segment["start"], vertices.length) &&
    isSegmentIndex(segment["end"], vertices.length) &&
    segment["start"] !== segment["end"] &&
    finiteTangentValue(segment["tangentStart"]) && finiteTangentValue(segment["tangentEnd"]))) return false;
  let loopReferences = 0;
  if (!regions.every((region) => isRecord(region) &&
    hasKeys(region, ["windingRule", "loops"]) &&
    (region["windingRule"] === "NONZERO" || region["windingRule"] === "EVENODD") &&
    Array.isArray(region["loops"]) && region["loops"].length > 0 && region["loops"].every((loop) =>
      Array.isArray(loop) && loop.length >= 3 && loop.length <= segments.length &&
      (loopReferences += loop.length) <= MAX_NATIVE_VECTOR_OUTPUT_LOOP_REFERENCES &&
      loop.every((index) => isSegmentIndex(index, segments.length)) &&
      new Set(loop).size === loop.length && loopIsConnected(loop, segments)))) return false;
  const report = value["report"];
  if (!hasKeys(report, ["fidelity", "strokeOutlined", "tolerancePx", "reasons",
    "inputVertices", "inputSegments", "inputRegions", "outputVertices", "outputSegments",
    "outputRegions", "maxSubdivisionDepth"], ["maxError", "strokeChains"]) ||
    !["exact", "approximated", "outlined"].includes(report["fidelity"] as string) ||
    typeof report["strokeOutlined"] !== "boolean" ||
    !(report["maxError"] === undefined || report["maxError"] === null ||
      (isFiniteNumber(report["maxError"]) && report["maxError"] >= 0)) ||
    !isFiniteNumber(report["tolerancePx"]) || report["tolerancePx"] < 0.01 || report["tolerancePx"] > 4 ||
    !boundedInteger(report["inputVertices"], 3, 8192) ||
    !boundedInteger(report["inputSegments"], 3, 16384) ||
    !boundedInteger(report["inputRegions"], 1, 2048) ||
    report["outputVertices"] !== vertices.length || report["outputSegments"] !== segments.length ||
    report["outputRegions"] !== regions.length ||
    !boundedInteger(report["maxSubdivisionDepth"], 0, MAX_NATIVE_VECTOR_OUTPUT_SEGMENTS) ||
    !(report["strokeChains"] === undefined || report["strokeChains"] === null ||
      boundedInteger(report["strokeChains"], 1, MAX_NATIVE_VECTOR_OUTPUT_SEGMENTS)) ||
    !Array.isArray(report["reasons"]) || new Set(report["reasons"]).size !== report["reasons"].length ||
    !report["reasons"].every((reason) =>
      ["curveSubdivision", "strokeOutlined", "strokeApproximated"].includes(reason as string))) return false;
  const fidelity = report["fidelity"];
  const reasons = report["reasons"] as unknown[];
  const maxError = report["maxError"];
  const hasError = isFiniteNumber(maxError);
  const strokeOutlined = report["strokeOutlined"];
  const strokeChains = report["strokeChains"];
  if ((hasError && maxError > report["tolerancePx"]) ||
    (fidelity === "exact" && (strokeOutlined || hasError || reasons.length !== 0 || strokeChains != null)) ||
    (fidelity === "approximated" && (strokeOutlined || !reasons.includes("curveSubdivision") ||
      !hasError || strokeChains != null)) ||
    (fidelity === "outlined" && (!strokeOutlined || !reasons.includes("strokeOutlined") ||
      !boundedInteger(strokeChains, 1, MAX_NATIVE_VECTOR_OUTPUT_SEGMENTS))) ||
    ((reasons.includes("curveSubdivision") || reasons.includes("strokeApproximated")) && !hasError) ||
    (reasons.includes("strokeApproximated") && !strokeOutlined)) return false;
  const bounds = value["bounds"];
  return hasKeys(bounds, ["x", "y", "width", "height"]) &&
    ["x", "y", "width", "height"].every((axis) => isFiniteNumber(bounds[axis])) &&
    (bounds["width"] as number) >= 0 && (bounds["height"] as number) >= 0 &&
    boundsMatchNetwork(vertices as Array<Record<string, unknown>>,
      segments as Array<Record<string, unknown>>, bounds);
}

function boundsMatchNetwork(
  vertices: Array<Record<string, unknown>>,
  segments: Array<Record<string, unknown>>,
  bounds: Record<string, unknown>,
): boolean {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const cover = (x: number, y: number) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };
  for (const vertex of vertices) cover(vertex["x"] as number, vertex["y"] as number);
  for (const segment of segments) {
    const start = vertices[segment["start"] as number]!;
    const end = vertices[segment["end"] as number]!;
    const tangentStart = segment["tangentStart"] as Record<string, unknown> | undefined;
    const tangentEnd = segment["tangentEnd"] as Record<string, unknown> | undefined;
    const x = [start["x"] as number,
      (start["x"] as number) + ((tangentStart?.["x"] as number | undefined) ?? 0),
      (end["x"] as number) + ((tangentEnd?.["x"] as number | undefined) ?? 0),
      end["x"] as number] as const;
    const y = [start["y"] as number,
      (start["y"] as number) + ((tangentStart?.["y"] as number | undefined) ?? 0),
      (end["y"] as number) + ((tangentEnd?.["y"] as number | undefined) ?? 0),
      end["y"] as number] as const;
    for (const value of cubicExtrema(x)) { minX = Math.min(minX, value); maxX = Math.max(maxX, value); }
    for (const value of cubicExtrema(y)) { minY = Math.min(minY, value); maxY = Math.max(maxY, value); }
  }
  const expected = [minX, minY, maxX - minX, maxY - minY];
  const actual = [bounds["x"], bounds["y"], bounds["width"], bounds["height"]] as number[];
  const tolerance = Math.max(1e-8, Math.hypot(expected[2]!, expected[3]!) * 1e-9);
  return actual.every((value, index) => Math.abs(value - expected[index]!) <= tolerance);
}

function cubicExtrema(control: readonly [number, number, number, number]): number[] {
  const result = [control[0], control[3]];
  const a = -control[0] + 3 * control[1] - 3 * control[2] + control[3];
  const b = 2 * (control[0] - 2 * control[1] + control[2]);
  const c = control[1] - control[0];
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), 1);
  const epsilon = Number.EPSILON * 16 * scale;
  const parameters: number[] = [];
  if (Math.abs(a) <= epsilon) {
    if (Math.abs(b) > epsilon) parameters.push(-c / b);
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      parameters.push((-b - root) / (2 * a), (-b + root) / (2 * a));
    }
  }
  for (const t of parameters) {
    if (t <= 0 || t >= 1) continue;
    const u = 1 - t;
    result.push(u * u * u * control[0] + 3 * u * u * t * control[1] +
      3 * u * t * t * control[2] + t * t * t * control[3]);
  }
  return result;
}

function hasKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key));
}

function loopIsConnected(loop: unknown[], segments: unknown[]): boolean {
  const typedSegments = segments as Array<Record<string, unknown>>;
  const indices = loop as number[];
  const sharedVertex = (left: number, right: number): number | undefined => {
    const a = typedSegments[left]!;
    const b = typedSegments[right]!;
    const matches = [a["start"], a["end"]].filter((value) =>
      value === b["start"] || value === b["end"]);
    return matches.length === 1 ? matches[0] as number : undefined;
  };
  let entry = sharedVertex(indices[indices.length - 1]!, indices[0]!);
  if (entry === undefined) return false;
  for (const index of indices) {
    const segment = typedSegments[index]!;
    if (segment["start"] === entry) entry = segment["end"] as number;
    else if (segment["end"] === entry) entry = segment["start"] as number;
    else return false;
  }
  return true;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSegmentIndex(value: unknown, length: number): boolean {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < length;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function finiteTangentValue(value: unknown): boolean {
  return value === undefined || (isRecord(value) && hasKeys(value,["x","y"]) &&
    isFiniteNumber(value["x"]) && isFiniteNumber(value["y"]));
}

/** Whole-artwork structural capacity mirrors the canonical job, independent of
 * each part's ceiling. This is not a second geometry solver or error proof. */
export function isValidVectorArtworkOutputs(value:unknown):value is VectorProjectionOutput[] {
  if(!Array.isArray(value)||value.length<1||value.length>65)return false;
  let inputVertices=0,inputSegments=0,inputRegions=0,vertices=0,segments=0,regions=0,references=0;
  for(const output of value) {
    if(!isValidVectorProjectionOutput(output))return false;
    inputVertices+=output.report.inputVertices;inputSegments+=output.report.inputSegments;inputRegions+=output.report.inputRegions;
    vertices+=output.network.vertices.length;segments+=output.network.segments.length;regions+=output.network.regions.length;
    for(const region of output.network.regions)for(const loop of region.loops)references+=loop.length;
    if(inputVertices>8192||inputSegments>16384||inputRegions>2048||vertices>32768||segments>32768||regions>4096||references>524288)return false;
  }
  // Core projection envelopes contain only ASCII keys/enums/numerals; here
  // JSON code units are exactly UTF-8 bytes. Native paints are not included.
  return JSON.stringify(value).length<=8*1024*1024;
}
