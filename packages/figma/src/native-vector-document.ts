import {nativeVectorSourceViewMatches} from "./source-raster";
import {vectorCaptureStorage,clearVectorCaptureStorage,restoreVectorCaptureStorage,type VectorCaptureStorage} from "./vector-capture-storage";
import type { NineNumbers, TransformSpec, VectorProjectionOutput } from "@worldbend/web/types";
import type { Placement } from "./messages";
import { capturedPaints } from "./native-vector-paints";
import { readStoredBinding, writeStoredBinding } from "./stored-binding";
import {readStoredOperationSlots, restoreStoredOperationSlots, writeStoredOperation,type StoredOperation } from "./stored-operation";
import {isNativeVectorExecutionFrame,nativeVectorOperationDigest,resolveNativeVectorOperation,readNativeVectorStoredOperation} from "./native-vector-operation";
import { SHARED_NAMESPACE, parseOwnedTransformSpec } from "./stored-plane";
import {
  nativeVectorGeometrySupported,
  MAX_NATIVE_VECTOR_PARTS,
  nativeVectorFingerprint,
  nativeVectorReadFingerprint,
  readNativeVectorProjection,
  readCopiedNativeVectorProjection,
  serializeNativeVectorProjection,
  SHARED_NATIVE_VECTOR_KEY,
  type NativeVectorProjection,
  type NativeVectorGeometry,
  type NativeVectorSourceView,
} from "./native-vector";
import { nativeVectorArtworkFingerprint } from "./native-vector-source";
import { artworkVectorFingerprint, isArtworkVectorSource } from "./native-vector-artwork";
import {isValidVectorArtworkOutputs,type NativeVectorFidelity} from "./native-vector-guard";
import { coordinateParent } from "./coordinate-parent";
import {sameJsonValue} from "./json-value";
import {nativeVectorSourceView} from "./source-raster";
import {assertIndependentVectorSource} from "./native-vector-dependency";

export class NativeVectorRollbackIncompleteError extends Error {}

export interface NativeVectorPublicationPart {
  geometry: NativeVectorGeometry;
  projection: VectorProjectionOutput;
}

export async function nativeVectorDocumentParts(result: FrameNode): Promise<{
  record: NativeVectorProjection;
  contents: VectorNode[];
  spec: TransformSpec;
  operation:StoredOperation;
  binding: NonNullable<ReturnType<typeof readStoredBinding>>;
  copied: boolean;
}> {
  const initialTarget=publicationTargetFingerprint(result);
  const record = readNativeVectorProjection(result) ?? readCopiedNativeVectorProjection(result);
  if (!record) throw new Error("Invalid native vector record");
  const copied = record.resultNodeId !== result.id;
  const slots = readStoredOperationSlots(result);
  const operation=readNativeVectorStoredOperation(result);
  if(!operation)throw Error("Native vector operation changed");
  const resolved=resolveNativeVectorOperation(operation);
  const authoredClip=resolved.core.kind==="deformationWork"&&Boolean(resolved.core.spec.shapeFit?.clip);
  const spec=resolved.plane;
  const binding = readStoredBinding(copied ? { id: record.resultNodeId,
    getSharedPluginData: (namespace, key) => result.getSharedPluginData(namespace, key) } : result);
  const close = (left: number, right: number) => Math.abs(left - right) <= Math.max(1e-4, Math.abs(right) * 1e-6);
  if (result.fills === figma.mixed || hasPaints(result.fills) || result.clipsContent ||
    hasPaints(result.strokes) || hasPaints(result.effects) ||
    result.opacity !== 1 || result.blendMode !== "PASS_THROUGH" || result.layoutMode !== "NONE" ||
    !unitTranslation(result.relativeTransform) || !unitTranslation(result.absoluteTransform) ||
    !close(result.width, record.outputSize.width) || !close(result.height, record.outputSize.height) ||
    (record.version==="0.3"?(nativeVectorOperationDigest(operation)!==record.operation||
      !record.sourceNodeIds||JSON.stringify(binding?.sourceNodeIds)!==JSON.stringify(record.sourceNodeIds)||
      record.sourceNodeIds.length!==resolved.sourceCount||record.sourceNodeIds[resolved.artworkSourceIndex]!==record.sourceNodeId):
      (slots.rectification||slots.canvas||slots.task||JSON.stringify(spec)!==record.operation||binding?.sourceNodeIds.length!==1||binding.sourceNodeIds[0]!==record.sourceNodeId))||
    !binding||record.sourceNodeId === result.id ||
    (record.version==="0.3"&&(record.parts.filter(p=>p.role==="clip").length!==(authoredClip?1:0)||
      (authoredClip&&record.parts[0]?.role!=="clip")))||
    result.children.length !== record.parts.length) {
    throw new Error("Native vector result changed");
  }
  const contents: VectorNode[] = [];
  for (let index = 0; index < record.parts.length; index += 1) {
    const content = copied ? result.children[index]
      : await figma.getNodeByIdAsync(record.parts[index]!.contentNodeId);
    if (content?.type !== "VECTOR" || content.parent?.id !== result.id ||
      result.children[index]?.id !== content.id ||
      (copied && record.parts.some(part => part.contentNodeId === content.id)) ||
      nativeVectorFingerprint(content) !== record.parts[index]!.fingerprint) {
      throw new Error("Native vector result changed");
    }
    if(record.version==="0.3"&&(Boolean(content.isMask)!==(record.parts[index]!.role==="clip")||
      (record.parts[index]!.role==="clip"&&content.maskType!=="VECTOR")))throw Error("Native vector mask changed");
    contents.push(content);
  }
  if(result.removed||publicationTargetFingerprint(result)!==initialTarget)throw new Error("E_FIGMA_CONFLICT: Native vector result changed during read; reread");
  return { record, contents, spec, operation,binding, copied };
}

