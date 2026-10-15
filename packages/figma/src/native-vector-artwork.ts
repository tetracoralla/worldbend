import {nativeOutlineInsideClip} from "./native-vector-clip-proof";
import {
  nativeVectorGeometrySupported,
  nativeVectorReadFingerprint,
  MAX_NATIVE_VECTOR_PARTS,
  type NativeVectorGeometry,
} from "./native-vector";
import { placeNativeCapture, prepareNativeCapturePlacement, restoreNativeStrokeOutlineParent, NativeCaptureBasisError } from "./native-vector-placement";
import {nativeAncestorClips,nativeAncestorClipState,type NativeClipFrame} from "./native-ancestor-clips";
import {compactNativeVectorGeometry,type NativeVectorCaptureObserver} from "./native-vector-capture";
import { capturedPaints, capturedNetwork, freezeClonePaints } from "./native-vector-paints";

/** Whole-artwork vector capture: one projected part per captured layer.

 * A Frame or Group becomes true projected native geometry by letting Figma
 * itself resolve each layer (text glyph outlines, shape corners, boolean
 * results, component renders) and handing every resolved network to the
 * shared core projection. This module never recomputes perspective itself; it
 * only packages detached geometry in paint order. */
export type ArtworkVectorSource = FrameNode | GroupNode | InstanceNode | ComponentNode | ComponentSetNode | TextNode | LineNode | BooleanOperationNode;

type TempShapeSource = RectangleNode | EllipseNode | PolygonNode | StarNode | VectorNode;
type CloneLeafSource = TextNode | LineNode | BooleanOperationNode;
type ArtworkFrame = NativeClipFrame;

export interface ArtworkVectorLayer {
  /** Frame fills sit below children; its border sits above them. */
  kind: "background" | "border" | "shape" | "clone";
  node: SceneNode;
  /** Actual clipping ancestors, outermost first. Native booleans own cropping. */
  clips?: ArtworkFrame[];
}

export type ArtworkHost = Pick<PluginAPI, "currentPage" | "createFrame" | "createRectangle" | "createEllipse" |
  "createPolygon" | "createStar" | "createVector" | "flatten" | "intersect" | "loadFontAsync"> &
  Partial<Pick<PluginAPI, "variables">>;

type ClipRect = { transform: Transform; width: number; height: number; inset: number };

/** Walked-node budget: the plan stays a bounded, read-only classification. */
const MAX_ARTWORK_VECTOR_NODES = 512;
// Protect bounded native outlining work before geometry exists. These are
// host-work admission, not glyph-count estimates: actual outlines share the
// canonical whole-job geometry/reference/byte budgets after every layer.
const MAX_ARTWORK_TEXT_CHARACTERS = 8192;
const MAX_ARTWORK_TEXT_TOTAL_CHARACTERS = 32768;
/** Bound host boolean work across the whole capture, before creating operands. */
const MAX_NATIVE_CROP_OPERATIONS = 64;
const MAX_NATIVE_CAPTURE_NODES = 1024;
type CropBudget = { remaining: number };

export function isArtworkVectorSource(source: SceneNode): source is ArtworkVectorSource {
  return ["FRAME","GROUP","INSTANCE","COMPONENT","COMPONENT_SET","TEXT","LINE","BOOLEAN_OPERATION"].includes(source.type);
}

function visiblePaints(paints: readonly Paint[] | PluginAPI["mixed"] | undefined): Paint[] {
  return Array.isArray(paints) ? paints.filter((paint) => paint.visible !== false && paint.opacity !== 0) : [];
}

function hasVisibleEffects(node: SceneNode): boolean {
  return "effects" in node && Array.isArray(node.effects) &&
    node.effects.some((effect) => effect.visible !== false);
}

/** Every paint this route re-attaches by index must stay solid; gradients and
 * images would also drift from the raster reference once geometry projects. */
function solidLayerPaints(node: SceneNode): boolean {
  if ("fills" in node && Array.isArray(node.fills) &&
    !node.fills.every((paint) => paint.visible === false || paint.opacity === 0 || paint.type === "SOLID")) return false;
  if ("strokes" in node && Array.isArray(node.strokes) &&
    !node.strokes.every((paint) => paint.visible === false || paint.opacity === 0 || paint.type === "SOLID")) return false;
  if (node.type === "VECTOR") {
    const regions = node.vectorNetwork.regions;
    if (regions && !regions.every((region) => !Array.isArray(region.fills) ||
      region.fills.every((paint) => paint.visible === false || paint.opacity === 0 || paint.type === "SOLID"))) return false;
  }
  return true;
}

