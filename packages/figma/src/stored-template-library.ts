import type {
  DeformationWorkSpecInput,
  MeshWarpSpecInput,
  MockupSpecInput,
  SpatialTemplateSpecInput,
  SurfaceDeformationSpecInput,
} from "@worldbend/web/types";
import { isStoredDesignerTask } from "./stored-designer-task";
import {
  compositionTemplate,
  type FigmaCompositionTask,
} from "./stored-designer-task";
import {
  isOwnedCanvasSetSpec,
  type OwnedCanvasSetSpec,
} from "./stored-canvas";
import { isRecord } from "./stored-plane";
import { isReadySceneId, readyScene, readySceneMockup, type ReadySceneId } from "./ready-scenes";
import { utf8ByteLength } from "./json-value";
export {utf8ByteLength} from "./json-value";
import { sameJsonValue } from "./json-value";
import { isCanvasOutputNames, type CanvasOutputNames } from "./canvas-output-name";
import { isNativeSceneReference, type NativeSceneReference } from "./native-scene-model";

export const TEMPLATE_LIBRARY_STORAGE_KEY = "worldbend.spatial-templates.v1";
export const MAX_SAVED_SPATIAL_TEMPLATES = 32;
export const MAX_TEMPLATE_LIBRARY_BYTES = 512 * 1024;

export type FigmaSpatialTemplate = Omit<
  SpatialTemplateSpecInput,
  "operation"
> & {
  motion?: Extract<FigmaCompositionTask,{kind:"composition"}>["motion"];
  operation:
    | { kind: "mockup"; spec: MockupSpecInput }
    | Extract<SpatialTemplateSpecInput["operation"], { kind: "compositionProgram" }>;
};

export interface FigmaCanvasTemplate {
  schema: "worldbend.figma-task-template";
  version: "0.1";
  operation: { kind: "canvas"; spec: OwnedCanvasSetSpec };
  outputNames?: CanvasOutputNames;
}

export interface FigmaMeshTemplate {
  schema: "worldbend.figma-task-template";
  version: "0.1";
  operation: { kind: "mesh"; spec: MeshWarpSpecInput };
}

export interface FigmaSurfaceTemplate {
  schema: "worldbend.figma-task-template";
  version: "0.1";
  operation: { kind: "surface"; spec: SurfaceDeformationSpecInput };
}

export interface FigmaDeformationTemplate {
  schema: "worldbend.figma-task-template";
  version: "0.1";
  operation: { kind: "deformation"; view: "pin" | "mesh"; spec: DeformationWorkSpecInput };
}

export type FigmaTaskTemplate =
  | FigmaSpatialTemplate
  | FigmaCanvasTemplate
  | FigmaMeshTemplate
  | FigmaSurfaceTemplate
  | FigmaDeformationTemplate;

export interface SavedSpatialTemplate {
  id: string;
  name: string;
  template: FigmaTaskTemplate;
  /** Slot descriptors captured at save time: each editable source's document
   * name and the raster dimensions the template was authored against. */
  slots?: TemplateSlot[];
  /** Truthful appearance boundary derived from what the template's recompute
   * supports; authored, never hand-declared. */
  appearance?: TemplateAppearance;
  /** First-party native scene construction, separate from core geometry. */
  readyScene?: ReadySceneId;
  nativeScene?: NativeSceneReference;
}

/** One editable slot of a saved template, in binding order. */
export interface TemplateSlot {
  name: string;
  width: number;
  height: number;
}

/** Appearance behaviors a saved template's recompute may or may not support. */
export type TemplateAppearanceKind =
  | "perspective"
  | "opacity"
  | "clip"
  | "masking"
  | "occlusion"
  | "lighting";

export interface TemplateAppearance {
  supported: TemplateAppearanceKind[];
  unsupported: TemplateAppearanceKind[];
}

const TEMPLATE_APPEARANCE_KINDS: readonly TemplateAppearanceKind[] = [
  "perspective", "opacity", "clip", "masking", "occlusion", "lighting",
];

/** Derive the appearance boundary from the template's own operation. The
 * recompute supports perspective placement, per-plane opacity, and — for a
 * Mockup task — an explicit clip and authored surface light. Fitted works
 * retain their own compound clip. Native scene
 * masking, occlusion and shadows remain in the editable carrier. */
