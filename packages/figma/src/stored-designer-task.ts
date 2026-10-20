import {utf8ByteLength} from "./json-value";
import { isMockupSurface } from "./mockup-surface";
import type {
  EffectRecipe,
  EffectState,
  DeformationWorkSpecInput,
  ShapeFitDomainChoice,
  MeshWarpSpecInput,
  MockupSpecInput,
  MockupMotionSpec,
  RemapSpecInput,
  SpatialTemplateSpecInput,
  SurfaceDeformationSpecInput,
} from "@worldbend/web/types";
import { isOwnedCanvasSetSpec } from "./stored-canvas";
import { isFigmaImageAxis, isOwnedTransformSpec, isRecord, hasExactKeys as exact } from "./stored-plane";
import { PSD_IMPORT_SOURCE_LIMIT_BYTES } from "./psd-limits";

export const SHARED_DESIGNER_TASK_KEY = "task";
export const SHARED_EFFECT_DRAFT_KEY = "effectDraft";
export const SHARED_MOCKUP_DRAFT_KEY = "mockupDraft";

export interface FigmaSpatialEffectTask {
  kind: "effect";
  recipe: EffectRecipe;
  state: EffectState;
}

export interface StoredEffectDraft {
  schema: "worldbend.figma.effect-draft";
  version: "0.1";
  baseRevision: number;
  fingerprint: string;
  task: FigmaSpatialEffectTask;
}

export interface StoredMockupDraft {
  schema: "worldbend.figma.mockup-draft";
  version: "0.1";
  baseRevision: number;
  task: FigmaCompositionTask;
}

export type FigmaCompositionTemplate = Omit<SpatialTemplateSpecInput, "operation"> & {
  operation: Extract<SpatialTemplateSpecInput["operation"], { kind: "compositionProgram" }>;
};

/** Legacy plane-only results remain readable; a continued Composition stores
 * the complete standard template plus the Figma preview output selection. */
export type FigmaCompositionTask =
  | { kind: "mockup"; spec: MockupSpecInput }
  | { kind: "composition"; template: FigmaCompositionTemplate; previewOutputId: string; motion?: { spec: MockupMotionSpec; frame: number } };

export function compositionMockup(task: FigmaCompositionTask): MockupSpecInput {
  return task.kind === "mockup" ? task.spec : task.template.operation.composition;
}

export function compositionTemplate(task: FigmaCompositionTask): SpatialTemplateSpecInput {
  return task.kind === "composition"
    ? task.template
    : {
        schema: "worldbend.spatial-template",
        version: "0.1",
        operation: { kind: "mockup", spec: task.spec },
        output: { kind: "single", id: "output" },
      };
}

export function continuedCompositionTask(spec: MockupSpecInput): FigmaCompositionTask {
  return {
    kind: "composition",
    previewOutputId: "output",
    template: {
      schema: "worldbend.spatial-template",
      version: "0.1",
      operation: {
        kind: "compositionProgram",
        composition: JSON.parse(JSON.stringify(spec)) as MockupSpecInput,
        postprocess: {
          schema: "worldbend.raster-program",
          version: "0.1",
          stages: [{
            kind: "transform",
            id: "whole-result",
            spec: {
              schema: "worldbend.transform",
              version: "0.1",
              destination: {
                space: "normalized",
                quad: {
                  tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 },
                  br: { x: 1, y: 1 }, bl: { x: 0, y: 1 },
                },
              },
              content: { fit: "stretch" },
            },
            canvas: "reference",
            target_size: { width: spec.canvas.width, height: spec.canvas.height },
          }],
        },
      },
      output: { kind: "single", id: "output" },
    },
  };
}

/** Adapter-level provenance for a deformation task adopted from a Photoshop
 * custom-warp curve. Carries the PSD source identity and adoption decisions
 * alongside the canonical work; never PSD bytes or local paths. */
export interface FigmaPsdAdoption {
  kind: "psd-adoption";
  source: { format: "psd" | "psb"; bytes: number; sha256: string; document: { width: number; height: number } };
  smartObjectId: string;
  layerPath: string[];
  name: string;
  photoshopLayerId?: number;
  linkedAssetId?: string;
  curve: { uOrder: number; vOrder: number; envelope: { left: number; top: number; right: number; bottom: number } };
  provenance: {
    controlBbox: { left: number; top: number; right: number; bottom: number };
    bboxMatchesEnvelope: boolean;
    boundary: "fixed" | "free";
    snappedCoordinates: number;
  };
  losses: string[];
}

/** The canonical work plus carrier-only source-role provenance. Raster inputs
 * remain in binding order; the optional native guide is never rendered as art. */
export interface FigmaDeformationTask {
  kind: "deformation";
  view: "pin" | "mesh";
  spec: DeformationWorkSpecInput;
  shapeGuideSourceIndex?: 0 | 1;
  shapeGuideDomain?: ShapeFitDomainChoice;
  psdAdoption?: FigmaPsdAdoption;
}

export function deformationArtworkIndex(task?: StoredDesignerTask): number {
  return task?.kind === "deformation" && task.shapeGuideSourceIndex !== undefined ? 1-task.shapeGuideSourceIndex : 0;
}

export function deformationTask(work: DeformationWorkSpecInput, view: "pin" | "mesh", guideIndex?: 0 | 1, domain?: ShapeFitDomainChoice, psdAdoption?: FigmaPsdAdoption): FigmaDeformationTask {
  return {kind:"deformation",view,spec:work,...(guideIndex === undefined ? {} : {shapeGuideSourceIndex:guideIndex,...(domain ? {shapeGuideDomain:domain} : {})}),...(psdAdoption ? {psdAdoption} : {})};
}