/** Prove that a native crop cannot affect this layer; uncertain bounds crop. */
function boxInsideClip(node: SceneNode, clip: ClipRect): boolean {
  // Render bounds already include ancestor clipping in the real host. Using
  // them here would prove a crop unnecessary precisely because Figma cropped
  // the source. Logical bounds remain unclipped; glyph overhang and strokes
  // cannot be proved from that box, so they take the native intersection.
  if (node.type === "TEXT" || visiblePaints("strokes" in node ? node.strokes : []).length) return false;
  const box = node.absoluteBoundingBox;
  if (!box) return false;
  return nativeOutlineInsideClip(box,clip);
}

function frameClip(node: ArtworkFrame): ClipRect {
  return { transform: node.absoluteTransform, width: node.width, height: node.height,
    inset: Math.max(node.topLeftRadius ?? 0, node.topRightRadius ?? 0,
      node.bottomLeftRadius ?? 0, node.bottomRightRadius ?? 0) };
}

/** Container-level opacity or blending composites children as a unit; carried
 * per-part it would change overlaps, so such containers keep the HD route.
 * PASS_THROUGH is the host default for frames and groups, not a group blend. */
function containerComposited(node: FrameNode | GroupNode | InstanceNode | ComponentNode | ComponentSetNode): boolean {
  return node.opacity < 1 ||
    (node.blendMode !== "PASS_THROUGH" && node.blendMode !== "NORMAL") ||
    // NORMAL isolates descendant blending from artwork outside the container.
    // A flat part stack cannot retain that boundary; leave the whole artwork
    // on the appearance-preserving HD route when isolation matters.
    (node.blendMode === "NORMAL" && hasBlendedDescendant(node));
}

function hasBlendedDescendant(root: SceneNode): boolean {
  const pending: SceneNode[] = "children" in root ? [...root.children] : [];
  let visited = 0;
  while (pending.length) {
    if (++visited > MAX_ARTWORK_VECTOR_NODES) return true;
    const node = pending.pop()!;
    if (!node.visible || ("opacity" in node && node.opacity <= 0)) continue;
    if ("blendMode" in node && node.blendMode !== "NORMAL" && node.blendMode !== "PASS_THROUGH") return true;
    if ("children" in node) pending.push(...node.children);
  }
  return false;
}

interface PlanBudget {
  visited: number;
  textCharacters: number;
}

/** Mixed weights are transferable only when all four native side weights exist. */
function mixedStrokeWeight(node: SceneNode): boolean {
  return visiblePaints("strokes" in node ? node.strokes : []).length > 0 &&
    (!("strokeWeight" in node) || (typeof node.strokeWeight !== "number" &&
      !("strokeTopWeight" in node && [node.strokeTopWeight, node.strokeRightWeight,
        node.strokeBottomWeight, node.strokeLeftWeight].every(Number.isFinite))));
}

/**
 * Classify one whole-artwork source into capturable layers, paint order
 * first. Read-only: no temporary geometry, no clone, no async host call. Any
 * unsupported layer declines the whole capture — content is never silently
 * dropped from a published vector result.
 */
export function planArtworkVectorLayers(source: SceneNode): ArtworkVectorLayer[] | undefined {
  if (!isArtworkVectorSource(source) || !source.visible || source.opacity <= 0 ||
    ("isMask" in source && source.isMask) || hasVisibleEffects(source) || !solidLayerPaints(source) ||
    mixedStrokeWeight(source)) return undefined;
  const budget: PlanBudget = { visited: 0, textCharacters: 0 };
  const layers: ArtworkVectorLayer[] = [];
  const add = (kind: ArtworkVectorLayer["kind"], node: SceneNode, clips: ArtworkFrame[]) => {
    layers.push({ kind, node, ...(clips.length ? { clips: [...clips] } : {}) });
  };
  const walkNode = (node: SceneNode, clips: ArtworkFrame[]): boolean => {
    if (!node.visible || ("opacity" in node && node.opacity <= 0)) return true;
    if (("isMask" in node && node.isMask) || hasVisibleEffects(node) || !solidLayerPaints(node)) return false;
    if (node.type!=="VECTOR" && mixedStrokeWeight(node)) return false;
    if (node.type === "TEXT") {
      budget.textCharacters += node.characters.length;
      if (node.characters.length > MAX_ARTWORK_TEXT_CHARACTERS ||
        budget.textCharacters > MAX_ARTWORK_TEXT_TOTAL_CHARACTERS) return false;
    }
    switch (node.type) {
      case "FRAME":
      case "INSTANCE":
      case "COMPONENT":
      case "COMPONENT_SET":
      case "GROUP": {
        if (containerComposited(node)) return false;
        const nextClips = node.type !== "GROUP" && node.clipsContent ? [...clips, node] : clips;
        if (node.type !== "GROUP" && visiblePaints(node.fills).length > 0) {
          add("background", node, clips);
        }
        for (const child of node.children) {
          if (++budget.visited > MAX_ARTWORK_VECTOR_NODES || layers.length > MAX_NATIVE_VECTOR_PARTS) return false;
          if (!walkNode(child, nextClips)) return false;
        }
        if (node.type !== "GROUP" && visiblePaints(node.strokes).length > 0) add("border", node, clips);
        return true;
      }
      case "RECTANGLE":
      case "ELLIPSE":
      case "POLYGON":
      case "STAR":
      case "VECTOR":
        add("shape", node, clips);
        return true;
      case "TEXT":
      case "LINE":
      case "BOOLEAN_OPERATION":
        add("clone", node, clips);
        return true;
      default:
        return false;
    }
  };
  if(!walkNode(source,nativeAncestorClips(source)))return undefined;
  return layers.length > 0 && layers.length <= MAX_NATIVE_VECTOR_PARTS ? layers : undefined;
}