/**
 * Publish core-projected native Vectors inside one stable Figma Frame, one
 * child per captured layer in paint order. The projections themselves were
 * resolved by the shared core; this carrier step only places each part's
 * geometry, re-attaches its paints, and records the combined fidelity the
 * core reported. A single part keeps the legacy single-content 0.1 record so
 * existing results stay byte-compatible.
 */
export async function publishNativeVectorResult(input: {
  source: SceneNode;
  geometry?: NativeVectorGeometry;
  existing?: FrameNode;
  /** An owned empty Agent candidate, validated by its caller at publication. */
  unpublished?: FrameNode;
  spec: TransformSpec;
  operation?:StoredOperation;
  operationExpected?:string;
  sourceNodeIds?:string[];
  sourceView?:NativeVectorSourceView;
  executionFrame?: import("./native-vector-operation").NativeVectorExecutionFrame;
  clip?:VectorProjectionOutput;
  matrix: NineNumbers;
  projection?: VectorProjectionOutput;
  parts?: NativeVectorPublicationPart[];
  placement: Placement;
  renderWidth: number;
  renderHeight: number;
  beforeWrite?: () => void;
  validateWrite?: () => void;
}): Promise<FrameNode> {
  const resultId=input.existing?.id??input.unpublished?.id??"";
  assertIndependentVectorSource(input.source,resultId);
  // Back-compat entry: a bare VECTOR source is its own capture geometry.
  const inlineGeometry = input.geometry ??
    (input.source.type === "VECTOR" ? input.source as unknown as NativeVectorGeometry : undefined);
  const parts: NativeVectorPublicationPart[] = input.parts ??
    (inlineGeometry && input.projection ? [{ geometry: inlineGeometry, projection: input.projection }] : []);
  const operation=input.operation??{kind:"transform" as const,spec:input.spec},resolved=resolveNativeVectorOperation(operation);
  const modern=Boolean(input.operation)||Boolean(input.spec.content.warp);
  const authoredClip=resolved.core.kind==="deformationWork"&&Boolean(resolved.core.spec.shapeFit?.clip);
  const sourceNodeIds=input.sourceNodeIds??[input.source.id];
  const frame = input.executionFrame;
  const validExecutionFrame = !frame || (isNativeVectorExecutionFrame(frame) && resolved.core.kind === "deformationWork" &&
    resolved.core.spec.boundary === "free" && (frame.transform.content.orientation ?? "native") === (resolved.plane.content.orientation ?? "native") &&
    frame.transform.content.fit === resolved.plane.content.fit && frame.transform.content.warp === undefined &&
    frame.reference.width === input.renderWidth && frame.reference.height === input.renderHeight);
  if (parts.length < 1 || parts.length > MAX_NATIVE_VECTOR_PARTS || (input.existing && input.unpublished) ||
    sourceNodeIds.length!==resolved.sourceCount||sourceNodeIds[resolved.artworkSourceIndex]!==input.source.id||
    !sameJsonValue(input.spec,resolved.plane)||
    (input.operationExpected!==undefined&&input.operationExpected!==nativeVectorOperationDigest(operation))||
    (modern&&!input.sourceView)||Boolean(input.clip)!==authoredClip||
    (input.sourceView&&!nativeVectorSourceViewMatches(input.source,input.sourceView))||
    !validExecutionFrame || !matrixMatchesSpec(input.matrix, frame?.transform ?? input.spec, input.renderWidth, input.renderHeight) ||
    ![input.placement.width, input.placement.height, input.renderWidth, input.renderHeight]
      .every((value) => Number.isFinite(value) && value > 0 && value <= 4096) ||
    !isValidVectorArtworkOutputs([...(input.clip?[input.clip]:[]),...parts.map(part=>part.projection)])||
    !parts.every((part) => nativeVectorGeometrySupported(part.geometry)&&
      part.projection.report.inputVertices===part.geometry.vectorNetwork.vertices.length&&
      part.projection.report.inputSegments===part.geometry.vectorNetwork.segments.length&&
      part.projection.report.inputRegions===part.geometry.vectorNetwork.regions!.length)) {
    throw new Error("Unsupported native vector publication");
  }
  const dependencySources:SceneNode[]=[input.source];
  for(const id of sourceNodeIds.filter(id=>id!==input.source.id)){
    const source=await figma.getNodeByIdAsync(id);
    if(!source||!("visible" in source)||source.removed)throw Error("Native vector source role unavailable");
    dependencySources.push(source as SceneNode);
  }
  const validateDependencies=()=>{for(const source of dependencySources){
    if(source.removed)throw Error("Native vector source role unavailable");
    assertIndependentVectorSource(source,resultId);
  }};
  validateDependencies();
  let inputReferences=0;
  for(const part of parts)for(const region of part.geometry.vectorNetwork.regions!)for(const loop of region.loops)inputReferences+=loop.length;
  if(inputReferences>131072)throw Error("Native vector artwork exceeds its input reference budget");
  for (const part of parts) {
    if (!partGeometryFitsResult(part, input.placement)) {
      throw new Error(`Native vector projection exceeds its result bounds: ${JSON.stringify(part.projection.bounds)} within ${input.placement.width} x ${input.placement.height}`);
    }
  }
  const sourceFingerprint = sourceFingerprintOf(input.source);
  const session = beginNativeTemporarySession();
  try {
  const existingParts = input.existing ? await nativeVectorDocumentParts(input.existing) : undefined;
  session.assertActive();
  if (input.source.removed || sourceFingerprintOf(input.source) !== sourceFingerprint) {
    throw new Error("Native vector source changed");
  }
  const target = input.existing ?? input.unpublished;
  if (input.unpublished && (input.unpublished.children.length ||
    input.unpublished.getSharedPluginData(SHARED_NAMESPACE, SHARED_NATIVE_VECTOR_KEY))) {
    throw new Error("Native vector candidate changed");
  }
  const initialTarget = target && publicationTargetFingerprint(target);
  let result: FrameNode | undefined;
  let committed = false;
  let previous: {width:number;height:number;x:number;y:number;slots:ReturnType<typeof readStoredOperationSlots>;binding:string;record:string;pending:string;capture:VectorCaptureStorage} | undefined;
  const contents: VectorNode[] = [];
  try {
    // Prepare hidden page-level Vectors while the published result is intact.
    // The host's async path writes must not expose candidates or roll a later
    // native edit back to an earlier size/binding on failure.
    const rendered:Array<{projection:VectorProjectionOutput;geometry?:NativeVectorGeometry;role?:"clip"}>=[
      ...(input.clip?[{projection:input.clip,role:"clip" as const}]:[]),...parts];
    for (const [index, part] of rendered.entries()) {
      const projected = part.projection;
      const offset = { x: projected.bounds.x, y: projected.bounds.y };
      const sourceRegions = part.geometry?.vectorNetwork.regions ?? [];
      const strokePaint = part.geometry?visibleStrokePaint(part.geometry):undefined;
      const network = {
        vertices: projected.network.vertices.map((vertex) => ({
          x: vertex.x - offset.x,
          y: vertex.y - offset.y,
        })),
        segments: projected.network.segments.map((segment) => ({
          start: segment.start,
          end: segment.end,
          ...(segment.tangentStart ? { tangentStart: { ...segment.tangentStart } } : {}),
          ...(segment.tangentEnd ? { tangentEnd: { ...segment.tangentEnd } } : {}),
        })),
        regions: projected.network.regions.map((region, regionIndex) => {
          if (regionIndex < sourceRegions.length) {
            const fills = sourceRegions[regionIndex]?.fills;
            return {
              windingRule: region.windingRule,
              loops: region.loops.map((loop) => [...loop]),
              ...(fills ? { fills: capturedPaints(fills) } : {}),
            };
          }
          return {
            windingRule: region.windingRule,
            loops: region.loops.map((loop) => [...loop]),
            ...(part.role==="clip"?{fills:[{type:"SOLID" as const,color:{r:0,g:0,b:0}}]}:strokePaint ? { fills: capturedPaints([strokePaint]) } : {}),
          };
        }),
      };
      const content = figma.createVector();
      // Track the child before the async write so rollback always removes a
      // half-written part.
      contents.push(content);
      session.track(content);
      content.visible = false;
      content.name = `Worldbend vector preparation ${index + 1}`;
      content.relativeTransform = [[1, 0, 0], [0, 1, 0]];
      content.constraints = { horizontal: "MIN", vertical: "MIN" };
      // Figma keeps the node-level fill switch even when a network supplies
      // explicit region paints. An empty base disables every region on export.
      // Seed one real paint before the network write; explicit region paints
      // then retain their own colors (including empty/unpainted regions).
      const baseFills = part.geometry&&Array.isArray(part.geometry.fills) ? part.geometry.fills : [];
      const regionPaint = network.regions.flatMap(region => region.fills ?? [])
        .find(paint => paint.visible !== false && paint.opacity !== 0);
      content.fills = capturedPaints(baseFills.length ? baseFills : regionPaint ? [regionPaint] : []);
      content.opacity = part.geometry?.opacity??1; content.blendMode = part.geometry?.blendMode??"NORMAL";
      if(part.role==="clip"){content.isMask=true;content.maskType="VECTOR";}
      content.strokes = [];
      await content.setVectorNetworkAsync(network);
      session.assertActive();
      input.validateWrite?.();
      validateDependencies();
      if (input.source.removed || sourceFingerprintOf(input.source) !== sourceFingerprint) {
        throw new Error("Native vector source changed");
      }
    }

    if (target && (target.removed || publicationTargetFingerprint(target) !== initialTarget)) {
      throw new Error("Native vector result changed during preparation");
    }
    input.beforeWrite?.();
    validateDependencies();
    session.assertActive();
    // From here through the final metadata/child swap there is no host await.
    result = target ?? figma.createFrame();
    if (target) previous = { width: result.width, height: result.height, x: result.x, y: result.y,
      slots: readStoredOperationSlots(result), binding: result.getSharedPluginData(SHARED_NAMESPACE, "binding"),
      record: result.getSharedPluginData(SHARED_NAMESPACE, SHARED_NATIVE_VECTOR_KEY),pending:result.getSharedPluginData(SHARED_NAMESPACE,"vectorPending"),capture:vectorCaptureStorage(result) };
    committed = true;
    if (!target) {
      result.name = `${input.source.name} · Worldbend Vector`;
      result.fills = [];
      result.clipsContent = false;
    }
    result.resizeWithoutConstraints(input.placement.width, input.placement.height);
    positionResult(result, input.placement);
    contents.forEach((content,index) => {
      result!.appendChild(content);
      content.x = rendered[index]!.projection.bounds.x;
      content.y = rendered[index]!.projection.bounds.y;
      content.name = rendered[index]!.role==="clip"?"Clip":parts.length > 1 ? `Vector ${index + 1}` : "Vector";
      content.visible = true;
    });

    const record: NativeVectorProjection = {
      schema: "worldbend.figma.native-vector",
      version: modern?"0.3":parts.length > 1 ? "0.2" : "0.1",
      resultNodeId: result.id,
      sourceNodeId: input.source.id,
      outputSize: { width: result.width, height: result.height },
      placement: { ...input.placement, width: result.width, height: result.height },
      operation:modern?nativeVectorOperationDigest(operation):JSON.stringify(input.spec),
      ...(modern?{sourceNodeIds:[...sourceNodeIds],sourceView:input.sourceView}:{}),
      fidelity: combinedFidelity(rendered),
      parts: contents.map((content,index) => ({
        contentNodeId: content.id, fingerprint: nativeVectorFingerprint(content),
        ...(rendered[index]!.role?{role:rendered[index]!.role}:{}),
      })),
    };
    writeStoredOperation(result, operation);
    writeStoredBinding(result, {
      sourceNodeIds,
      // Binding axes are integer raster transport sizes. A modern work's
      // exact (possibly fractional) solve reference remains in its own task.
      renderWidth: Math.ceil(input.renderWidth),
      renderHeight: Math.ceil(input.renderHeight),
    });
    result.setSharedPluginData(SHARED_NAMESPACE, SHARED_NATIVE_VECTOR_KEY, serializeNativeVectorProjection(record));
    if(previous?.pending)result.setSharedPluginData(SHARED_NAMESPACE,"vectorPending","");
    if(previous)clearVectorCaptureStorage(result,previous.capture);
    if (!readNativeVectorProjection(result) ||
      contents.some((content, index) => nativeVectorFingerprint(content) !== record.parts[index]!.fingerprint)) {
      throw new Error("Native vector publication was not retained");
    }
    if (existingParts) {
      for (const oldContent of existingParts.contents) oldContent.remove();
      if (result.children.length !== contents.length ||
        contents.some((content, index) => result!.children[index]?.id !== content.id)) {
        throw new Error("Native vector child replacement failed");
      }
    }
    return result;
  } catch (error) {
    let incomplete = false;
    try {
      session.cancel();
      if (committed && result && !target) {
        result.remove();
      } else if (committed && result && previous) {
        // The replaced children are removed only after the new publication
        // fully validated; once any is gone, the previous result cannot be
        // restored and the host state must be reported as incomplete.
        if (existingParts && !existingParts.contents.every((content) =>
          result!.children.some((child) => child.id === content.id))) {
          incomplete = true;
        } else {
          result.resizeWithoutConstraints(previous.width, previous.height);
          result.x = previous.x;
          result.y = previous.y;
          restoreStoredOperationSlots(result, previous.slots);
          result.setSharedPluginData(SHARED_NAMESPACE, "binding", previous.binding);
          result.setSharedPluginData(SHARED_NAMESPACE, SHARED_NATIVE_VECTOR_KEY, previous.record);
          result.setSharedPluginData(SHARED_NAMESPACE,"vectorPending",previous.pending);
          restoreVectorCaptureStorage(result,previous.capture);
        }
      }
    } catch {
      incomplete = true;
    }
    if (incomplete) throw new NativeVectorRollbackIncompleteError("Native vector rollback incomplete");
    throw error;
  }
  } finally { session.dispose(); }
}

