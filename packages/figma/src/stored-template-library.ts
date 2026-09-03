import type {
  MockupSpecInput,
  SpatialTemplateSpecInput,
} from "@worldbend/web/types";
import { isStoredDesignerTask } from "./stored-designer-task";
import {
  isOwnedCanvasSetSpec,
  type OwnedCanvasSetSpec,
} from "./stored-canvas";
import { isRecord } from "./stored-plane";

export const TEMPLATE_LIBRARY_STORAGE_KEY = "worldbend.spatial-templates.v1";
export const MAX_SAVED_SPATIAL_TEMPLATES = 32;
export const MAX_TEMPLATE_LIBRARY_BYTES = 512 * 1024;

export type FigmaSpatialTemplate = Omit<
  SpatialTemplateSpecInput,
  "operation" | "output"
> & {
  operation: { kind: "mockup"; spec: MockupSpecInput };
  output: { kind: "single"; id: "output" };
};

export interface FigmaCanvasTemplate {
  schema: "worldbend.figma-task-template";
  version: "0.1";
  operation: { kind: "canvas"; spec: OwnedCanvasSetSpec };
}

export type FigmaTaskTemplate = FigmaSpatialTemplate | FigmaCanvasTemplate;

export interface SavedSpatialTemplate {
  id: string;
  name: string;
  template: FigmaTaskTemplate;
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

export function canvasTemplateFromSet(spec: OwnedCanvasSetSpec): FigmaCanvasTemplate {
  return {
    schema: "worldbend.figma-task-template",
    version: "0.1",
    operation: { kind: "canvas", spec: cloneJson(spec) },
  };
}

export function templateSourceCount(template: FigmaTaskTemplate): number {
  return template.operation.kind === "canvas"
    ? 1
    : canonicalMockupSourceSlots(template.operation.spec)?.length ?? 0;
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
    !exact(value, ["schema", "version", "operation", "output"]) ||
    value["schema"] !== "worldbend.spatial-template" ||
    value["version"] !== "0.1" ||
    !isRecord(value["operation"]) ||
    !exact(value["operation"], ["kind", "spec"]) ||
    value["operation"]["kind"] !== "mockup" ||
    !isStoredDesignerTask({ kind: "mockup", spec: value["operation"]["spec"] }) ||
    !isRecord(value["output"]) ||
    !exact(value["output"], ["kind", "id"]) ||
    value["output"]["kind"] !== "single" ||
    value["output"]["id"] !== "output"
  ) return false;
  return canonicalMockupSourceSlots(value["operation"]["spec"] as MockupSpecInput) !== undefined;
}

export function isFigmaTaskTemplate(value: unknown): value is FigmaTaskTemplate {
  if (isFigmaSpatialTemplate(value)) return true;
  return (
    isRecord(value) &&
    exact(value, ["schema", "version", "operation"]) &&
    value["schema"] === "worldbend.figma-task-template" &&
    value["version"] === "0.1" &&
    isRecord(value["operation"]) &&
    exact(value["operation"], ["kind", "spec"]) &&
    value["operation"]["kind"] === "canvas" &&
    isOwnedCanvasSetSpec(value["operation"]["spec"])
  );
}

export function isSavedSpatialTemplate(value: unknown): value is SavedSpatialTemplate {
  return (
    isRecord(value) &&
    exact(value, ["id", "name", "template"]) &&
    isSafeId(value["id"]) &&
    typeof value["name"] === "string" &&
    normalizeTemplateName(value["name"]) === value["name"] &&
    isFigmaTaskTemplate(value["template"])
  );
}

export function parseTemplateLibrary(value: unknown): StoredTemplateLibrary | undefined {
  if (
    !isRecord(value) ||
    !exact(value, ["schema", "version", "templates"]) ||
    value["schema"] !== "worldbend.figma-template-library" ||
    value["version"] !== "0.1" ||
    !Array.isArray(value["templates"]) ||
    value["templates"].length > MAX_SAVED_SPATIAL_TEMPLATES ||
    !value["templates"].every(isSavedSpatialTemplate)
  ) return undefined;
  const ids = new Set(value["templates"].map((template) => template.id));
  if (ids.size !== value["templates"].length) return undefined;
  try {
    if (utf8ByteLength(JSON.stringify(value)) > MAX_TEMPLATE_LIBRARY_BYTES) return undefined;
  } catch {
    return undefined;
  }
  return cloneJson(value) as unknown as StoredTemplateLibrary;
}

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x7f) bytes += 1;
    else if (codePoint <= 0x7ff) bytes += 2;
    else if (codePoint <= 0xffff) bytes += 3;
    else bytes += 4;
  }
  return bytes;
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
    slots.some((slot, index) => slot !== `source-${index + 1}`)
  ) return undefined;
  return slots;
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