/**
 * Whole-artwork drift fingerprint: every layer fact that changes the captured
 * geometry, paints, stacking or world position. Bounds and absolute transforms
 * deliberately invalidate detached capture when the source or an ancestor moves. Read-only on the original subtree.
 */
export function artworkVectorFingerprint(source: SceneNode): string {
  if (!isArtworkVectorSource(source)) throw Error("Unsupported artwork vector source");
  return nativeVectorReadFingerprint(JSON.stringify({
    bounds: source.absoluteBoundingBox,
    ancestorClips: nativeAncestorClipState(source),
    root: layerFacts(source),
    children: "children" in source?source.children.map(layerFacts):[],
  }));
}

function layerFacts(node: SceneNode): Record<string, unknown> {
  const facts: Record<string, unknown> = {
    type: node.type, name: node.name, visible: node.visible,
    locked: node.locked, blendMode: "blendMode" in node ? node.blendMode : undefined,
    opacity: "opacity" in node ? node.opacity : undefined,
    effects: "effects" in node ? node.effects : undefined,
    isMask: "isMask" in node ? node.isMask : undefined,
    width: "width" in node ? node.width : undefined,
    height: "height" in node ? node.height : undefined,
    relativeTransform: "relativeTransform" in node ? node.relativeTransform : undefined,
    // A root/ancestor rotation can preserve its AABB and every local matrix.
    // Witness the actual containing-coordinate basis used by native capture,
    // including transparent Group/Boolean wrappers, not only their bounds.
    absoluteTransform: node.absoluteTransform,
    modes: node.resolvedVariableModes, variables: node.boundVariables,
  };
  if ("fills" in node) facts.fills = Array.isArray(node.fills) ? node.fills : "mixed";
  if ("strokes" in node) {
    facts.strokes = node.strokes;
    facts.strokeWeight = "strokeWeight" in node ? node.strokeWeight : undefined;
    facts.strokeAlign = "strokeAlign" in node ? node.strokeAlign : undefined;
    facts.strokeCap = "strokeCap" in node ? node.strokeCap : undefined;
    facts.strokeJoin = "strokeJoin" in node ? node.strokeJoin : undefined;
    facts.strokeMiterLimit = "strokeMiterLimit" in node ? node.strokeMiterLimit : undefined;
    facts.dashPattern = "dashPattern" in node ? node.dashPattern : undefined;
    if ("strokeTopWeight" in node) facts.sideWeights =
      [node.strokeTopWeight, node.strokeRightWeight, node.strokeBottomWeight, node.strokeLeftWeight];
  }
  if (node.type === "TEXT") {
    facts.characters = node.characters;
    facts.textSegments = node.getStyledTextSegments(["fontName", "fontSize", "fills", "letterSpacing",
      "lineHeight", "textDecoration", "textCase", "textStyleId"]);
    facts.textLayout = [node.textAlignHorizontal, node.textAlignVertical, node.paragraphSpacing,
      node.paragraphIndent, node.listSpacing, node.textAutoResize, node.textTruncation,
      node.maxLines, node.leadingTrim, node.hangingPunctuation, node.hangingList];
  }
  if (node.type === "VECTOR") {
    facts.vectorNetwork = node.vectorNetwork;
    facts.variableWidthStrokeProperties = node.variableWidthStrokeProperties;
    facts.complexStrokeProperties = node.complexStrokeProperties;
  }
  if ("topLeftRadius" in node) {
    facts.shape = [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius,
      node.bottomLeftRadius, node.cornerSmoothing];
  }
  if (node.type === "ELLIPSE") facts.shape = node.arcData;
  if (node.type === "STAR") facts.shape = [node.pointCount, node.innerRadius, node.cornerRadius];
  if (node.type === "POLYGON") facts.shape = [node.pointCount, node.cornerRadius];
  if ("clipsContent" in node) facts.clipsContent = node.clipsContent;
  if (node.type === "BOOLEAN_OPERATION") facts.booleanOperation = node.booleanOperation;
  if ("children" in node) facts.children = node.children.map(layerFacts);
  return facts;
}