/**
 * The host returns an unpainted surface either as an empty paint array or as
 * one element without enumerable paint fields, and it may switch between the
 * two representations across publication-time reads. Both mean "no paint";
 * a genuine paint always carries enumerable fields, so real edits stay
 * detectable while the equivalent empty forms compare equal.
 */
/** Whether a paint list carries any real paint under the same equivalence. */
function hasPaints(paints: readonly unknown[] | symbol): boolean {
  return Array.isArray(paints) && paints.some((paint) => Object.keys(paint ?? {}).length > 0);
}

export function emptyPaints<T>(paints: readonly T[] | symbol): readonly T[] | symbol {
  return hasPaints(paints) ? paints : Array.isArray(paints) ? [] : paints;
}

/** Include the complete old result in the async guard, including independent
 * duplicate children and native parent/geometry/paint edits. */
export function publicationTargetFingerprint(result: FrameNode): string {
  return nativeVectorReadFingerprint(JSON.stringify({ parent: result.parent?.id, name: result.name,
    size: [result.width,result.height], transform: result.absoluteTransform, relative: result.relativeTransform,
    clips: result.clipsContent, layout: result.layoutMode, fills: emptyPaints(result.fills), strokes: emptyPaints(result.strokes),
    effects: emptyPaints(result.effects), opacity: result.opacity, blend: result.blendMode, visible: result.visible, locked: result.locked,
    slots: readStoredOperationSlots(result), binding: result.getSharedPluginData(SHARED_NAMESPACE,"binding"),
    record: result.getSharedPluginData(SHARED_NAMESPACE,SHARED_NATIVE_VECTOR_KEY),
    pending: result.getSharedPluginData(SHARED_NAMESPACE,"vectorPending"),
    creation: result.getSharedPluginData(SHARED_NAMESPACE,"vectorCreation"),
    children: result.children.map(node => [node.id,node.type,node.type === "VECTOR" ? nativeVectorFingerprint(node) : null]) }));
}