export function templateAppearance(template: FigmaTaskTemplate): TemplateAppearance {
  const operation = template.operation;
  const supportsOpacity = operation.kind === "mockup" || operation.kind === "compositionProgram";
  const mockup = operation.kind === "mockup" ? operation.spec : operation.kind === "compositionProgram" ? operation.composition : undefined;
  const supportsLighting = mockup?.planes.some(plane => (plane.opacity ?? 1) > 0 && plane.surface &&
    (plane.surface.kind === "cylinder" ? plane.surface.curvature : plane.surface.depth) > 0 &&
    (plane.surface.light?.strength ?? .65) > 0);
  const supported: TemplateAppearanceKind[] = [
    ...(operation.kind !== "canvas" ? (["perspective"] as TemplateAppearanceKind[]) : []),
    ...(supportsOpacity ? (["opacity"] as TemplateAppearanceKind[]) : []),
    ...((mockup?.clip || (operation.kind === "deformation" && operation.spec.shapeFit?.clip))
      ? (["clip"] as TemplateAppearanceKind[]) : []),
    ...(supportsLighting ? (["lighting"] as TemplateAppearanceKind[]) : []),
  ];
  return {
    supported,
    unsupported: TEMPLATE_APPEARANCE_KINDS.filter((kind) => !supported.includes(kind)),
  };
}

const MAX_TEMPLATE_SLOT_NAME = 128;

export function templateSlotName(value: string): string {
  let name = "";
  for (const character of value) {
    if (name.length + character.length > MAX_TEMPLATE_SLOT_NAME) break;
    name += character;
  }
  return name || "Artwork";
}

/** Slots from the live sources of the workspace that saves the template. */
export function templateSlotsFromSources(
  sources: ReadonlyArray<{ sourceName: string; renderWidth: number; renderHeight: number }>,
): TemplateSlot[] | undefined {
  if (sources.length < 1 || sources.length > 8) return undefined;
  const slots = sources.map((source) => ({
    name: templateSlotName(source.sourceName),
    width: source.renderWidth,
    height: source.renderHeight,
  }));
  return slots.every(isTemplateSlot) ? slots : undefined;
}

function isTemplateSlot(value: unknown): value is TemplateSlot {
  return isRecord(value) &&
    exact(value, ["name", "width", "height"]) &&
    typeof value["name"] === "string" && value["name"].length >= 1 && value["name"].length <= MAX_TEMPLATE_SLOT_NAME &&
    Number.isSafeInteger(value["width"]) && Number(value["width"]) >= 1 && Number(value["width"]) <= 4096 &&
    Number.isSafeInteger(value["height"]) && Number(value["height"]) >= 1 && Number(value["height"]) <= 4096;
}

function isTemplateAppearance(value: unknown): value is TemplateAppearance {
  if (!isRecord(value)) return false;
  if (!exact(value, ["supported", "unsupported"])) return false;
  if (!Array.isArray(value["supported"]) || !Array.isArray(value["unsupported"])) return false;
  if (value["supported"].length + value["unsupported"].length !== TEMPLATE_APPEARANCE_KINDS.length) return false;
  const validKind = (kind: unknown): kind is TemplateAppearanceKind =>
    typeof kind === "string" && TEMPLATE_APPEARANCE_KINDS.includes(kind as TemplateAppearanceKind);
  const supported = value["supported"];
  const unsupported = value["unsupported"];
  if (!supported.every(validKind) || !unsupported.every(validKind)) return false;
  const seen = new Set([...supported, ...unsupported]);
  return seen.size === TEMPLATE_APPEARANCE_KINDS.length;
}

export interface StoredTemplateLibrary {
  schema: "worldbend.figma-template-library";
  version: "0.1";
  templates: SavedSpatialTemplate[];
}

export function emptyTemplateLibrary(): StoredTemplateLibrary {
  return {
    schema: "worldbend.figma-template-library",
    version: "0.1",
    templates: [],
  };
}

export function spatialTemplateFromMockup(spec: MockupSpecInput): FigmaSpatialTemplate {
  return {
    schema: "worldbend.spatial-template",
    version: "0.1",
    operation: { kind: "mockup", spec: cloneJson(spec) },
    output: { kind: "single", id: "output" },
  };
}

export function spatialTemplateFromCompositionTask(task: FigmaCompositionTask): FigmaSpatialTemplate {
  return {...cloneJson(compositionTemplate(task)),...(task.kind==="composition"&&task.motion?{motion:cloneJson(task.motion)}:{})} as FigmaSpatialTemplate;
}

export function canvasTemplateFromSet(spec: OwnedCanvasSetSpec, outputNames?: CanvasOutputNames): FigmaCanvasTemplate {
  if (outputNames !== undefined && !isCanvasOutputNames(outputNames, spec.variants.map(v => v.id))) throw Error("Invalid size names");
  return {
    schema: "worldbend.figma-task-template",
    version: "0.1",
    operation: { kind: "canvas", spec: cloneJson(spec) },
    ...(outputNames ? {outputNames: cloneJson(outputNames)} : {}),
  };
}