/**
 * Availability probe used at selection time. Structure classifies without
 * document writes; missing fonts would freeze fallback glyph outlines as if
 * they were the intended type, so they keep the HD image route instead.
 */
export async function canCaptureArtworkVectorSource(
  source: SceneNode, host: Pick<PluginAPI, "loadFontAsync">,
): Promise<boolean> {
  const layers = planArtworkVectorLayers(source);
  if (!layers) return false;
  const fonts = new Map<string, FontName>();
  const collect = (node: SceneNode) => {
    if (node.type === "TEXT") {
      const add = (font: FontName) => fonts.set(`${font.family}\u0000${font.style}`, font);
      if (node.fontName === figma.mixed) {
        for (const segment of node.getStyledTextSegments(["fontName"])) add(segment.fontName);
      } else add(node.fontName);
    }
    if ("children" in node) node.children.forEach(collect);
  };
  for (const layer of layers) collect(layer.node);
  const results = await Promise.allSettled([...fonts.values()].map((font) => host.loadFontAsync(font)));
  return results.every((result) => result.status === "fulfilled");
}

/**
 * Capture every planned layer as detached host geometry, paint order first.
 * Temporary nodes preserve a legal empty local ancestry until native outlining
 * transfers the full basis into detached geometry. Strokes are outlined natively
 * and merged in native paint order, so each part keeps its layer's
 * compositing (one opacity, one blend). Every temporary node is removed
 * again; only detached data survives.
 */
export async function captureArtworkVectorGeometry(
  source: SceneNode, host: ArtworkHost, observe: (node: SceneNode) => void,
  diagnose?: NativeVectorCaptureObserver,
): Promise<NativeVectorGeometry[] | undefined> {
  const layers = planArtworkVectorLayers(source);
  if (!layers) { diagnose?.({stage:"planning",reason:"unsupportedArtworkOrPlanningBudget",sourceNodeId:source.id}); return undefined; }
  const page = host.currentPage;
  const rootFingerprint = artworkVectorFingerprint(source);
  const owned: SceneNode[] = [];
  const session = beginNativeTemporarySession();
  const cropBudget: CropBudget = { remaining: MAX_NATIVE_CROP_OPERATIONS };
  let preparedNodes=0;
  const track = <T extends SceneNode>(node: T): T => {
    owned.push(node);session.track(node);observe(node);
    if(++preparedNodes>MAX_NATIVE_CAPTURE_NODES){diagnose?.({stage:"outline",reason:"nativePreparationNodeBudget",sourceNodeId:source.id,observed:preparedNodes,maximum:MAX_NATIVE_CAPTURE_NODES});
      throw Error("Native vector preparation exceeds its node budget");}
    return node;
  };
  const validateRead = () => {
    session.assertActive();
    if (source.removed || host.currentPage !== page || artworkVectorFingerprint(source) !== rootFingerprint) {
      throw Error("Artwork vector source changed");
    }
  };
  try {
    const geometries: NativeVectorGeometry[] = [];
    let vertices=0,segments=0,regions=0,references=0;
    for (const layer of layers) {
      const start=owned.length;
      let geometry:NativeVectorGeometry|undefined|null;
      try { geometry=await captureNativeVectorLayer(layer, host, page, track, cropBudget, validateRead, diagnose); }
      finally { for(const node of owned.splice(start).reverse())if(!node.removed)node.remove(); }
      if (geometry === undefined) return undefined;
      if (geometry) {
        vertices+=geometry.vectorNetwork.vertices.length;segments+=geometry.vectorNetwork.segments.length;regions+=geometry.vectorNetwork.regions!.length;
        for(const region of geometry.vectorNetwork.regions!)for(const loop of region.loops)references+=loop.length;
        const over=[["inputVertices",vertices,8192],["inputSegments",segments,16384],["inputRegions",regions,2048],["inputLoopReferences",references,131072]] as const;
        const exceeded=over.find(([,observed,maximum])=>observed>maximum);
        if(exceeded){diagnose?.({stage:"geometry",reason:exceeded[0],sourceNodeId:source.id,observed:exceeded[1],maximum:exceeded[2]});return undefined;}
        geometries.push(geometry);
      }
      if (source.removed || host.currentPage !== page || artworkVectorFingerprint(source) !== rootFingerprint) {
        throw Error("Artwork vector source changed");
      }
    }
    return geometries.length ? geometries : undefined;
  } catch(error) {
    if(error instanceof NativeCaptureBasisError)diagnose?.({stage:"basis",reason:error.reason,sourceNodeId:source.id});
    throw error;
  } finally {
    // The registry also retains a layer's nodes when its per-layer cleanup
    // splice met an SDK error, and attempts every exact owned resource.
    try { session.cancel(); }
    finally { session.dispose(); }
  }
}

