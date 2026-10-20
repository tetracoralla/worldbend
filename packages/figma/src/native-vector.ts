import {nativeVectorArtworkFromInputs} from "./native-vector-operation";
import {nativeAncestorClipState} from "./native-ancestor-clips";
import type { NineNumbers, VectorProjectionInput, VectorOperation, VectorArtworkProjectionInput } from "@worldbend/web/types";
import type { NativeVectorFidelity } from "./native-vector-guard";

export type { NativeVectorFidelity };
import type { Placement } from "./messages";
import { isRecord, SHARED_NAMESPACE } from "./stored-plane";

export const SHARED_NATIVE_VECTOR_KEY = "nativeVector";
/** Input ceilings mirror the shared core limits; the core owns the meaning. */
const MAX_NATIVE_VECTOR_VERTICES = 8192;
const MAX_NATIVE_VECTOR_SEGMENTS = 16384;
const MAX_NATIVE_VECTOR_REGIONS = 2048;
/** Whole-artwork results keep one projected Vector per captured layer; this
 * bounds the record, the publication loop and the relayed projection set. */
export const MAX_NATIVE_VECTOR_PARTS = 64;
const ORTHONORMAL_TOLERANCE = 1.0e-6;

/** Detached host geometry; no capture node or source clone survives a read. */
export type NativeVectorGeometry = Pick<VectorNode,
  "type" | "width" | "height" | "visible" | "opacity" | "blendMode" | "isMask" |
  "effects" | "absoluteBoundingBox" | "absoluteTransform" | "vectorNetwork" |
  "fills" | "strokes" | "strokeWeight" | "strokeAlign" | "strokeCap" |
  "strokeJoin" | "strokeMiterLimit" | "dashPattern"> & {
    nativeStrokeOutlined?: true;
    /** Captures classify regions carrying native stroke paint, including a
     * same-painted fill merged with its stroke, for the stroke-overflow
     * exemption core-expanded strokes already have. */
    nativeStrokeOutlineRegions?: boolean[];
    /** Set when the part came from a text layer (or component text): its
     * glyphs are frozen editable outlines, not live text. */
    nativeTextOutlined?: true;
    variableWidthStrokeProperties?: VectorNode["variableWidthStrokeProperties"];
    complexStrokeProperties?: VectorNode["complexStrokeProperties"];
  };

export interface NativeVectorPartRecord {
  contentNodeId: string;
  fingerprint: string;
  role?: "clip";
}

export type {NativeVectorSourceView} from "./native-vector-view";
import {isNativeVectorSourceView,type NativeVectorSourceView} from "./native-vector-view";

export interface NativeVectorProjection {
  schema: "worldbend.figma.native-vector";
  /** 0.2 records carry a `parts` array; 0.1 single-content records are
   * normalized to one part at read time and stay writable in their own shape. */
  version: "0.1" | "0.2" | "0.3";
  resultNodeId: string;
  sourceNodeId: string;
  outputSize: { width: number; height: number };
  placement: Placement;
  operation: string;
  fidelity: NativeVectorFidelity;
  parts: NativeVectorPartRecord[];
  sourceNodeIds?:string[];
  sourceView?:NativeVectorSourceView;
}

/**
 * Eligible sources: bounded filled vector networks with solid paints, whose
 * boundaries are straight or cubic Bézier, plus at most one visible solid
 * center-aligned stroke that the shared core can expand into a fill outline.
 * This is the resolved network boundary. Native shape/corner/inside-stroke
 * capture lives in native-vector-source; unsupported appearance stays HD.
 */
export function canUseNativeVectorSource(node: SceneNode): node is VectorNode {
  return node.type === "VECTOR" && nativeVectorGeometrySupported(node);
}

