import {NativeCaptureBasisError} from "./native-vector-placement";
import { nativeVectorGeometrySupported, nativeVectorSourceFingerprint, nativeVectorReadFingerprint,
  type NativeVectorGeometry } from "./native-vector";
import { captureNativeVectorLayer, type ArtworkHost } from "./native-vector-artwork";
import { compactNativeVectorGeometry, type NativeVectorCaptureObserver } from "./native-vector-capture";
import { capturedPaints, capturedNetwork } from "./native-vector-paints";
import {nativeAncestorClips,nativeAncestorClipState} from "./native-ancestor-clips";

type Primitive = RectangleNode | EllipseNode | PolygonNode | StarNode;
type CaptureSource = Primitive | VectorNode;
type CaptureHost = ArtworkHost;

export function isNativeVectorArtwork(source: SceneNode): source is CaptureSource {
  return ["VECTOR", "RECTANGLE", "ELLIPSE", "POLYGON", "STAR"].includes(source.type);
}

/** The fingerprint includes native parameters omitted by vectorPaths, such as
 * independent radii, smoothing, arcs and polygon/star settings. */
export function nativeVectorArtworkFingerprint(source: SceneNode): string {
  if (!isNativeVectorArtwork(source)) throw Error("Unsupported native vector source");
  if (source.type === "VECTOR") return nativeVectorSourceFingerprint(source);
  return nativeVectorReadFingerprint(JSON.stringify({ type: source.type, name: source.name, visible: source.visible,
    locked: source.locked, opacity: source.opacity, blendMode: source.blendMode,
    effects: source.effects, isMask: source.isMask, maskType: source.maskType,
    fills: source.fills, strokes: source.strokes, strokeWeight: source.strokeWeight,
    strokeAlign: source.strokeAlign, strokeCap: source.strokeCap, strokeJoin: source.strokeJoin,
    strokeMiterLimit: source.strokeMiterLimit, dashPattern: source.dashPattern,
    sideWeights: "strokeTopWeight" in source ? [source.strokeTopWeight, source.strokeRightWeight,
      source.strokeBottomWeight, source.strokeLeftWeight] : undefined,
    width: source.width, height: source.height, bounds: source.absoluteBoundingBox,
    transform: source.absoluteTransform,
    ancestorClips: nativeAncestorClipState(source),
    modes: source.resolvedVariableModes, variables: source.boundVariables,
    shape: source.type === "RECTANGLE"
      ? [source.topLeftRadius, source.topRightRadius, source.bottomRightRadius,
          source.bottomLeftRadius, source.cornerSmoothing]
      : source.type === "ELLIPSE" ? source.arcData
      : source.type === "STAR" ? [source.pointCount, source.innerRadius, source.cornerRadius]
      : [source.pointCount, source.cornerRadius],
  }));
}

/** Capture supported native artwork through Figma's own flattening. Temporary
 * shapes are page-level, never inserted into an auto-layout source parent.
 * Only detached data survives, and the original is checked after async reads. */
export function canCaptureNativeVectorSource(source: SceneNode): boolean {
  if (source.type === "VECTOR" && nativeVectorGeometrySupported(source)) return true;
  if (!isNativeVectorArtwork(source) || !solid(source.strokes) || !source.visible || source.opacity <= 0 ||
    source.effects.length || source.isMask ||
    source.width <= 0 || source.height <= 0 || !source.absoluteBoundingBox) return false;
  const regions = source.type === "VECTOR" ? source.vectorNetwork.regions : undefined;
  if (!solid(source.fills) && !(source.type === "VECTOR" && regions?.length &&
    regions.every(region => Array.isArray(region.fills) && solid(region.fills)))) return false;
  const strokes = source.strokes.filter(paint => paint.visible !== false && paint.opacity !== 0);
  if (strokes.length && source.type !== "VECTOR" && typeof source.strokeWeight !== "number" &&
    !("strokeTopWeight" in source && [source.strokeTopWeight, source.strokeRightWeight,
      source.strokeBottomWeight, source.strokeLeftWeight].every(Number.isFinite))) return false;
  if (source.type === "VECTOR" && (source.vectorNetwork.vertices.length > 8192 ||
    source.vectorNetwork.segments.length > 16384 || (regions?.length ?? 0) > 2048)) return false;
  if ((source.type === "POLYGON" || source.type === "STAR") &&
    source.pointCount * (source.type === "STAR" ? 2 : 1) > 8192) return false;
  // Native outlining owns dashed/multiple/inside/outside contours. Validate
  // the resolved filled geometry against the core budget after capture.
  return true;
}

export async function captureNativeVectorSource(
  source: SceneNode, host: CaptureHost, observe: (node: SceneNode) => void, diagnose?:NativeVectorCaptureObserver,
  options?:{outlineStroke?:boolean},
): Promise<NativeVectorGeometry | undefined> {
  const clips=nativeAncestorClips(source);
  if (source.type === "VECTOR" && nativeVectorGeometrySupported(source)&&
    !clips.length&&
    !(options?.outlineStroke&&source.strokes.some(p=>p.visible!==false&&p.opacity!==0))) return compactNativeVectorGeometry(snapshot(source));
  if (!isNativeVectorArtwork(source) || !canCaptureNativeVectorSource(source)) {diagnose?.({stage:"planning",reason:"unsupportedNativeSourceOrPlanningBudget",sourceNodeId:source.id});return undefined;}
  const original = nativeVectorArtworkFingerprint(source);
  const page = host.currentPage;
  const session = beginNativeTemporarySession();
  const track = <T extends SceneNode>(node: T): T => { session.track(node); observe(node); return node; };
  const validateRead = () => {
    session.assertActive();
    if (source.removed || host.currentPage !== page || nativeVectorArtworkFingerprint(source) !== original) {
      throw Error("Native vector source changed");
    }
  };
  try {
    const geometry = await captureNativeVectorLayer({ kind: "shape", node: source, ...(clips.length?{clips}:{}) }, host, page, track, undefined, validateRead,diagnose);
    validateRead();
    return geometry ?? undefined;
  } catch(error) {
    if(error instanceof NativeCaptureBasisError)diagnose?.({stage:"basis",reason:error.reason,sourceNodeId:source.id});
    throw error;
  } finally {
    try { session.cancel(); }
    finally { session.dispose(); }
  }
}

function snapshot(source: VectorNode): NativeVectorGeometry {
  const fills = Array.isArray(source.fills) ? capturedPaints(source.fills) : [];
  return { type: "VECTOR", width: source.width, height: source.height, visible: true,
    opacity: source.opacity, blendMode: source.blendMode, isMask: false, effects: [],
    absoluteBoundingBox: copy(source.absoluteBoundingBox), absoluteTransform: copy(source.absoluteTransform),
    vectorNetwork: capturedNetwork(source.vectorNetwork), fills, strokes: capturedPaints(source.strokes),
    strokeWeight: source.strokeWeight, strokeAlign: source.strokeAlign, strokeCap: source.strokeCap,
    strokeJoin: source.strokeJoin, strokeMiterLimit: source.strokeMiterLimit, dashPattern: copy(source.dashPattern ?? []),
    variableWidthStrokeProperties: copy(source.variableWidthStrokeProperties),
    complexStrokeProperties: copy(source.complexStrokeProperties) };
}

function solid(paints: readonly Paint[] | PluginAPI["mixed"] | undefined): paints is readonly Paint[] {
  return Array.isArray(paints) && paints.every(paint => paint.visible === false || paint.opacity === 0 || paint.type === "SOLID");
}
function copy<T>(value: T): T { return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T; }
import {beginNativeTemporarySession} from "./native-temporary-session";