/**
 * Flatten one prepared page-level node's own fills, then merge any native
 * stroke outline in native paint order. Regions carrying a stroke paint keep
 * the publication's stroke-overflow exemption. Native flatten may merge a
 * same-painted fill with its stroke; that combined region also needs it.
 */
export async function captureNativeVectorLayer(
  layer: ArtworkVectorLayer, host: ArtworkHost, page: PageNode,
  track: <T extends SceneNode>(node: T) => T,
  cropBudget: CropBudget = { remaining: MAX_NATIVE_CROP_OPERATIONS },
  validateRead: () => void = () => {},
  diagnose?:NativeVectorCaptureObserver,
): Promise<NativeVectorGeometry | undefined | null> {
  const original = layer.node;
  const refuse=(stage:"outline"|"clip"|"geometry",reason:string,observed?:number,maximum?:number)=>{
    diagnose?.({stage,reason,sourceNodeId:original.id,...(observed===undefined?{}:{observed}),...(maximum===undefined?{}:{maximum})});
    return undefined;
  };
  let ancestry:FrameNode[]=[];
  if (original.removed) return undefined;
  const logicalBox = original.absoluteBoundingBox;
  const box = logicalBox && logicalBox.width > 0 && logicalBox.height > 0
    ? logicalBox : ("absoluteRenderBounds" in original ? original.absoluteRenderBounds : null);
  if (!box || box.width <= 0 || box.height <= 0) return undefined;
  const strokePaints = layer.kind !== "background" && "strokes" in original ? capturedPaints(visiblePaints(original.strokes)) : [];
  if (original.type!=="VECTOR" && mixedStrokeWeight(original)) {
    return undefined;
  }
  let working: DefaultShapeMixin & SceneNode;
  let textOutlined = false;
  if (layer.kind === "background" || layer.kind === "border") {
    const frame = original as ArtworkFrame;
    const rect = track(host.createRectangle());
    rect.visible = false;
    rect.resize(frame.width, frame.height);
    rect.topLeftRadius = frame.topLeftRadius ?? 0; rect.topRightRadius = frame.topRightRadius ?? 0;
    rect.bottomLeftRadius = frame.bottomLeftRadius ?? 0; rect.bottomRightRadius = frame.bottomRightRadius ?? 0;
    rect.cornerSmoothing = frame.cornerSmoothing ?? 0;
    ancestry=placeNativeCapture(rect,frame,host,track);
    rect.fills = layer.kind === "background" && Array.isArray(frame.fills) ? capturedPaints(frame.fills) : [];
    rect.strokes = [];
    if (layer.kind === "border") copyStrokeProps(rect, frame);
    working = rect;
  } else if (layer.kind === "shape") {
    if(original.type==="VECTOR") {
      const modes=await captureModes(original,host,validateRead);
      const prepared=prepareNativeCapturePlacement(original,host,track);
      const clone=track(original.clone());
      for(const [collection,mode] of modes)clone.setExplicitVariableModeForCollection(collection,mode);
      prepared.place(clone); ancestry=prepared.ancestors;
      await freezeClonePaints(original,clone);validateRead();working=clone;
    } else {
      working = await createTempShape(original as TempShapeSource, host, track);
      ancestry=placeNativeCapture(working,original,host,track);
    }
    working.visible = false;
    if (original.type !== "VECTOR" && Array.isArray((original as TempShapeSource).fills)) {
      working.fills = capturedPaints((original as TempShapeSource).fills as readonly Paint[]);
    }
    if(original.type!=="VECTOR")copyStrokeProps(working, original as TempShapeSource);
  } else {
    const node = original as CloneLeafSource;
    // Resolve collections before cloning, so an await never leaves a new
    // child inside the source's auto-layout. Retain inherited font/content
    // modes while the host outlines text; current fonts are already loaded.
    const modes=await captureModes(original,host,validateRead);
    const prepared=prepareNativeCapturePlacement(original,host,track);
    const clone = track(node.clone()) as DefaultShapeMixin & SceneNode;
    for (const [collection, mode] of modes) clone.setExplicitVariableModeForCollection(collection, mode);
    prepared.place(clone); ancestry=prepared.ancestors;
    // Leave the source parent synchronously so an auto-layout frame never
    // relayouts around the clone.
    clone.visible = false;
    await freezeClonePaints(original, clone);
    working = clone;
    textOutlined = containsVisibleText(node);
  }
  validateRead();
  const layerOpacity = "opacity" in original && typeof original.opacity === "number" ? original.opacity : 1;
  const layerBlend = "blendMode" in original && typeof original.blendMode === "string"
    ? original.blendMode as BlendMode : "NORMAL";
  // Flatten reads geometry only; normalize compositing and re-apply the
  // layer's own opacity/blend once to the detached result.
  working.opacity = 1;
  working.blendMode = "NORMAL";
  ancestry.forEach(frame=>{frame.visible=true;});
  working.visible = true;
  const strokes = Array.isArray(working.strokes)
    ? working.strokes.filter((paint) => paint.visible !== false && paint.opacity !== 0)
    : [];
  let outline = strokes.length > 0 ? working.outlineStroke() : null;
  if (strokes.length > 0 && !outline) return refuse("outline","nativeStrokeOutlineUnavailable");
  if (outline) {
    track(outline);
    restoreNativeStrokeOutlineParent(outline,working,page);
    working.strokes = [];
    // Only now does the outline have the working leaf's legal local ancestry.
    outline=track(host.flatten([outline],page));
  }
  const hasFills = (Array.isArray(working.fills) && visiblePaints(working.fills).length > 0) ||
    working.fills === figma.mixed || (layer.kind === "clone" && "children" in working);
  if (!hasFills && !outline) return refuse("outline","noResolvedPaintedContours");
  const flatFills = hasFills ? track(host.flatten([working], page)) : null;
  if (flatFills && flatFills.type !== "VECTOR") return undefined;
  let merged: VectorNode;
  if (flatFills && outline) {
    // flatten(nodes, parent) follows document stacking, not argument order.
    // Flattening the fill can move it above the already-created outline;
    // explicitly restore the source stroke above its fill before merging.
    page.appendChild(outline);
    merged = track(host.flatten([flatFills, outline], page));
  }
  else merged = (flatFills ?? outline)!;
  if (merged.type !== "VECTOR") return undefined;
  // Only a fresh page-level resolved fill bound can discharge original clips.
  // Ancestor-clipped source renderBounds are never a no-op certificate.
  const clips=layer.clips?.filter(frame=>merged.parent!==page||merged.isMask||
    hasVisibleEffects(merged)||visiblePaints(merged.strokes).length>0||!boxInsideClip(merged,frameClip(frame)))??[];
  if (clips.length) {
    const network = merged.vectorNetwork;
    if (network.vertices.length > 8192 || network.segments.length > 16384 || !network.regions)
      return refuse("clip","nativeCropInputGeometryBudget");
    const cropped = await cropNativeRegions(merged, clips, host, page, track, validateRead,cropBudget,diagnose);
    if (!cropped) return null; // Every painted region was genuinely clipped away.
    merged = cropped;
  }
  const geometry: NativeVectorGeometry = {
    ...snapshot(merged),
    opacity: layerOpacity,
    blendMode: layerBlend,
    absoluteBoundingBox: copy(box),
    ...(textOutlined ? { nativeTextOutlined: true } : {}),
    ...(outline ? { nativeStrokeOutlined: true } : {}),
    ...strokeOutlineRegions(merged, strokePaints),
  };
  return nativeVectorGeometrySupported(geometry) ? compactNativeVectorGeometry(geometry) : refuse("geometry","resolvedGeometryOrAppearanceAdmission",geometry.vectorNetwork.vertices.length,8192);
}