/** One part's fills must land inside the placement; stroke outlines may
 * overflow by design, exactly like core-expanded strokes. */
function partGeometryFitsResult(part: NativeVectorPublicationPart, placement: Placement): boolean {
  const exemptions = part.geometry.nativeStrokeOutlineRegions;
  return fillGeometryFitsResult(part.projection, placement, (index) => !(exemptions?.[index] ?? false) &&
    index < (part.geometry.vectorNetwork.regions?.length ?? 0));
}

/** Worst-case summary across parts: worst fidelity class, largest reported
 * error, ordered union of reasons, plus the carrier's own conversions. */
function combinedFidelity(parts: Array<{projection:VectorProjectionOutput;geometry?:NativeVectorGeometry}>): NativeVectorFidelity {
  const rank: Record<NativeVectorFidelity["class"], number> = { exact: 0, approximated: 1, outlined: 2 };
  let combined: NativeVectorFidelity["class"] = "exact";
  let maxError: number | undefined;
  const reasons: string[] = [];
  for (const part of parts) {
    const report = part.projection.report;
    const partClass: NativeVectorFidelity["class"] = part.geometry?.nativeStrokeOutlined || part.geometry?.nativeTextOutlined
      ? "outlined" : report.fidelity;
    if (rank[partClass] > rank[combined]) combined = partClass;
    if (typeof report.maxError === "number") maxError = Math.max(maxError ?? 0, report.maxError);
    for (const reason of report.reasons) if (!reasons.includes(reason)) reasons.push(reason);
    if (part.geometry?.nativeStrokeOutlined && !reasons.includes("strokeOutlined")) reasons.push("strokeOutlined");
    if (part.geometry?.nativeTextOutlined && !reasons.includes("textOutlined")) reasons.push("textOutlined");
  }
  return { class: combined, ...(maxError !== undefined ? { maxError } : {}), reasons };
}

