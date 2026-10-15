import { isNativeSceneReference, type NativeSceneReference } from "./native-scene-model";

/**
 * Bounded Agent-side summary of the saved reusable scene templates. This
 * module is deliberately self-contained: it rides inside the 32 KiB Figma
 * handoff runtime, so it re-derives the summary envelope (ids, names, slot
 * and appearance facts) without pulling the full library validators into
 * the packet. The plugin's own load path remains the authority for using a
 * template; a record that fails this envelope is not listed at all.
 */

export type TemplateSummaryKind =
  | "mockup"
  | "compositionProgram"
  | "canvas"
  | "mesh"
  | "surface"
  | "deformation";

export interface TemplateSummarySlot {
  name: string;
  width: number;
  height: number;
}

export interface TemplateSummaryAppearance {
  supported: string[];
  unsupported: string[];
}

export interface TemplateSummary {
  id: string;
  name: string;
  kind: TemplateSummaryKind;
  sourceCount: number;
  slots?: TemplateSummarySlot[];
  appearance?: TemplateSummaryAppearance;
  nativeScene?: NativeSceneReference;
  /** Actual containing page; the stored nativeScene pageId is only a hint. */
  pageId?: string;
}

const MAX_TEMPLATE_LIBRARY_BYTES = 512 * 1024;
const APPEARANCE_KINDS = ["perspective", "opacity", "clip", "masking", "occlusion", "lighting"];
const TEMPLATE_KINDS: readonly TemplateSummaryKind[] = [
  "mockup", "compositionProgram", "canvas", "mesh", "surface", "deformation",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function isSummarySlot(value: unknown): value is TemplateSummarySlot {
  if (!isRecord(value) || !exactKeys(value, ["name", "width", "height"])) return false;
  const name = value["name"];
  const width = value["width"];
  const height = value["height"];
  return typeof name === "string" && name.length >= 1 && name.length <= 128 &&
    Number.isSafeInteger(width) && Number(width) >= 1 && Number(width) <= 4096 &&
    Number.isSafeInteger(height) && Number(height) >= 1 && Number(height) <= 4096;
}

function isSummaryAppearance(value: unknown): value is TemplateSummaryAppearance {
  if (!isRecord(value) || !exactKeys(value, ["supported", "unsupported"]) ||
    !Array.isArray(value["supported"]) || !Array.isArray(value["unsupported"])) return false;
  const kinds: unknown[] = [...value["supported"], ...value["unsupported"]];
  return kinds.length === APPEARANCE_KINDS.length &&
    kinds.every((kind) => typeof kind === "string" && APPEARANCE_KINDS.includes(kind)) &&
    new Set(kinds).size === APPEARANCE_KINDS.length;
}

/** Distinct canonical `source-N` slots of one Mockup/Composition operation. */
function canonicalSourceCount(spec: unknown): number | undefined {
  if (!isRecord(spec) || !Array.isArray(spec["planes"])) return undefined;
  const seen = new Set<string>();
  for (const plane of spec["planes"]) {
    if (!isRecord(plane) || typeof plane["sourceId"] !== "string") return undefined;
    if (!/^source-[1-8]$/.test(plane["sourceId"])) return undefined;
    seen.add(plane["sourceId"]);
  }
  if (seen.size < 1 || seen.size > 8) return undefined;
  for (let index = 1; index <= seen.size; index += 1) {
    if (!seen.has(`source-${index}`)) return undefined;
  }
  return seen.size;
}

/** Summarize a stored library, or undefined when the envelope is unreadable. */
export function templateLibrarySummary(raw: unknown): TemplateSummary[] | undefined {
  if (raw === undefined || raw === null) return [];
  if (!isRecord(raw) || !exactKeys(raw, ["schema", "version", "templates"]) ||
    raw["schema"] !== "worldbend.figma-template-library" || raw["version"] !== "0.1" ||
    !Array.isArray(raw["templates"]) || raw["templates"].length > 32) return undefined;
  try {
    if (JSON.stringify(raw).length > MAX_TEMPLATE_LIBRARY_BYTES) return undefined;
  } catch {
    return undefined;
  }
  const summaries: TemplateSummary[] = [];
  const ids = new Set<string>();
  for (const record of raw["templates"]) {
    if (!isRecord(record)) return undefined;
    const hasSlots = record["slots"] !== undefined;
    const hasAppearance = record["appearance"] !== undefined;
    const hasScene = record["nativeScene"] !== undefined;
    if (!exactKeys(record, ["id", "name", "template",
      ...(hasSlots ? ["slots"] : []), ...(hasAppearance ? ["appearance"] : []), ...(hasScene ? ["nativeScene"] : [])])) return undefined;
    if (typeof record["id"] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(record["id"]) ||
      ids.has(record["id"])) return undefined;
    ids.add(record["id"]);
    if (typeof record["name"] !== "string" || record["name"].length < 1 || record["name"].length > 80) {
      return undefined;
    }
    const template = record["template"];
    if (!isRecord(template)) return undefined;
    const schema = template["schema"];
    const operation = template["operation"];
    if (!isRecord(operation) || typeof operation["kind"] !== "string" ||
      !TEMPLATE_KINDS.includes(operation["kind"] as TemplateSummaryKind)) return undefined;
    const kind = operation["kind"] as TemplateSummaryKind;
    if (schema === "worldbend.spatial-template") {
      if (!isRecord(template["output"])) return undefined;
    } else if (schema !== "worldbend.figma-task-template" || kind === "compositionProgram") {
      return undefined;
    }
    if (kind === "deformation" &&
      (!exactKeys(operation, ["kind", "view", "spec"]) ||
        (operation["view"] !== "pin" && operation["view"] !== "mesh") ||
        !isRecord(operation["spec"]) || operation["spec"]["schema"] !== "worldbend.deformation-work" ||
        operation["spec"]["version"] !== "0.1")) return undefined;
    let sourceCount: number;
    if (kind === "mockup" || kind === "compositionProgram") {
      const spec = kind === "mockup" ? operation["spec"]
        : isRecord(operation["composition"]) ? operation["composition"] : undefined;
      const count = canonicalSourceCount(spec);
      if (count === undefined) return undefined;
      sourceCount = count;
    } else {
      sourceCount = 1;
    }
    const scene = record["nativeScene"];
    if (hasScene) {
      if (!isNativeSceneReference(scene) || (kind !== "mockup" && kind !== "compositionProgram") || scene.sourceNodeIds.length !== sourceCount) return undefined;
      sourceCount = scene.replaceSourceNodeIds.length;
    }
    const slots = record["slots"];
    if (hasSlots && (!Array.isArray(slots) || slots.length < 1 || slots.length > 8 ||
      !slots.every(isSummarySlot))) return undefined;
    const appearance = record["appearance"];
    if (hasAppearance && !isSummaryAppearance(appearance)) return undefined;
    summaries.push({
      id: record["id"],
      name: record["name"],
      kind,
      sourceCount,
      ...(hasSlots ? { slots: slots as TemplateSummarySlot[] } : {}),
      ...(hasAppearance ? { appearance: appearance as TemplateSummaryAppearance } : {}),
      ...(hasScene ? { nativeScene: scene as NativeSceneReference } : {}),
    });
  }
  return summaries;
}