export function nativeVectorGeometrySupported(node: NativeVectorGeometry): boolean {
  if (node.width <= 0 || node.height <= 0 ||
    !node.visible || node.opacity <= 0 ||
    !finiteBox(node.absoluteBoundingBox) || !finiteTransform(node.absoluteTransform) ||
    node.effects.length !== 0 || node.isMask) return false;
  const network = node.vectorNetwork;
  if (network.vertices.length < 3 || network.vertices.length > MAX_NATIVE_VECTOR_VERTICES ||
    network.segments.length < 3 || network.segments.length > MAX_NATIVE_VECTOR_SEGMENTS ||
    !network.regions || network.regions.length < 1 || network.regions.length > MAX_NATIVE_VECTOR_REGIONS) return false;
  if (network.vertices.some((vertex) => !Number.isFinite(vertex.x) || !Number.isFinite(vertex.y) ||
    (vertex.cornerRadius !== undefined && vertex.cornerRadius !== 0))) return false;
  if (network.segments.some((segment) => !validVertexIndex(segment.start, network.vertices.length) ||
    !validVertexIndex(segment.end, network.vertices.length) || segment.start === segment.end ||
    !finiteTangent(segment.tangentStart) || !finiteTangent(segment.tangentEnd))) return false;
  // The shared core requires every vertex to belong to a segment; catching
  // unreferenced vertices here reports the HD route at selection time instead
  // of failing the apply.
  let inputLoopReferences=0;
  for(const region of network.regions)for(const loop of region.loops) {
    inputLoopReferences+=loop.length;if(inputLoopReferences>131072)return false;
  }
  const referenced = new Set<number>();
  for (const segment of network.segments) {
    referenced.add(segment.start);
    referenced.add(segment.end);
  }
  if (referenced.size !== network.vertices.length) return false;
  // The shared core only models NONZERO and EVENODD; Figma's "NONE" (and a
  // mixed read) must report the HD route at selection time instead of
  // failing the apply.
  if (network.regions.some((region) =>
    (region.windingRule !== "NONZERO" && region.windingRule !== "EVENODD") ||
    region.loops.length < 1 || region.loops.some((loop) =>
      loop.length < 3 || loop.some((segment) => !validVertexIndex(segment, network.segments.length)) ||
      new Set(loop).size !== loop.length) ||
    !solidPaints(region.fills))) return false;
  const paints = [
    ...(Array.isArray(node.fills) ? node.fills : []),
    ...network.regions.flatMap((region) => Array.isArray(region.fills) ? region.fills : []),
  ];
  // Figma exposes mixed node fills for differently painted regions. Each
  // region must then carry its own explicit solid paints; never infer a fill.
  const explicitRegions = network.regions.every(region => Array.isArray(region.fills));
  if ((!solidPaints(node.fills) && !(!Array.isArray(node.fills) && explicitRegions)) || !paints.some((paint) =>
    paint.type === "SOLID" && paint.visible !== false && paint.opacity !== 0)) return false;
  return strokeSupported(node);
}

/** Map one eligible Figma Vector onto the shared core projection input.
 * Whole-artwork parts pass `artworkBounds` — the frame's absolute box — so
 * every layer normalizes against the same artwork domain instead of
 * stretching its own network across the whole placement. */