/** Figma flatten ignores Frame cropping. Intersect each region separately and
 * explicitly restore its paints (a Boolean's default fill is unrelated). Then
 * merge the cropped regions into one layer, retaining opacity/blending once.
 * Only native host operations change contours; adapters remap indices, never
 * implement clipping or transform geometry. */
async function cropNativeRegions(
  source: VectorNode, clips: ArtworkFrame[], host: ArtworkHost, page: PageNode,
  track: <T extends SceneNode>(node: T) => T,
  validateRead: () => void,
  cropBudget:CropBudget,
  diagnose?:NativeVectorCaptureObserver,
): Promise<VectorNode | null> {
  const parts: VectorNode[] = [];
  const network = source.vectorNetwork;
  const transform = copy(source.absoluteTransform);
  for (const region of network.regions ?? []) {
    const paints = region.fills ?? (Array.isArray(source.fills) ? source.fills : []);
    if (!visiblePaints(paints).length) continue;
    const content = track(host.createVector());
    content.visible = false; content.strokes = []; content.fills = copy(paints);
    // The host normalizes each region's vertices and shifts the node while
    // assigning a network. Set its basis first and retain that native shift;
    // overwriting it afterward collapses separate glyphs/regions together.
    content.relativeTransform = transform;
    await content.setVectorNetworkAsync(regionNetwork(network, region));
    validateRead();
    content.visible = true;
    let cropped: SceneNode = content;
    let empty = false;
    for (const frame of clips) {
      // A compound text's whole bounds can cross a clip although most glyph
      // regions are strictly inside. Use each fresh native region's actual
      // unclipped bounds before charging only the necessary Boolean work.
      if(cropped.type==="VECTOR"&&cropped.parent===page&&nativeOutlineInsideClip(cropped,frameClip(frame)))continue;
      if(cropBudget.remaining<=0){diagnose?.({stage:"clip",reason:"nativeCropBudget",sourceNodeId:source.id,observed:MAX_NATIVE_CROP_OPERATIONS+1,maximum:MAX_NATIVE_CROP_OPERATIONS});
        throw Error("E_FIGMA_LIMIT: native Vector crop work exceeds its budget");}
      cropBudget.remaining--;
      const mask = track(host.createRectangle());
      mask.visible = false; mask.resize(frame.width, frame.height);
      mask.topLeftRadius = frame.topLeftRadius ?? 0; mask.topRightRadius = frame.topRightRadius ?? 0;
      mask.bottomLeftRadius = frame.bottomLeftRadius ?? 0; mask.bottomRightRadius = frame.bottomRightRadius ?? 0;
      mask.cornerSmoothing = frame.cornerSmoothing ?? 0;
      mask.strokes = []; mask.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      const ancestry=placeNativeCapture(mask,frame,host,track); ancestry.forEach(node=>{node.visible=true;});mask.visible = true;
      const maskOutline=track(host.flatten([mask],page));
      const intersection: BooleanOperationNode = track(host.intersect([cropped, maskOutline], page));
      intersection.fills = copy(paints); intersection.strokes = [];
      // Empty native intersections cannot be flattened. Detect actual empty
      // contours, not their operand bounding box (which can still be large).
      if (intersection.fillGeometry.length === 0) { empty = true; break; }
      cropped = intersection;
    }
    if (!empty) parts.push(track(host.flatten([cropped], page)));
  }
  return parts.length ? track(host.flatten(parts, page)) : null;
}