export function meshTemplateFromSpec(spec: MeshWarpSpecInput): FigmaMeshTemplate {
  return {
    schema: "worldbend.figma-task-template",
    version: "0.1",
    operation: { kind: "mesh", spec: cloneJson(spec) },
  };
}

export function surfaceTemplateFromSpec(spec: SurfaceDeformationSpecInput): FigmaSurfaceTemplate {
  return {
    schema: "worldbend.figma-task-template",
    version: "0.1",
    operation: { kind: "surface", spec: cloneJson(spec) },
  };
}

/** Save the authored recipe, never a generated mesh or one editing view. */
export function deformationTemplateFromWork(
  spec: DeformationWorkSpecInput,
  view: "pin" | "mesh",
): FigmaDeformationTemplate {
  return {
    schema: "worldbend.figma-task-template",
    version: "0.1",
    operation: { kind: "deformation", view, spec: cloneJson(spec) },
  };
}

/** Normalized controls are reusable on another raster; only output size changes. */
export function deformationTemplateWorkForSource(
  work: DeformationWorkSpecInput,
  source: { renderWidth: number; renderHeight: number },
): DeformationWorkSpecInput {
  return { ...cloneJson(work),
    targetSize: { width: source.renderWidth, height: source.renderHeight } };
}

export function templateSourceCount(template: FigmaTaskTemplate): number {
  return template.operation.kind === "mockup" || template.operation.kind === "compositionProgram"
    ? canonicalMockupSourceSlots(template.operation.kind === "mockup"
      ? template.operation.spec
      : template.operation.composition)?.length ?? 0
    : 1;
}

export function templateOutputCount(template: FigmaTaskTemplate): number | undefined {
  return template.operation.kind === "canvas"
    ? template.operation.spec.variants.length
    : undefined;
}

export function normalizeTemplateName(value: string): string | undefined {
  const name = value.trim();
  return name.length >= 1 && name.length <= 80 ? name : undefined;
}

export function isFigmaSpatialTemplate(value: unknown): value is FigmaSpatialTemplate {
  if (
    !isRecord(value) ||
    !exact(value, value["motion"]===undefined?["schema", "version", "operation", "output"]:["schema", "version", "operation", "output","motion"]) ||
    value["schema"] !== "worldbend.spatial-template" ||
    value["version"] !== "0.1" ||
    !isRecord(value["operation"]) || !isRecord(value["output"])
  ) return false;
  if (value["operation"]["kind"] === "mockup") {
    if(value["motion"]!==undefined)return false;
    if (!exact(value["operation"], ["kind", "spec"]) ||
      !isStoredDesignerTask({ kind: "mockup", spec: value["operation"]["spec"] }) ||
      !exact(value["output"], ["kind", "id"]) || value["output"]["kind"] !== "single" ||
      value["output"]["id"] !== "output") return false;
    return canonicalMockupSourceSlots(value["operation"]["spec"] as MockupSpecInput) !== undefined;
  }
  if (value["operation"]["kind"] !== "compositionProgram") return false;
  const output = value["output"];
  const previewOutputId = output["kind"] === "single" && typeof output["id"] === "string"
    ? output["id"]
    : output["kind"] === "canvasSet" && isRecord(output["spec"]) && Array.isArray(output["spec"]["variants"])
      ? (output["spec"]["variants"][0] as { id?: unknown } | undefined)?.id
      : undefined;
  return typeof previewOutputId === "string" && isStoredDesignerTask({
    kind: "composition", template: (({motion,...canonical})=>canonical)(value), previewOutputId, ...(value["motion"]!==undefined?{motion:value["motion"]}:{}),
  });
}

export function isFigmaTaskTemplate(value: unknown): value is FigmaTaskTemplate {
  if (isFigmaSpatialTemplate(value)) return true;
  if (
    !isRecord(value) ||
    !exact(value, ["schema", "version", "operation", ...(value["outputNames"] === undefined ? [] : ["outputNames"])]) ||
    value["schema"] !== "worldbend.figma-task-template" ||
    value["version"] !== "0.1" ||
    !isRecord(value["operation"]) ||
    !exact(value["operation"], ["kind", "spec",
      ...(value["operation"]["kind"] === "deformation" ? ["view"] : [])])
  ) return false;
  const kind = value["operation"]["kind"];
  const spec = value["operation"]["spec"];
  if (value["outputNames"] !== undefined && kind !== "canvas") return false;
  if (kind === "deformation") return isStoredDesignerTask({ kind, view: value["operation"]["view"], spec });
  if (kind === "canvas") return isOwnedCanvasSetSpec(spec) &&
    (value["outputNames"] === undefined || isCanvasOutputNames(value["outputNames"], spec.variants.map(v => v.id)));
  if (kind === "mesh") return isStoredDesignerTask({ kind: "mesh", spec });
  return kind === "surface" && isStoredDesignerTask({ kind: "surface", spec });
}