function sourceFingerprintOf(source: SceneNode): string {
  return isArtworkVectorSource(source) ? artworkVectorFingerprint(source) : nativeVectorArtworkFingerprint(source);
}

function visibleStrokePaint(node: NativeVectorGeometry): Paint | undefined {
  const strokes = Array.isArray(node.strokes) ? node.strokes : [];
  const visible = strokes.filter((paint) => paint.visible !== false && paint.opacity !== 0);
  return visible.length === 1 && visible[0]!.type === "SOLID" ? visible[0] : undefined;
}

/**
 * The projected fill geometry must land inside the result placement. Stroke
 * outlines may overflow it by design: the source stroke already extends past
 * its own bounding box, and the result frame never clips its content. Each
 * curved boundary is checked at its analytic extrema, so a curve that bows
 * past its endpoints cannot slip through while harmless handles outside the
 * frame do not force an image fallback.
 */
function fillGeometryFitsResult(
  projection: VectorProjectionOutput,
  placement: Placement,
  checkRegion: (index: number) => boolean,
): boolean {
  const tolerance = Math.max(1e-4, Math.hypot(placement.width, placement.height) * 1e-6);
  const vertices = projection.network.vertices;
  const segments = projection.network.segments;
  for (const [index, region] of projection.network.regions.entries()) {
    if (!checkRegion(index)) continue;
    for (const loop of region.loops) {
      for (const segmentIndex of loop) {
        const segment = segments[segmentIndex]!;
        const start = vertices[segment.start]!;
        const end = vertices[segment.end]!;
        const x = [start.x, start.x + (segment.tangentStart?.x ?? 0),
          end.x + (segment.tangentEnd?.x ?? 0), end.x] as const;
        const y = [start.y, start.y + (segment.tangentStart?.y ?? 0),
          end.y + (segment.tangentEnd?.y ?? 0), end.y] as const;
        if (!cubicAxisFits(x, -tolerance, placement.width + tolerance) ||
          !cubicAxisFits(y, -tolerance, placement.height + tolerance)) return false;
      }
    }
  }
  return true;
}