/** One region including all its hole contours, with compact host indices. */
function regionNetwork(network: VectorNetwork, region: VectorRegion): VectorNetwork {
  const segmentIds = [...new Set(region.loops.flat())];
  const vertexIds = [...new Set(segmentIds.flatMap(index =>
    [network.segments[index]!.start, network.segments[index]!.end]))];
  const segments = new Map(segmentIds.map((index, next) => [index, next]));
  const vertices = new Map(vertexIds.map((index, next) => [index, next]));
  return {
    vertices: vertexIds.map(index => copy(network.vertices[index]!)),
    segments: segmentIds.map(index => ({ ...copy(network.segments[index]!),
      start: vertices.get(network.segments[index]!.start)!, end: vertices.get(network.segments[index]!.end)! })),
    regions: [{ ...copy(region), loops: region.loops.map(loop => loop.map(index => segments.get(index)!)) }],
  };
}

function containsVisibleText(node: SceneNode): boolean {
  if (!node.visible || ("opacity" in node && node.opacity <= 0)) return false;
  return node.type === "TEXT" || ("children" in node && node.children.some(containsVisibleText));
}

/** Per-region stroke-paint classification, independent of native merge order.
 * A same-painted fill can merge with its stroke; exempt that combined region
 * too, otherwise an ordinary matching outside border becomes unpublishable.
 * Regions with unrelated or missing paints remain subject to the fit check. */