export function isSavedSpatialTemplate(value: unknown): value is SavedSpatialTemplate {
  if (
    !isRecord(value) ||
    !exact(value, ["id", "name", "template",
      ...(value["slots"] === undefined ? [] : ["slots"]),
      ...(value["readyScene"] === undefined ? [] : ["readyScene"]),
      ...(value["nativeScene"] === undefined ? [] : ["nativeScene"]),
      ...(value["appearance"] === undefined ? [] : ["appearance"])]) ||
    !isSafeId(value["id"]) ||
    typeof value["name"] !== "string" ||
    normalizeTemplateName(value["name"]) !== value["name"] ||
    !isFigmaTaskTemplate(value["template"]) ||
    (value["readyScene"] !== undefined && (!isReadySceneId(value["readyScene"]) || value["nativeScene"] !== undefined)) ||
    (value["nativeScene"] !== undefined && (!isNativeSceneReference(value["nativeScene"]) ||
      (value["template"].operation.kind !== "mockup" && value["template"].operation.kind !== "compositionProgram")))
  ) return false;
  const slots = value["slots"];
  const appearance = value["appearance"];
  const ready = value["readyScene"];
  const scene = value["nativeScene"];
  const template = value["template"];
  if (ready !== undefined && (value["id"] !== `ready-${ready}` || template.operation.kind !== "mockup" ||
    !sameJsonValue(template.operation.spec, readySceneMockup(readyScene(ready as ReadySceneId))))) return false;
  if (ready === undefined && (value["id"] as string).startsWith("ready-")) return false;
  if (scene !== undefined && (scene as NativeSceneReference).sourceNodeIds.length !== templateSourceCount(template)) return false;
  const expectedSlots = ready !== undefined ? 1 : scene !== undefined
    ? (scene as NativeSceneReference).replaceSourceNodeIds.length : templateSourceCount(template);
  const derivedAppearance = templateAppearance(template);
  return (slots === undefined ||
      (Array.isArray(slots) && slots.length === expectedSlots && slots.every(isTemplateSlot))) &&
    (appearance === undefined || (isTemplateAppearance(appearance) &&
      // A cached older boundary can understate newer support. It may never
      // claim behavior absent from the actual saved operation.
      appearance.supported.every(kind => derivedAppearance.supported.includes(kind))));
}

export function parseTemplateLibrary(value: unknown): StoredTemplateLibrary | undefined {
  if (
    !isRecord(value) ||
    !exact(value, ["schema", "version", "templates"]) ||
    value["schema"] !== "worldbend.figma-template-library" ||
    value["version"] !== "0.1" ||
    !Array.isArray(value["templates"]) ||
    value["templates"].length > MAX_SAVED_SPATIAL_TEMPLATES ||
    !value["templates"].every(isSavedSpatialTemplate) ||
    value["templates"].some(template => template.readyScene !== undefined)
  ) return undefined;
  const ids = new Set(value["templates"].map((template) => template.id));
  if (ids.size !== value["templates"].length) return undefined;
  try {
    if (utf8ByteLength(JSON.stringify(value)) > MAX_TEMPLATE_LIBRARY_BYTES) return undefined;
  } catch {
    return undefined;
  }
  const library = cloneJson(value) as unknown as StoredTemplateLibrary;
  for (const template of library.templates) if (template.appearance) template.appearance = templateAppearance(template.template);
  return library;
}


export function checkedTemplateLibrary(
  templates: readonly SavedSpatialTemplate[],
): StoredTemplateLibrary | undefined {
  return parseTemplateLibrary({
    schema: "worldbend.figma-template-library",
    version: "0.1",
    templates: [...templates],
  });
}

function canonicalMockupSourceSlots(spec: MockupSpecInput): string[] | undefined {
  const slots: string[] = [];
  const seen = new Set<string>();
  for (const plane of spec.planes) {
    if (seen.has(plane.sourceId)) continue;
    seen.add(plane.sourceId);
    slots.push(plane.sourceId);
  }
  if (
    slots.length < 1 ||
    slots.length > 8 ||
    [...slots].sort((a, b) => Number(a.slice(7)) - Number(b.slice(7))).some((slot, index) => slot !== `source-${index + 1}`)
  ) return undefined;
  return slots.sort((a, b) => Number(a.slice(7)) - Number(b.slice(7)));
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}

function exact(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