function cubicAxisFits(
  control: readonly [number, number, number, number],
  minimum: number,
  maximum: number,
): boolean {
  const values = [control[0], control[3]];
  const a = -control[0] + 3 * control[1] - 3 * control[2] + control[3];
  const b = 2 * (control[0] - 2 * control[1] + control[2]);
  const c = control[1] - control[0];
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), 1);
  const epsilon = Number.EPSILON * 16 * scale;
  const candidates: number[] = [];
  if (Math.abs(a) <= epsilon) {
    if (Math.abs(b) > epsilon) candidates.push(-c / b);
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      candidates.push((-b - root) / (2 * a), (-b + root) / (2 * a));
    }
  }
  for (const t of candidates) {
    if (t <= 0 || t >= 1) continue;
    const u = 1 - t;
    values.push(u * u * u * control[0] + 3 * u * u * t * control[1] +
      3 * u * t * t * control[2] + t * t * t * control[3]);
  }
  return values.every((value) => value >= minimum && value <= maximum);
}

/** Refuse stale or fabricated UI geometry before it becomes durable Figma state. */
function matrixMatchesSpec(
  matrix: NineNumbers,
  spec: TransformSpec,
  width: number,
  height: number,
): boolean {
  const sourceCorners = spec.content.orientation === "flipHorizontal"
    ? [[1, 0], [0, 0], [0, 1], [1, 1]]
    : spec.content.orientation === "flipVertical"
      ? [[0, 1], [1, 1], [1, 0], [0, 0]]
      : spec.content.orientation === "flipBoth"
        ? [[1, 1], [0, 1], [0, 0], [1, 0]]
        : [[0, 0], [1, 0], [1, 1], [0, 1]];
  const destination = [spec.destination.quad.tl, spec.destination.quad.tr,
    spec.destination.quad.br, spec.destination.quad.bl];
  const reference = spec.destination.space === "pixel" ? spec.destination.reference : undefined;
  if (spec.destination.space === "pixel" && (!reference || reference.width <= 0 || reference.height <= 0)) return false;
  const scale = spec.destination.space === "pixel"
    ? { x: width / reference!.width, y: height / reference!.height }
    : { x: width, y: height };
  const tolerance = Math.max(1e-4, Math.hypot(width, height) * 1e-6);
  return sourceCorners.every(([x, y], index) => {
    const denominator = matrix[6] * x! + matrix[7] * y! + matrix[8];
    if (!Number.isFinite(denominator) || Math.abs(denominator) <= Number.EPSILON) return false;
    const actual = {
      x: (matrix[0] * x! + matrix[1] * y! + matrix[2]) / denominator,
      y: (matrix[3] * x! + matrix[4] * y! + matrix[5]) / denominator,
    };
    const expected = destination[index]!;
    return Math.hypot(actual.x - expected.x * scale.x, actual.y - expected.y * scale.y) <= tolerance;
  });
}

function unitTranslation(transform: Transform): boolean {
  return Math.abs(transform[0][0] - 1) < 1e-6 && Math.abs(transform[1][1] - 1) < 1e-6 &&
    Math.abs(transform[0][1]) < 1e-6 && Math.abs(transform[1][0]) < 1e-6;
}

function positionResult(result: FrameNode, placement: Placement): void {
  const parent = coordinateParent(result);
  if (!parent || !("absoluteTransform" in parent)) {
    result.x = placement.x;
    result.y = placement.y;
    return;
  }
  if (!unitTranslation(parent.absoluteTransform)) {
    throw new Error("Native vector parent must be axis aligned");
  }
  const [[a, c, e], [b, d, f]] = parent.absoluteTransform;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= Number.EPSILON) {
    throw new Error("Native vector parent transform is invalid");
  }
  const center = { x: placement.x + placement.width / 2 - e, y: placement.y + placement.height / 2 - f };
  const local = {
    x: (d * center.x - c * center.y) / determinant,
    y: (-b * center.x + a * center.y) / determinant,
  };
  result.x = local.x - placement.width / 2;
  result.y = local.y - placement.height / 2;
}
import {beginNativeTemporarySession} from "./native-temporary-session";