function strokeOutlineRegions(
  merged: VectorNode, strokePaints: Paint[],
): { nativeStrokeOutlineRegions?: boolean[] } {
  const regions = merged.vectorNetwork.regions;
  if (!regions?.length || !strokePaints.length) return {};
  const paintKey = (paint: Paint) => JSON.stringify(paint);
  const strokeKeys = new Set(strokePaints.map(paintKey));
  const flags = regions.map((region) => {
    const keys = (Array.isArray(region.fills) ? region.fills : []).map(paintKey);
    return keys.length > 0 && keys.every((key) => strokeKeys.has(key));
  });
  return flags.some((flag) => flag) ? { nativeStrokeOutlineRegions: flags } : {};
}

function copyStrokeProps(target: GeometryMixin & SceneNode, source: GeometryMixin & SceneNode): void {
  // Fresh native Vectors carry a default stroke. An unstroked source must
  // clear it too, before native flattening can turn it into visible outlines.
  target.strokes = [];
  if (!Array.isArray(source.strokes) || visiblePaints(source.strokes).length === 0) return;
  target.strokes = capturedPaints(source.strokes);
  if (typeof source.strokeWeight === "number") target.strokeWeight = source.strokeWeight;
  else if ("strokeTopWeight" in source && "strokeTopWeight" in target) {
    target.strokeTopWeight = source.strokeTopWeight; target.strokeRightWeight = source.strokeRightWeight;
    target.strokeBottomWeight = source.strokeBottomWeight; target.strokeLeftWeight = source.strokeLeftWeight;
  }
  if (typeof source.strokeAlign === "string") target.strokeAlign = source.strokeAlign;
  if (typeof source.strokeCap === "string") target.strokeCap = source.strokeCap;
  if (typeof source.strokeJoin === "string") target.strokeJoin = source.strokeJoin;
  target.strokeMiterLimit = source.strokeMiterLimit;
  if (Array.isArray(source.dashPattern)) target.dashPattern = copy(source.dashPattern);
}

/** Page-level temporary shape with the layer's native parameters, mirroring
 * the single-source capture; the original is never mutated. */
async function createTempShape(
  source: TempShapeSource, host: ArtworkHost, track: <T extends SceneNode>(node: T) => T,
): Promise<DefaultShapeMixin & SceneNode> {
  const temporary = track(source.type === "VECTOR" ? host.createVector()
    : source.type === "RECTANGLE" ? host.createRectangle()
    : source.type === "ELLIPSE" ? host.createEllipse()
    : source.type === "POLYGON" ? host.createPolygon() : host.createStar());
  if (source.type === "VECTOR" && temporary.type === "VECTOR") {
    // Enable fills before assigning region overrides. New native Vectors have
    // an empty fill switch; writing only region paints leaves them invisible.
    const regionPaint = source.vectorNetwork.regions?.flatMap(region => region.fills ?? [])
      .find(paint => paint.visible !== false && paint.opacity !== 0);
    temporary.fills = Array.isArray(source.fills) && source.fills.length
      ? capturedPaints(source.fills) : regionPaint ? capturedPaints([regionPaint]) : [];
    await temporary.setVectorNetworkAsync(capturedNetwork(source.vectorNetwork));
  } else if (source.type !== "VECTOR" && temporary.type !== "VECTOR") {
    temporary.resize(source.width, source.height);
    if (source.type === "RECTANGLE" && temporary.type === "RECTANGLE") {
      temporary.topLeftRadius = source.topLeftRadius; temporary.topRightRadius = source.topRightRadius;
      temporary.bottomRightRadius = source.bottomRightRadius; temporary.bottomLeftRadius = source.bottomLeftRadius;
      temporary.cornerSmoothing = source.cornerSmoothing;
    } else if (source.type === "ELLIPSE" && temporary.type === "ELLIPSE") temporary.arcData = copy(source.arcData);
    else if ((source.type === "POLYGON" && temporary.type === "POLYGON") ||
      (source.type === "STAR" && temporary.type === "STAR")) {
      temporary.pointCount = source.pointCount; temporary.cornerRadius = source.cornerRadius;
      if (source.type === "STAR" && temporary.type === "STAR") temporary.innerRadius = source.innerRadius;
    }
  }
  return temporary as DefaultShapeMixin & SceneNode;
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

function copy<T>(value: T): T { return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T; }

async function captureModes(source:SceneNode,host:ArtworkHost,validate:()=>void):Promise<[VariableCollection,string][]> {
  const modes:[VariableCollection,string][]=[];
  for(const [id,mode] of Object.entries(source.resolvedVariableModes??{})) {
    const collection=await host.variables?.getVariableCollectionByIdAsync(id);validate();
    if(!collection)throw Error("Native capture variable collection unavailable");
    modes.push([collection,mode]);
  }
  return modes;
}
import {beginNativeTemporarySession} from "./native-temporary-session";