export function buildNativeVectorProjectionInput(input: {
  source: NativeVectorGeometry;
  matrix: NineNumbers;
  reference: { width: number; height: number };
  placement: { width: number; height: number };
  artworkBounds?: Rect;
}): VectorProjectionInput {
  if (!nativeVectorGeometrySupported(input.source) ||
    ![input.reference.width, input.reference.height, input.placement.width, input.placement.height]
      .every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("Unsupported native vector source");
  }
  const artworkBounds = input.artworkBounds;
  if (artworkBounds !== undefined &&
    ![artworkBounds.x, artworkBounds.y, artworkBounds.width, artworkBounds.height]
      .every((value) => Number.isFinite(value)) || artworkBounds !== undefined &&
    (artworkBounds.width <= 0 || artworkBounds.height <= 0)) {
    throw new Error("Unsupported native vector artwork bounds");
  }
  const node = input.source;
  const network = node.vectorNetwork;
  const box = artworkBounds ?? node.absoluteBoundingBox!;
  const transform = node.absoluteTransform;
  const visibleStrokes = (Array.isArray(node.strokes) ? node.strokes : [])
    .filter((paint) => paint.visible !== false && paint.opacity !== 0);
  const stroke = visibleStrokes.length === 1
    ? {
      weight: node.strokeWeight as number,
      cap: node.strokeCap as "NONE" | "ROUND" | "SQUARE",
      join: node.strokeJoin as "MITER" | "BEVEL" | "ROUND",
      miterLimit: node.strokeMiterLimit,
    }
    : undefined;
  if (stroke && (!Number.isFinite(stroke.weight) || !Number.isFinite(stroke.miterLimit))) {
    throw new Error("Unsupported native vector stroke");
  }
  return {
    schema: "worldbend.vector-projection",
    version: "0.1",
    path: {
      vertices: network.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      segments: network.segments.map((segment) => ({
        start: segment.start,
        end: segment.end,
        ...(segment.tangentStart
          ? { tangentStart: { x: segment.tangentStart.x, y: segment.tangentStart.y } }
          : {}),
        ...(segment.tangentEnd
          ? { tangentEnd: { x: segment.tangentEnd.x, y: segment.tangentEnd.y } }
          : {}),
      })),
      regions: network.regions!.map((region) => ({
        windingRule: region.windingRule,
        loops: region.loops.map((loop) => [...loop]),
      })),
    },
    ...(stroke ? { stroke } : {}),
    sourceTransform: [
      transform[0][0], transform[0][1], transform[0][2],
      transform[1][0], transform[1][1], transform[1][2],
    ],
    sourceBounds: { x: box.x, y: box.y, width: box.width, height: box.height },
    homography: [...input.matrix],
    reference: { width: input.reference.width, height: input.reference.height },
    placement: { width: input.placement.width, height: input.placement.height },
  };
}

export function nativeVectorFingerprint(node: VectorNode): string {
  const serialized = JSON.stringify({
    name: node.name,
    network: node.vectorNetwork,
    fills: node.fills,
    strokes: node.strokes,
    effects: node.effects,
    opacity: node.opacity,
    blendMode: node.blendMode,
    visible: node.visible,
    locked: node.locked,
    isMask: node.isMask,
    maskType: node.maskType,
    constraints: node.constraints,
    x: node.x,
    y: node.y,
    relativeTransform: node.relativeTransform,
  });
  return fingerprint(serialized, "vector32x2");
}

/** Detect source movement or path/style changes across asynchronous host reads. */
export function nativeVectorSourceFingerprint(node: VectorNode): string {
  const ancestorClips=nativeAncestorClipState(node);
  return fingerprint(JSON.stringify({
    content: nativeVectorFingerprint(node),
    absoluteBoundingBox: node.absoluteBoundingBox,
    absoluteTransform: node.absoluteTransform,
    variableWidthStrokeProperties: node.variableWidthStrokeProperties,
    complexStrokeProperties: node.complexStrokeProperties,
    modes: node.resolvedVariableModes, variables: node.boundVariables,
    ...(ancestorClips.length?{ancestorClips}:{}),
  }), "source32x2");
}

export function nativeVectorReadFingerprint(serialized: string): string {
  return fingerprint(serialized, "source32x2");
}