export function deformationTaskSourceCount(task: FigmaDeformationTask): number {
  return task.shapeGuideSourceIndex === undefined ? 1 : 2;
}

export type StoredDesignerTask =
  | FigmaSpatialEffectTask
  | FigmaCompositionTask
  | { kind: "mesh"; spec: MeshWarpSpecInput }
  | { kind: "surface"; spec: SurfaceDeformationSpecInput }
  | FigmaDeformationTask
  | { kind: "remap"; spec: RemapSpecInput };

export function sameDesignerTaskFamily(current: StoredDesignerTask["kind"], next: StoredDesignerTask["kind"]): boolean {
  if (current === next) return true;
  if ([current, next].every(kind => kind === "mockup" || kind === "composition")) return true;
  return [current, next].every(kind => kind === "mesh" || kind === "surface" || kind === "deformation");
}

export function parseStoredDesignerTask(value: string): StoredDesignerTask | undefined {
  if (!value || value.length > 128 * 1024) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isStoredDesignerTask(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function isStoredDesignerTask(value: unknown): value is StoredDesignerTask {
  if (!isRecord(value)) return false;
  if (value["kind"] === "effect") return isFigmaSpatialEffectTask(value);
  if (value["kind"] === "composition") return isCompositionTask(value);
  if (value["kind"] === "deformation") {
    return isStoredDeformationTask(value);
  }
  if (!exact(value, ["kind", "spec"])) return false;
  if (value["kind"] === "mesh") return isMeshSpec(value["spec"]);
  if (value["kind"] === "mockup") return isMockupSpec(value["spec"]);
  if (value["kind"] === "surface") return isSurfaceSpec(value["spec"]);
  return value["kind"] === "remap" && isRemapSpec(value["spec"]);
}

/** The same owning validator, available to the narrower native Vector carrier
 * without bundling unrelated mockup/effect/motion grammars into each packet. */
export function isStoredDeformationTask(value:unknown):value is FigmaDeformationTask {
    if(!isRecord(value)||value.kind!=="deformation")return false;
    return exact(value, ["kind", "view", "spec"], ["shapeGuideSourceIndex", "shapeGuideDomain", "psdAdoption"]) &&
      (value["shapeGuideSourceIndex"] === undefined ||
        ((value["shapeGuideSourceIndex"] === 0 || value["shapeGuideSourceIndex"] === 1) &&
          isRecord(value["spec"]) && isRecord(value["spec"]["shapeFit"]) && isRecord(value["spec"]["shapeFit"]["clip"]))) &&
      (value["shapeGuideDomain"] === undefined || (value["shapeGuideSourceIndex"] !== undefined && isShapeGuideDomain(value["shapeGuideDomain"]))) &&
      (value["view"] === "pin" || value["view"] === "mesh") &&
      (value["psdAdoption"] === undefined || isPsdAdoption(value["psdAdoption"])) &&
      isDeformationWorkSpec(value["spec"]);
}

function isPsdAdoption(value: unknown): value is FigmaPsdAdoption {
  if (!isRecord(value) || value["kind"] !== "psd-adoption") return false;
  if (!exact(value, ["kind", "source", "smartObjectId", "layerPath", "name", "curve", "provenance", "losses"],
    ["photoshopLayerId", "linkedAssetId"])) return false;
  const source = value["source"];
  if (!isRecord(source) || !exact(source, ["format", "bytes", "sha256", "document"]) ||
    (source["format"] !== "psd" && source["format"] !== "psb") ||
    !Number.isSafeInteger(source["bytes"]) || Number(source["bytes"]) < 1 || Number(source["bytes"]) > PSD_IMPORT_SOURCE_LIMIT_BYTES ||
    typeof source["sha256"] !== "string" || !/^[0-9a-f]{64}$/.test(source["sha256"]) ||
    !isRecord(source["document"]) || !exact(source["document"], ["width", "height"]) ||
    ![source["document"]["width"], source["document"]["height"]].every(v => Number.isSafeInteger(v) && Number(v) >= 1 && Number(v) <= 300000)) return false;
  if (typeof value["smartObjectId"] !== "string" || value["smartObjectId"].length < 1 || value["smartObjectId"].length > 64 ||
    typeof value["name"] !== "string" || [...value["name"]].length > 64 ||
    (value["photoshopLayerId"] !== undefined && !Number.isSafeInteger(value["photoshopLayerId"])) ||
    (value["linkedAssetId"] !== undefined && (typeof value["linkedAssetId"] !== "string" || value["linkedAssetId"].length > 256))) return false;
  if (!Array.isArray(value["layerPath"]) || value["layerPath"].length < 1 || value["layerPath"].length > 32 ||
    value["layerPath"].some((part) => typeof part !== "string" || [...part].length > 64)) return false;
  const curve = value["curve"];
  const envelope = isRecord(curve) ? curve["envelope"] : undefined;
  if (!isRecord(curve) || !exact(curve, ["uOrder", "vOrder", "envelope"]) ||
    curve["uOrder"] !== 4 || curve["vOrder"] !== 4 ||
    !isRecord(envelope) || !exact(envelope, ["left", "top", "right", "bottom"]) ||
    ![envelope["left"], envelope["top"], envelope["right"], envelope["bottom"]].every(v => typeof v === "number" && Number.isFinite(v)) ||
    Number(envelope["right"]) <= Number(envelope["left"]) || Number(envelope["bottom"]) <= Number(envelope["top"])) return false;
  const provenance = value["provenance"];
  const bbox = isRecord(provenance) ? provenance["controlBbox"] : undefined;
  if (!isRecord(provenance) || !exact(provenance, ["controlBbox", "bboxMatchesEnvelope", "boundary", "snappedCoordinates"]) ||
    typeof provenance["bboxMatchesEnvelope"] !== "boolean" ||
    (provenance["boundary"] !== "fixed" && provenance["boundary"] !== "free") ||
    !Number.isSafeInteger(provenance["snappedCoordinates"]) || Number(provenance["snappedCoordinates"]) < 0 || Number(provenance["snappedCoordinates"]) > 32 ||
    !isRecord(bbox) || !exact(bbox, ["left", "top", "right", "bottom"]) ||
    ![bbox["left"], bbox["top"], bbox["right"], bbox["bottom"]].every(v => typeof v === "number" && Number.isFinite(v)) ||
    Number(bbox["right"]) <= Number(bbox["left"]) || Number(bbox["bottom"]) <= Number(bbox["top"])) return false;
  return Array.isArray(value["losses"]) && value["losses"].length <= 16 &&
    value["losses"].every((loss) => typeof loss === "string" && loss.length > 0 && loss.length <= 128);
}

function isShapeGuideDomain(value: unknown): value is ShapeFitDomainChoice {
  if (!isRecord(value)) return false;
  if(value["kind"] === "nativeContour") return exact(value,["kind","contourIndex"]) && Number.isSafeInteger(value["contourIndex"]) && Number(value["contourIndex"])>=0 && Number(value["contourIndex"])<8;
  return exact(value,["kind"]) && (value["kind"] === "convexEnvelope" || value["kind"] === "bounds");
}

export function isFigmaSpatialEffectTask(value: unknown): value is FigmaSpatialEffectTask {
  return isRecord(value) && exact(value, ["kind", "recipe", "state"]) && value["kind"] === "effect" &&
    isFigmaEffectRecipe(value["recipe"]) && isEffectState(value["state"]);
}

export function isFigmaCompositionTask(value: unknown): value is FigmaCompositionTask {
  if (!isRecord(value)) return false;
  if (value["kind"] === "composition") return isCompositionTask(value);
  return value["kind"] === "mockup" && exact(value, ["kind", "spec"]) && isMockupSpec(value["spec"]);
}

export function parseStoredEffectDraft(value: string): StoredEffectDraft | undefined {
  return parseDraft(value, isStoredEffectDraft);
}

export function isStoredEffectDraft(value: unknown): value is StoredEffectDraft {
  return isRecord(value) && exact(value, ["schema", "version", "baseRevision", "fingerprint", "task"]) &&
    value["schema"] === "worldbend.figma.effect-draft" && value["version"] === "0.1" &&
    Number.isSafeInteger(value["baseRevision"]) && Number(value["baseRevision"]) >= 1 &&
    typeof value["fingerprint"] === "string" && /^sha256:[0-9a-f]{64}$/.test(value["fingerprint"]) &&
    isFigmaSpatialEffectTask(value["task"]);
}

export function parseStoredMockupDraft(value: string): StoredMockupDraft | undefined {
  return parseDraft(value, isStoredMockupDraft);
}

function parseDraft<T>(value: string, valid: (parsed: unknown) => parsed is T): T | undefined {
  if (!value || value.length > 128 * 1024) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return valid(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function isStoredMockupDraft(value: unknown): value is StoredMockupDraft {
  return isRecord(value) && exact(value, ["schema", "version", "baseRevision", "task"]) &&
    value["schema"] === "worldbend.figma.mockup-draft" && value["version"] === "0.1" &&
    Number.isSafeInteger(value["baseRevision"]) && Number(value["baseRevision"]) >= 1 &&
    isFigmaCompositionTask(value["task"]);
}

function isCompositionTask(value: Record<string, unknown>): boolean {
  if (!exact(value, ["kind", "template", "previewOutputId"], ["motion"]) || !isId(value["previewOutputId"]) || (value["motion"] !== undefined && !isCompositionMotion(value["motion"]))) return false;
  const template = value["template"];
  if (!isRecord(template) || !exact(template, ["schema", "version", "operation", "output"]) ||
    template["schema"] !== "worldbend.spatial-template" || template["version"] !== "0.1" ||
    !isRecord(template["operation"]) || !exact(template["operation"], ["kind", "composition", "postprocess"]) ||
    template["operation"]["kind"] !== "compositionProgram" ||
    !isMockupSpec(template["operation"]["composition"]) ||
    !isFigmaCompositionPostprocess(template["operation"]["postprocess"]) ||
    !isRecord(template["output"])) return false;
  return isCompositionOutput(template["output"],value["previewOutputId"]);
}

function isCompositionOutput(output:unknown,id:unknown):boolean {
  if(!isRecord(output))return false;
  if(output["kind"]==="single")return exact(output,["kind","id"])&&isId(output["id"])&&output["id"]===id;
  return output["kind"]==="canvasSet"&&exact(output,["kind","spec"])&&isOwnedCanvasSetSpec(output["spec"])&&
    output["spec"].variants.every(variant=>["crop","contain","cover","stretch"].includes(variant.operation.kind))&&output["spec"].variants.some(variant=>variant.id===id);
}
function isMotionKeys(keys:unknown,base:unknown,count:number,allowEmpty=false):boolean {
  if(!Array.isArray(keys)||keys.length>240||(!keys.length&&!allowEmpty))return false;
  if(!keys.length)return true;
  let previous=-1;
  for(const key of keys){
    if(!isRecord(key)||!exact(key,["frame","quad"],["easingToNext"])||!Number.isSafeInteger(key["frame"])||Number(key["frame"])<=previous||Number(key["frame"])>=count)return false;
    previous=Number(key["frame"]);
    if(!isRecord(base)||!isOwnedTransformSpec({...base,destination:{space:"normalized",quad:key["quad"]}}))return false;
    const ease=key["easingToNext"];
    if(ease!==undefined&&ease!==null&&(!isRecord(ease)||!((ease["kind"]==="linear"||ease["kind"]==="hold")&&exact(ease,["kind"])||ease["kind"]==="cubicBezier"&&exact(ease,["kind","x1","y1","x2","y2"])&&["x1","x2"].every(k=>isUnit(ease[k]))&&["y1","y2"].every(k=>isBoundedNumber(ease[k],-4,4)))))return false;
  }
  return keys[0]["frame"]===0&&previous===count-1&&(keys.at(-1)?.["easingToNext"]===undefined||keys.at(-1)?.["easingToNext"]===null);
}
function isMotionPresentation(value:unknown):boolean {
  return isRecord(value)&&exact(value,["transform","size","output","outputId"],["keyframes"])&&isOwnedTransformSpec(value["transform"])&&isSize(value["size"])&&isId(value["outputId"])&&isCompositionOutput(value["output"],value["outputId"])&&(value["keyframes"]===undefined||(Array.isArray(value["keyframes"])&&value["keyframes"].length<=240));
}

function isCompositionMotion(value: unknown): boolean {
  if (!isRecord(value) || !exact(value,["spec","frame"]) || !Number.isSafeInteger(value["frame"])) return false;
  const spec=value["spec"];
  if (!isRecord(spec) || !exact(spec,["schema","version","canvas","timebase","frameCount","planes","background","seams"],["clip","presentation"]) || (spec["presentation"]!==undefined&&!isMotionPresentation(spec["presentation"])) || spec["schema"]!=="worldbend.mockup-motion" || spec["version"]!=="0.1" ||
      !Number.isSafeInteger(spec["frameCount"]) || Number(spec["frameCount"])<1 || Number(spec["frameCount"])>240 || Number(value["frame"])<0 || Number(value["frame"])>=Number(spec["frameCount"]) ||
      !isRecord(spec["timebase"]) || !exact(spec["timebase"],["numerator","denominator"]) || !Number.isSafeInteger(spec["timebase"]["numerator"]) || !Number.isSafeInteger(spec["timebase"]["denominator"]) || Number(spec["timebase"]["numerator"])<1 || Number(spec["timebase"]["denominator"])<1 || !Array.isArray(spec["planes"])) return false;
  const presentation=spec["presentation"];
  if(isRecord(presentation)&&presentation["keyframes"]!==undefined&&!isMotionKeys(presentation["keyframes"],presentation["transform"],Number(spec["frameCount"]),true))return false;
  const planes=[];
  for(const plane of spec["planes"]) {
    if(!isRecord(plane)||!exact(plane,["id","sourceId","base","keyframes","opacity"],["grid","measurement","surface","shadow"])||!Array.isArray(plane["keyframes"])||plane["keyframes"].length<1||plane["keyframes"].length>240)return false;
    if(!isMotionKeys(plane["keyframes"],plane["base"],Number(spec["frameCount"])))return false;
    const {base,keyframes,...rest}=plane;planes.push({...rest,transform:base});
  }
  return isMockupSpec({schema:"worldbend.mockup",version:"0.1",canvas:spec["canvas"],background:spec["background"],seams:spec["seams"],planes,...(spec["clip"]?{clip:spec["clip"]}:{})});
}

function isFigmaCompositionPostprocess(value: unknown): boolean {
  if (!isRecord(value) || !exact(value, ["schema", "version", "stages"]) ||
    value["schema"] !== "worldbend.raster-program" || value["version"] !== "0.1" ||
    !Array.isArray(value["stages"]) || value["stages"].length !== 1) return false;
  const stage = value["stages"][0];
  if (!isRecord(stage) || !exact(stage, ["kind", "id", "spec", "canvas", "target_size"]) ||
    stage["kind"] !== "transform" || !isId(stage["id"]) || stage["canvas"] !== "reference" ||
    !isOwnedTransformSpec(stage["spec"]) || !isSize(stage["target_size"])) return false;
  return true;
}

/** The Figma carrier authors one explicit ordered shared-camera scene. Other
 * EffectRecipe shapes remain available to Agent/Web carriers. */
export function isFigmaEffectRecipe(value: unknown): value is EffectRecipe {
  if (!isRecord(value)) return false;
  if (!exact(value, ["schema", "version", "origin", "viewport", "camera", "layers"], ["appearance"]) ||
    value["schema"] !== "worldbend.effect-recipe" || value["version"] !== "3" ||
    !isSize(value["viewport"]) || !isCamera(value["camera"]) ||
    (value["appearance"] !== undefined && !isAppearance(value["appearance"])) ||
    !Array.isArray(value["layers"]) || value["layers"].length < 2 || value["layers"].length > 8) return false;
  const origin = value["origin"];
  if (origin !== null && origin !== undefined && (!isRecord(origin) ||
    !exact(origin, ["effect", "version", "viewport", "intensity"]) ||
    origin["effect"] !== "multiplane-camera" || origin["version"] !== "3" ||
    !isSize(origin["viewport"]) || !isBoundedNumber(origin["intensity"], 0, 1))) return false;
  const ids = new Set<string>();
  let previousDistance = Number.POSITIVE_INFINITY;
  for (const layer of value["layers"]) {
    if (!isRecord(layer) || !exact(layer, ["id", "offset", "surface", "tracks"]) ||
      !isId(layer["id"]) || ids.has(String(layer["id"])) ||
      !isPoint(layer["offset"], -1_000_000, 1_000_000) ||
      !Array.isArray(layer["tracks"]) || layer["tracks"].length !== 0 || !isRecord(layer["surface"]) ||
      !exact(layer["surface"], ["kind", "size", "distance"]) ||
      layer["surface"]["kind"] !== "camera-plane" || !isLogicalPlaneSize(layer["surface"]["size"]) ||
      !isBoundedNumber(layer["surface"]["distance"], 1, 1_000_000) ||
      Number(layer["surface"]["distance"]) >= previousDistance) return false;
    ids.add(String(layer["id"]));
    previousDistance = Number(layer["surface"]["distance"]);
  }
  return true;
}

function isEffectState(value: unknown): value is EffectState {
  return isRecord(value) && exact(value, ["progress", "pointerX", "pointerY", "reducedMotion"]) &&
    isBoundedNumber(value["progress"], 0, 1) && isBoundedNumber(value["pointerX"], -1, 1) &&
    isBoundedNumber(value["pointerY"], -1, 1) && typeof value["reducedMotion"] === "boolean";
}

function isCamera(value: unknown): boolean {
  return isRecord(value) && exact(value, ["focalLength", "focusDistance", "travel"]) &&
    isBoundedNumber(value["focalLength"], 1, 1_000_000) &&
    isBoundedNumber(value["focusDistance"], 1, 1_000_000) && isRecord(value["travel"]) &&
    exact(value["travel"], ["x", "y"]) && isBoundedNumber(value["travel"]["x"], 0, 1_000_000) &&
    isBoundedNumber(value["travel"]["y"], 0, 1_000_000);
}

function isAppearance(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const hasDepth = value["depthOfField"] !== undefined && value["depthOfField"] !== null;
  const hasMotion = value["motionBlur"] !== undefined && value["motionBlur"] !== null;
  if (!exact(value, [], ["depthOfField", "motionBlur"]) || (!hasDepth && !hasMotion)) return false;
  const depth = value["depthOfField"];
  if (depth !== undefined && depth !== null && (!isRecord(depth) ||
    !exact(depth, ["focusDistance", "focusRange", "maxBlurRadius"]) ||
    !isBoundedNumber(depth["focusDistance"], 1, 1_000_000) ||
    !isBoundedNumber(depth["focusRange"], 1, 1_000_000) ||
    !isBoundedNumber(depth["maxBlurRadius"], 0, 64))) return false;
  const motion = value["motionBlur"];
  return motion === undefined || motion === null || (isRecord(motion) &&
    exact(motion, ["exposureFraction", "maxBlurRadius"]) &&
    isBoundedNumber(motion["exposureFraction"], 0, 1) &&
    isBoundedNumber(motion["maxBlurRadius"], 0, 64));
}

function isMeshSpec(value: unknown): value is MeshWarpSpecInput {
  if (
    !isRecord(value) ||
    !exact(value, ["schema", "version", "transform", "targetSize", "mesh"]) ||
    value["schema"] !== "worldbend.mesh-warp" ||
    value["version"] !== "0.1" ||
    !isOwnedTransformSpec(value["transform"]) ||
    !isSize(value["targetSize"]) ||
    !isRecord(value["mesh"]) ||
    !exact(value["mesh"], ["subdivisions", "vertices"], ["boundary"]) ||
    !isBoundary(value["mesh"]["boundary"])
  ) return false;
  const subdivisions = value["mesh"]["subdivisions"];
  const vertices = value["mesh"]["vertices"];
  return (
    Number.isInteger(subdivisions) &&
    Number(subdivisions) >= 2 &&
    Number(subdivisions) <= 16 &&
    Array.isArray(vertices) &&
    vertices.length === (Number(subdivisions) + 1) ** 2 &&
    vertices.every((vertex) =>
      isRecord(vertex) &&
      exact(vertex, ["source", "warped"]) &&
      isNormalizedPoint(vertex["source"]) &&
      isNormalizedPoint(vertex["warped"]),
    )
  );
}

function isSurfaceSpec(value: unknown): value is SurfaceDeformationSpecInput {
  if (
    !isRecord(value) ||
    !exact(value, ["schema", "version", "transform", "targetSize", "meshSubdivisions", "envelope", "anchors", "strokes"], ["boundary"]) ||
    value["schema"] !== "worldbend.surface-deformation" ||
    !isBoundary(value["boundary"]) ||
    value["version"] !== "0.1" ||
    !isOwnedTransformSpec(value["transform"]) ||
    !isSize(value["targetSize"]) ||
    !Number.isInteger(value["meshSubdivisions"]) ||
    Number(value["meshSubdivisions"]) < 4 ||
    Number(value["meshSubdivisions"]) > 16 ||
    !Array.isArray(value["anchors"]) ||
    value["anchors"].length > 64 ||
    !Array.isArray(value["strokes"]) ||
    value["strokes"].length > 64
  ) return false;
  const transform = value["transform"];
  if (isRecord(transform) && isRecord(transform["content"]) && transform["content"]["warp"] !== undefined) {
    return false;
  }
  const subdivisions = Number(value["meshSubdivisions"]);
  return isBezierEnvelope(value["envelope"], subdivisions, value["boundary"] === "free") &&
    isAnchors(value["anchors"], subdivisions) &&
    isStrokes(value["strokes"]);
}

function isDeformationWorkSpec(value: unknown): value is DeformationWorkSpecInput {
  if (!isRecord(value)) return false;
  if (
    !exact(value, ["schema", "version", "transform"], ["meshSubdivisions", "meshEdits", "targetSize", "surface", "liquify", "shapeFit", "boundary"]) ||
    value["schema"] !== "worldbend.deformation-work" ||
    !isBoundary(value["boundary"]) ||
    value["version"] !== "0.1" ||
    !isOwnedTransformSpec(value["transform"]) ||
    (value["targetSize"] !== undefined && !isDeformationReferenceSize(value["targetSize"])) ||
    (value["meshSubdivisions"] !== undefined && !Number.isInteger(value["meshSubdivisions"]))
  ) return false;
  const transform = value["transform"];
  if (isRecord(transform) && isRecord(transform["content"]) && transform["content"]["warp"] !== undefined) {
    return false;
  }
  const subdivisions = Number(value["meshSubdivisions"] ?? 12);
  const edits = value["meshEdits"] ?? [];
  const free = value["boundary"] === "free";
  if (subdivisions < 2 || subdivisions > 16 || !Array.isArray(edits) || edits.length > (free ? 289 : 225)) return false;
  const surface = value["surface"];
  if (surface !== undefined) {
    if (!isRecord(surface) || !exact(surface, ["envelope", "anchors", "strokes"]) || subdivisions < 4 ||
      !isBezierEnvelope(surface["envelope"], subdivisions, free) ||
      !isAnchors(surface["anchors"], subdivisions) || !isStrokes(surface["strokes"])) return false;
  }
  if (value["liquify"] !== undefined && !isLiquifyControls(value["liquify"])) return false;
  if (value["shapeFit"] !== undefined && !isShapeFitControls(value["shapeFit"])) return false;
  const vertices = new Set<string>();
  return edits.every((edit) => {
    if (!isRecord(edit) || !exact(edit, ["column", "row", "warped"]) ||
      !Number.isInteger(edit["column"]) || !Number.isInteger(edit["row"]) ||
      Number(edit["column"]) < (free ? 0 : 1) || Number(edit["row"]) < (free ? 0 : 1) ||
      Number(edit["column"]) > (free ? subdivisions : subdivisions - 1) || Number(edit["row"]) > (free ? subdivisions : subdivisions - 1) ||
      !isPoint(edit["warped"], -2, 3)) return false;
    const key = `${edit["column"]},${edit["row"]}`;
    if (vertices.has(key)) return false;
    vertices.add(key);
    return true;
  });
}

function isShapeFitControls(value: unknown): boolean {
  if (!isRecord(value) || !exact(value, ["contour"], ["clip", "cornerPositions", "refinement"]) || !isClip({ contours: [value["contour"]] })) return false;
  if (value["clip"] !== undefined && !isClip(value["clip"])) return false;
  if (value["refinement"] !== undefined && value["refinement"] !== 1 && value["refinement"] !== 2) return false;
  const corners = value["cornerPositions"];
  if (corners === undefined) return true;
  if (!Array.isArray(corners) || corners.length !== 4 ||
    corners.some(t => typeof t !== "number" || !Number.isFinite(t) || t < 0 || t >= 1)) return false;
  const gaps = corners.map((t, i) => (corners[(i + 1) % 4] - t + 1) % 1);
  return gaps.every(gap => gap > 1e-12) && Math.abs(gaps.reduce((sum, gap) => sum + gap, 0) - 1) <= 1e-12;
}

function isAnchors(value: unknown, subdivisions: number): boolean {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  const vertices = new Set<string>();
  return value.every((anchor) => {
    if (
      !isRecord(anchor) ||
      !exact(anchor, ["id", "column", "row"]) ||
      !isId(anchor["id"]) ||
      !Number.isInteger(anchor["column"]) ||
      !Number.isInteger(anchor["row"]) ||
      Number(anchor["column"]) <= 0 ||
      Number(anchor["row"]) <= 0 ||
      Number(anchor["column"]) >= subdivisions ||
      Number(anchor["row"]) >= subdivisions
    ) return false;
    const id = String(anchor["id"]);
    const vertex = `${anchor["column"]},${anchor["row"]}`;
    if (ids.has(id) || vertices.has(vertex)) return false;
    ids.add(id);
    vertices.add(vertex);
    return true;
  });
}

function isStrokes(value: unknown, liquify = false): boolean {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  let samples = 0;
  return value.every((stroke) => {
    if (
      !isRecord(stroke) ||
      !exact(stroke, liquify ? ["id", "mode", "samples"] : ["id", "samples"]) ||
      (liquify && !["push", "bloat", "pucker", "twirl"].includes(String(stroke["mode"]))) ||
      !isId(stroke["id"]) ||
      !Array.isArray(stroke["samples"]) ||
      stroke["samples"].length < 1 ||
      stroke["samples"].length > 256
    ) return false;
    if (ids.has(String(stroke["id"]))) return false;
    ids.add(String(stroke["id"]));
    samples += stroke["samples"].length;
    if (samples > 1024) return false;
    const push = !liquify || stroke["mode"] === "push";
    return stroke["samples"].every((sample) =>
      isRecord(sample) &&
      exact(sample, push ? ["position", "delta", "radius", "strength"] : ["position", "radius", "strength"]) &&
      isNormalizedPoint(sample["position"]) &&
      (!push || isPoint(sample["delta"], -1, 1)) &&
      isBoundedNumber(sample["radius"], 0.001, 2) &&
      isUnit(sample["strength"]),
    );
  });
}

/** The typed Liquify brush block (`worldbend.liquify@0.1`): the same closed
 * brush counts as the surface strokes, with push-only deltas. */
function isLiquifyControls(value: unknown): boolean {
  if (!isRecord(value) || !exact(value, ["strokes"]) || !Array.isArray(value["strokes"]) ||
    value["strokes"].length > 64) return false;
  return isStrokes(value["strokes"], true);
}

function isBoundary(value: unknown): boolean { return value === undefined || value === "fixed" || value === "free"; }

function isBezierEnvelope(value: unknown, subdivisions: number, free = false): boolean {
  if (
    !isRecord(value) ||
    !exact(value, ["columns", "rows", "points"]) ||
    !Number.isInteger(value["columns"]) ||
    !Number.isInteger(value["rows"]) ||
    Number(value["columns"]) < 1 ||
    Number(value["columns"]) > 4 ||
    Number(value["rows"]) < 1 ||
    Number(value["rows"]) > 4
  ) return false;
  const columns = Number(value["columns"]);
  const rows = Number(value["rows"]);
  if (subdivisions % columns !== 0 || subdivisions % rows !== 0) return false;
  const controlColumns = columns * 3 + 1;
  const controlRows = rows * 3 + 1;
  const points = value["points"];
  if (!Array.isArray(points) || points.length !== controlColumns * controlRows) return false;
  return points.every((point, index) => {
    if (!isPoint(point, -2, 3)) return false;
    const column = index % controlColumns;
    const row = Math.floor(index / controlColumns);
    if (!free && (column === 0 || row === 0 || column + 1 === controlColumns || row + 1 === controlRows)) {
      const expectedX = column / (controlColumns - 1);
      const expectedY = row / (controlRows - 1);
      return Math.abs(point.x - expectedX) <= 1e-12 && Math.abs(point.y - expectedY) <= 1e-12;
    }
    return true;
  });
}

function isMockupSpec(value: unknown): value is MockupSpecInput {
  if (
    !isRecord(value) ||
    !exact(value, ["schema", "version", "canvas", "background", "planes", "seams"], ["clip"]) ||
    value["schema"] !== "worldbend.mockup" ||
    value["version"] !== "0.1" ||
    !isSize(value["canvas"]) ||
    !isBackground(value["background"]) ||
    !Array.isArray(value["planes"]) ||
    value["planes"].length < 1 ||
    value["planes"].length > 8 ||
    !Array.isArray(value["seams"]) ||
    value["seams"].length !== 0 ||
    (value["clip"] !== undefined && !isClip(value["clip"]))
  ) return false;
  const ids = new Set<string>();
  return value["planes"].every((plane) => {
    if (!isRecord(plane)) return false;
    if (
      !exact(plane, ["id", "sourceId", "transform", "opacity"], ["grid", "measurement", "surface", "shadow"]) ||
      !isId(plane["id"]) ||
      ids.has(String(plane["id"])) ||
      !isId(plane["sourceId"]) ||
      !isOwnedTransformSpec(plane["transform"]) ||
      !isUnit(plane["opacity"])
    ) return false;
    if (plane["surface"] !== undefined && plane["surface"] !== null && !isMockupSurface(plane["surface"])) return false;
    const measure=plane["measurement"];
    if(measure!==undefined&&measure!==null&&(!isRecord(measure)||!exact(measure,["width","height","unit"])||!isBoundedNumber(measure["width"],Number.MIN_VALUE,Number.MAX_VALUE)||!isBoundedNumber(measure["height"],Number.MIN_VALUE,Number.MAX_VALUE)||typeof measure["unit"]!=="string"||!/^[A-Za-z0-9_.-]{1,64}$/.test(measure["unit"])))return false;
    const shadow=plane["shadow"];
    if(shadow!==undefined&&shadow!==null&&(!isRecord(shadow)||!exact(shadow,["offset","blurSigmaPx","color","opacity"])||
      !isRecord(shadow["offset"])||!exact(shadow["offset"],["x","y"])||
      !isBoundedNumber(shadow["offset"]["x"],-8192,8192)||!isBoundedNumber(shadow["offset"]["y"],-8192,8192)||
      !isBoundedNumber(shadow["blurSigmaPx"],0,64)||!isUnit(shadow["opacity"])||
      !Array.isArray(shadow["color"])||shadow["color"].length!==3||!shadow["color"].every(v=>Number.isInteger(v)&&v>=0&&v<=255)))return false;
    ids.add(String(plane["id"]));
    const grid = plane["grid"];
    return grid === undefined || grid === null || (
      isRecord(grid) &&
      exact(grid, ["columns", "rows"]) &&
      isDivision(grid["columns"]) &&
      isDivision(grid["rows"])
    );
  });
}

/** The stored-clip shape of `worldbend.mockup@0.1`: closed contours with the
 * same bounds the core plan enforces. `fillRule` defaults to nonZero like the
 * core spec; optional regions retain their independent rules and union. */
function isClip(value: unknown): value is NonNullable<MockupSpecInput["clip"]> {
  if (!isRecord(value) ||
    !exact(value, ["contours"], ["fillRule", "regions"]) ||
    (value["fillRule"] !== undefined && !["nonZero", "evenOdd"].includes(String(value["fillRule"]))) ||
    !Array.isArray(value["contours"]) ||
    value["contours"].length < 1 || value["contours"].length > 8) return false;
  const regions = value["regions"];
  if (regions !== undefined) {
    if (!Array.isArray(regions) || regions.length > 8) return false;
    const referenced = new Set<number>();
    for (const region of regions) {
      if (!isRecord(region) || !exact(region, ["contourIndices"], ["fillRule"]) ||
        (region["fillRule"] !== undefined && region["fillRule"] !== "nonZero" && region["fillRule"] !== "evenOdd") ||
        !Array.isArray(region["contourIndices"]) || region["contourIndices"].length < 1 ||
        region["contourIndices"].length > value["contours"].length) return false;
      const unique = new Set<number>();
      for (const index of region["contourIndices"]) {
        if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= value["contours"].length || unique.has(index)) return false;
        unique.add(index); referenced.add(index);
      }
    }
    if (regions.length > 0 && referenced.size !== value["contours"].length) return false;
  }
  let total = 0;
  return value["contours"].every((contour) => {
    if (!isRecord(contour) || !exact(contour, ["start", "segments"]) ||
      !isBoundedPoint(contour["start"]) || !Array.isArray(contour["segments"]) ||
      contour["segments"].length < 2 || contour["segments"].length > 128) return false;
    total += contour["segments"].length;
    if (total > 512) return false;
    return contour["segments"].every((segment) => {
      if (!isRecord(segment)) return false;
      if (segment["kind"] === "line") {
        return exact(segment, ["kind", "to"]) && isBoundedPoint(segment["to"]);
      }
      return segment["kind"] === "cubic" && exact(segment, ["kind", "c1", "c2", "to"]) &&
        isBoundedPoint(segment["c1"]) && isBoundedPoint(segment["c2"]) &&
        isBoundedPoint(segment["to"]);
    });
  });
}

function isBoundedPoint(value: unknown): boolean {
  return isPoint(value, -2, 3);
}

function isRemapSpec(value: unknown): value is RemapSpecInput {
  if (
    !isRecord(value) ||
    !exact(value, ["schema", "version", "output", "operation"]) ||
    value["schema"] !== "worldbend.remap" ||
    value["version"] !== "0.1" ||
    !isSize(value["output"]) ||
    !isRecord(value["operation"])
  ) return false;
  const operation = value["operation"];
  if (operation["kind"] === "lens") {
    const coefficients = operation["coefficients"];
    return (
      exact(operation, ["kind", "coefficients", "center", "scale"]) &&
      isRecord(coefficients) &&
      exact(coefficients, ["k1", "k2", "k3", "p1", "p2"]) &&
      ["k1", "k2", "k3", "p1", "p2"].every((key) => isBoundedNumber(coefficients[key], -4, 4)) &&
      isPoint(operation["center"], -1, 2) &&
      isPoint(operation["scale"], 0.000001, 10)
    );
  }
  return (
    operation["kind"] === "displacement" &&
    exact(operation, ["kind", "xChannel", "yChannel", "scaleXPixels", "scaleYPixels", "neutral", "boundary"]) &&
    isChannel(operation["xChannel"]) &&
    isChannel(operation["yChannel"]) &&
    isBoundedNumber(operation["scaleXPixels"], -4096, 4096) &&
    isBoundedNumber(operation["scaleYPixels"], -4096, 4096) &&
    Number.isInteger(operation["neutral"]) &&
    Number(operation["neutral"]) >= 0 &&
    Number(operation["neutral"]) <= 255 &&
    ["transparent", "clamp", "wrap"].includes(String(operation["boundary"]))
  );
}

function isBackground(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value["kind"] === "transparent") return exact(value, ["kind"]);
  return value["kind"] === "color" && exact(value, ["kind", "rgba", "space"]) &&
    value["space"] === "srgb8" && Array.isArray(value["rgba"]) && value["rgba"].length === 4 &&
    value["rgba"].every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
}

function isSize(value: unknown): boolean {
  return isRecord(value) && exact(value, ["width", "height"]) &&
    isFigmaImageAxis(value["width"]) && isFigmaImageAxis(value["height"]);
}
function isLogicalPlaneSize(value: unknown): boolean {
  return isRecord(value) && exact(value, ["width", "height"]) &&
    isBoundedNumber(value["width"], 1, 4096) && isBoundedNumber(value["height"], 1, 4096);
}
function isDeformationReferenceSize(value:unknown):boolean {
  return isRecord(value)&&exact(value,["width","height"])&&
    isBoundedNumber(value["width"],.01,4096)&&isBoundedNumber(value["height"],.01,4096);
}
function isPoint(value: unknown, minimum: number, maximum: number): boolean {
  return isRecord(value) && exact(value, ["x", "y"]) &&
    isBoundedNumber(value["x"], minimum, maximum) &&
    isBoundedNumber(value["y"], minimum, maximum);
}
function isNormalizedPoint(value: unknown): boolean { return isPoint(value, 0, 1); }
function isUnit(value: unknown): boolean { return isBoundedNumber(value, 0, 1); }
function isBoundedNumber(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}
function isId(value: unknown): boolean { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value); }
function isDivision(value: unknown): boolean { return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 64; }
function isChannel(value: unknown): boolean { return ["red", "green", "blue", "alpha", "luminance"].includes(String(value)); }

/** Below the host's 100 kB shared-entry envelope, including key/namespace. */
export const MAX_PERSISTED_DESIGNER_TASK_BYTES=90*1024;
export function assertPersistableDesignerTask(task:StoredDesignerTask):void {
  // Complete shared deformation work uses the owning operation-bank codec,
  // not one host entry. Other families retain their existing storage budget.
  if(utf8ByteLength(JSON.stringify(task))>(task.kind==="deformation"?8*1024*1024:MAX_PERSISTED_DESIGNER_TASK_BYTES))
    throw Error("This work exceeds the Figma result storage limit. Keep the draft and reduce authored poses or detail before saving.");
}