function fingerprint(serialized: string, prefix: "vector32x2" | "source32x2"): string {
  let first = 2166136261;
  let second = 2654435769;
  for (let index = 0; index < serialized.length; index += 1) {
    const value = serialized.charCodeAt(index);
    first = Math.imul(first ^ value, 16777619) >>> 0;
    second = Math.imul(second ^ (value + index), 2246822507) >>> 0;
  }
  return `${prefix}:${serialized.length}:${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

/**
 * Read one durable record. Legacy 0.1 records from the exact straight-path
 * era carry no fidelity block and read back as exact; current records carry
 * the core-reported fidelity summary. 0.1 records normalize to one part and
 * remain writable in their own single-content shape.
 */
export function readNativeVectorProjection(
  node: Pick<BaseNode, "id" | "getSharedPluginData">,
): NativeVectorProjection | undefined {
  const value = node.getSharedPluginData(SHARED_NAMESPACE, SHARED_NATIVE_VECTOR_KEY);
  if (!value || value.length > 90*1024) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if(isRecord(parsed)&&parsed.version==="0.3")return readModernVectorRecord(parsed,node.id);
    if(value.length>8192)return undefined;
    if (!isRecord(parsed) || (parsed["version"] === "0.1" && Object.keys(parsed).length !== 9 && Object.keys(parsed).length !== 10) ||
      (parsed["version"] === "0.2" && Object.keys(parsed).length !== 9) ||
      parsed["schema"] !== "worldbend.figma.native-vector" ||
      (parsed["version"] !== "0.1" && parsed["version"] !== "0.2") ||
      parsed["resultNodeId"] !== node.id || !boundedId(parsed["sourceNodeId"]) || parsed["sourceNodeId"] === node.id ||
      typeof parsed["operation"] !== "string" || parsed["operation"].length < 1 || parsed["operation"].length > 2048 ||
      !isSize(parsed["outputSize"]) || !isPlacement(parsed["placement"]) ||
      parsed["placement"].width !== parsed["outputSize"].width ||
      parsed["placement"].height !== parsed["outputSize"].height) return undefined;
    // 0.1 records without a fidelity block are the exact straight-path era;
    // every 0.2 record carries one.
    const fidelityRequired = parsed["version"] === "0.2" || Object.keys(parsed).length === 10;
    if (fidelityRequired && !isNativeVectorFidelity(parsed["fidelity"])) {
      return undefined;
    }
    const fidelity: NativeVectorFidelity = fidelityRequired
      ? parsed["fidelity"] as NativeVectorFidelity
      : { class: "exact", reasons: [] };
    const parts = parsed["version"] === "0.1"
      ? [{ contentNodeId: parsed["contentNodeId"] as unknown, fingerprint: parsed["fingerprint"] as unknown }]
      : parsed["parts"] as unknown;
    if (!Array.isArray(parts) || parts.length < 1 || parts.length > MAX_NATIVE_VECTOR_PARTS ||
      parts.some((part) => !isRecord(part) || Object.keys(part).length !== 2 ||
        !boundedId(part["contentNodeId"]) || part["contentNodeId"] === node.id ||
        !isContentFingerprint(part["fingerprint"])) ||
      new Set(parts.map((part) => part["contentNodeId"])).size !== parts.length ||
      parts.some((part) => part["contentNodeId"] === parsed["sourceNodeId"])) return undefined;
    return {
      schema: "worldbend.figma.native-vector",
      version: parsed["version"],
      resultNodeId: node.id,
      sourceNodeId: parsed["sourceNodeId"] as string,
      outputSize: parsed["outputSize"] as { width: number; height: number },
      placement: parsed["placement"] as Placement,
      operation: parsed["operation"] as string,
      fidelity,
      parts: parts as NativeVectorPartRecord[],
    };
  } catch {
    return undefined;
  }
}

/** Serialize a record back to its stored shape; 0.1 records stay 0.1. */
export function serializeNativeVectorProjection(record: NativeVectorProjection): string {
  if(record.version==="0.3")return JSON.stringify(record);
  if (record.version === "0.1") {
    const part = record.parts[0]!;
    return JSON.stringify({
      schema: record.schema, version: "0.1", resultNodeId: record.resultNodeId,
      contentNodeId: part.contentNodeId, sourceNodeId: record.sourceNodeId,
      fingerprint: part.fingerprint, outputSize: record.outputSize,
      placement: record.placement, operation: record.operation, fidelity: record.fidelity,
    });
  }
  return JSON.stringify({
    schema: record.schema, version: "0.2", resultNodeId: record.resultNodeId,
    sourceNodeId: record.sourceNodeId, outputSize: record.outputSize,
    placement: record.placement, operation: record.operation, fidelity: record.fidelity,
    parts: record.parts,
  });
}

/** A native Duplicate retains the old metadata. Read it without resolving or
 * changing any original node; document validation pairs only the copy's own
 * children. Adoption is written only when the designer chooses Update. */
export function readCopiedNativeVectorProjection(
  node: Pick<BaseNode, "id" | "getSharedPluginData">,
): NativeVectorProjection | undefined {
  const raw = node.getSharedPluginData(SHARED_NAMESPACE, SHARED_NATIVE_VECTOR_KEY);
  if (!raw || raw.length > 90*1024) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !boundedId(value["resultNodeId"]) || value["resultNodeId"] === node.id) return undefined;
    return readNativeVectorProjection({ id: value["resultNodeId"],
      getSharedPluginData: (namespace, key) => node.getSharedPluginData(namespace, key) });
  } catch { return undefined; }
}

function readModernVectorRecord(v:Record<string,unknown>,id:string):NativeVectorProjection|undefined {
  if(Object.keys(v).sort().join(",")!=="fidelity,operation,outputSize,parts,placement,resultNodeId,schema,sourceNodeId,sourceNodeIds,sourceView,version"||
    v.schema!=="worldbend.figma.native-vector"||v.resultNodeId!==id||!boundedId(v.sourceNodeId)||v.sourceNodeId===id||
    typeof v.operation!=="string"||!/^[a-f0-9]{64}$/.test(v.operation)||!isSize(v.outputSize)||!isPlacement(v.placement)||
    v.placement.width!==v.outputSize.width||v.placement.height!==v.outputSize.height||!isNativeVectorFidelity(v.fidelity)||
    !Array.isArray(v.sourceNodeIds)||v.sourceNodeIds.length<1||v.sourceNodeIds.length>2||!v.sourceNodeIds.every(n=>boundedId(n)&&n!==id)||
    new Set(v.sourceNodeIds).size!==v.sourceNodeIds.length||!v.sourceNodeIds.includes(v.sourceNodeId)||
    !isNativeVectorSourceView(v.sourceView)||
    !Array.isArray(v.parts)||!v.parts.length||v.parts.length>65)return undefined;
  let clips=0;
  for(const [i,p] of v.parts.entries())if(!isRecord(p)||
    Object.keys(p).sort().join(",")!==(p.role===undefined?"contentNodeId,fingerprint":"contentNodeId,fingerprint,role")||
    !boundedId(p.contentNodeId)||p.contentNodeId===id||v.sourceNodeIds.includes(p.contentNodeId)||!isContentFingerprint(p.fingerprint)||
    (p.role!==undefined&&(p.role!=="clip"||i!==0||++clips>1)))return undefined;
  if(v.parts.length-clips>64||new Set(v.parts.map(p=>(p as Record<string,unknown>).contentNodeId)).size!==v.parts.length)return undefined;
  return v as unknown as NativeVectorProjection;
}

function isContentFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^vector32x2:\d+:[0-9a-f]{16}$/.test(value);
}

function isNativeVectorFidelity(value: unknown): value is NativeVectorFidelity {
  return isRecord(value) &&
    ["exact", "approximated", "outlined"].includes(value["class"] as string) &&
    (value["maxError"] === undefined ||
      (typeof value["maxError"] === "number" && Number.isFinite(value["maxError"]) && value["maxError"] >= 0)) &&
    Array.isArray(value["reasons"]) &&
    value["reasons"].every((reason: unknown) =>
      ["curveSubdivision", "strokeOutlined", "strokeApproximated", "textOutlined"].includes(reason as string));
}

/** One visible solid center stroke is expandable; everything else falls back. */
export function uniformNativeStrokeProfile(value:unknown):boolean {
  if(value===undefined||value===null)return true;
  return isRecord(value)&&value["widthProfile"]==="UNIFORM"&&
    (value["variableWidthPoints"]===undefined||(Array.isArray(value["variableWidthPoints"])&&value["variableWidthPoints"].length===0))&&
    Object.keys(value).every(key=>key==="widthProfile"||key==="variableWidthPoints");
}

function strokeSupported(node: NativeVectorGeometry): boolean {
  const strokes = Array.isArray(node.strokes) ? node.strokes : [];
  const visible = strokes.filter((paint) => paint.visible !== false && paint.opacity !== 0);
  if (visible.length === 0) return true;
  if (!uniformNativeStrokeProfile(node.variableWidthStrokeProperties) ||
    (node.complexStrokeProperties && node.complexStrokeProperties.type !== "BASIC")) return false;
  if (visible.length > 1) return false;
  if (visible[0]!.type !== "SOLID") return false;
  if (typeof node.strokeWeight !== "number" ||
    !Number.isFinite(node.strokeWeight) || node.strokeWeight <= 0) return false;
  if (node.strokeAlign !== "CENTER") return false;
  if (node.dashPattern !== undefined && node.dashPattern.length > 0) return false;
  if (node.strokeCap !== "NONE" && node.strokeCap !== "ROUND" && node.strokeCap !== "SQUARE") return false;
  if (node.strokeJoin !== "MITER" && node.strokeJoin !== "BEVEL" && node.strokeJoin !== "ROUND") return false;
  if (node.vectorNetwork.vertices.some(vertex=>
    (vertex.strokeCap!==undefined&&vertex.strokeCap!==node.strokeCap)||
    (vertex.strokeJoin!==undefined&&vertex.strokeJoin!==node.strokeJoin))) return false;
  if (typeof node.strokeMiterLimit !== "number" ||
    !Number.isFinite(node.strokeMiterLimit) ||
    node.strokeMiterLimit < 1 || node.strokeMiterLimit > 1000) return false;
  // The stroke expands in path space, so the document transform must be an
  // isometry there for the uniform width to be unambiguous.
  const [[a, b], [d, e]] = node.absoluteTransform;
  const columnA = a * a + d * d;
  const columnB = b * b + e * e;
  const cross = a * b + d * e;
  return Math.abs(columnA - 1) <= ORTHONORMAL_TOLERANCE &&
    Math.abs(columnB - 1) <= ORTHONORMAL_TOLERANCE && Math.abs(cross) <= ORTHONORMAL_TOLERANCE;
}

function solidPaints(value: readonly Paint[] | PluginAPI["mixed"] | undefined): boolean {
  if (value === undefined) return true;
  return Array.isArray(value) && value.every((paint) => paint.visible === false || paint.opacity === 0 || paint.type === "SOLID");
}

function finiteTangent(value: Vector | undefined): boolean {
  return value === undefined ||
    (typeof value.x === "number" && typeof value.y === "number" &&
      Number.isFinite(value.x) && Number.isFinite(value.y));
}

function validVertexIndex(value: number, length: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < length;
}

function finiteTransform(value: Transform): boolean {
  return value.length === 2 && value.every((row) => row.length === 3 && row.every(Number.isFinite));
}

function finiteBox(value: Rect | null): value is Rect {
  return value !== null && [value.x, value.y, value.width, value.height]
    .every(Number.isFinite) && value.width > 0 && value.height > 0;
}

function boundedId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function isSize(value: unknown): value is { width: number; height: number } {
  return isRecord(value) && Object.keys(value).length === 2 &&
    [value["width"], value["height"]].every((axis) => typeof axis === "number" && Number.isFinite(axis) && axis > 0 && axis <= 4096);
}

function isPlacement(value: unknown): value is Placement {
  return isRecord(value) && Object.keys(value).length === 4 &&
    [value["x"], value["y"], value["width"], value["height"]].every((axis) => typeof axis === "number" && Number.isFinite(axis)) &&
    Number(value["width"]) > 0 && Number(value["height"]) > 0 && Number(value["width"]) <= 4096 && Number(value["height"]) <= 4096;
}

export function nativeVectorArtworkInput(input: {
  operation:VectorOperation;
  geometries:NativeVectorGeometry[];
  bounds:Rect;
  reference:{width:number;height:number};
  placement:{width:number;height:number};
}):VectorArtworkProjectionInput {
  const inputs=input.geometries.map(source=>buildNativeVectorProjectionInput({source,
    matrix:[1,0,0,0,1,0,0,0,1],reference:input.reference,placement:input.placement,artworkBounds:input.bounds}));
  return nativeVectorArtworkFromInputs(input.operation,inputs);
}
