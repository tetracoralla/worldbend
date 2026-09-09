import type { NineNumbers, Size, TransformSpec } from "@worldbend/web/types";
import { isRecord, parseOwnedTransformSpec, SHARED_NAMESPACE } from "./stored-plane";
import type { SharedOperationReader } from "./stored-operation";
import type { Placement } from "./messages";

export const SHARED_NATIVE_RENDERER_KEY = "nativeRenderer";
export const SHARED_NATIVE_KEY = "native";
const MATRIX_NAMES = ["h00", "h01", "h02", "h10", "h11", "h12", "h20", "h21", "h22"] as const;
export interface NativeRenderer {
  id: string;
  propertyIds: string[];
  extentPropertyIds: [string, string];
}

export interface NativeProjection {
  schema: "worldbend.figma.native";
  version: "0.2";
  resultNodeId: string;
  contentNodeId: string;
  surfaceNodeId: string;
  shaderId: string;
  sourceSize: Size;
  outputSize: Size;
  /** Durable page placement; live Agent snapshots use the current parent's coordinates. */
  placement: Placement;
  operation: string;
  properties: Record<string, number>;
}

/** Convert the recorded surface UV view box to the current output view box.
 * Resize changes the outer clip; Scale changes the whole surface. Neither
 * rewrites the shader. Returning the old normalized quad would stretch the
 * visible mapping on a no-op reopen/update after an ordinary native Resize.
 * This is unit conversion only; geometry validation and solving stay in core.
 */
export function nativeCurrentSpec(record: NativeProjection, surface: Size, output: Size): TransformSpec {
  const spec = JSON.parse(record.operation) as TransformSpec;
  const x = surface.width / Math.ceil(Math.max(record.sourceSize.width, record.outputSize.width)) * record.outputSize.width / output.width;
  const y = surface.height / Math.ceil(Math.max(record.sourceSize.height, record.outputSize.height)) * record.outputSize.height / output.height;
  for (const point of Object.values(spec.destination.quad)) {
    point.x *= x; point.y *= y;
  }
  return spec;
}

/** A file opts in to an explicitly provisioned, reviewed sampler build. */
export function nativeRendererId(page: SharedOperationReader): string | undefined {
  const raw = page.getSharedPluginData(SHARED_NAMESPACE, SHARED_NATIVE_RENDERER_KEY);
  if (!raw || raw.length > 1024) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) && Object.keys(value).length === 3 &&
      value["schema"] === "worldbend.figma.projective-sampler" && value["version"] === "0.1" &&
      typeof value["id"] === "string" && /^[a-zA-Z0-9-]+\/[a-f0-9]{40}$/.test(value["id"])
      ? value["id"] : undefined;
  } catch { return undefined; }
}

export function nativeRendererFromShader(shader: {
  id: string;
  type: string;
  propertyDefinitions: Record<string, { name: string; type: string }>;
}): NativeRenderer | undefined {
  const entries = Object.entries(shader.propertyDefinitions);
  if (shader.type !== "effect" || entries.length !== 11) return undefined;
  const propertyIds = MATRIX_NAMES.map((name) =>
    entries.find(([, definition]) => definition.name === name && definition.type === "NUMBER")?.[0]);
  const extentPropertyIds = ["sourceRight", "sourceBottom"].map((name) =>
    entries.find(([, definition]) => definition.name === name && definition.type === "NUMBER")?.[0]);
  return propertyIds.every((id) => id !== undefined) && extentPropertyIds.every((id) => id !== undefined)
    ? { id: shader.id, propertyIds, extentPropertyIds: extentPropertyIds as [string, string] } : undefined;
}

/** Only unit conversion. Solving and inversion stay in worldbend-core. */
export function nativeShaderProperties(
  renderer: NativeRenderer,
  inverse: NineNumbers,
  source: Size,
  surface: Size,
): Record<string, number> {
  const properties: Record<string, number> = {};
  if (renderer.propertyIds.length !== 9 ||
    renderer.extentPropertyIds.length !== 2 ||
    ![source, surface].every((size) =>
      Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0)) {
    throw new Error("Invalid native projection dimensions");
  }
  for (let index = 0; index < 9; index++) {
    // inverse maps output pixels to source UV. The shader first checks that
    // UV against the source plane, then maps it to the input texture region.
    const columnScale = index % 3 === 0 ? surface.width : index % 3 === 1 ? surface.height : 1;
    const value = Math.fround(inverse[index]! * columnScale);
    if (!Number.isFinite(value) || Math.abs(value) > 1e6) throw new Error("Native projection exceeds sampler range");
    properties[renderer.propertyIds[index]!] = value;
  }
  properties[renderer.extentPropertyIds[0]] = Math.fround(source.width / surface.width);
  properties[renderer.extentPropertyIds[1]] = Math.fround(source.height / surface.height);
  if (renderer.extentPropertyIds.some((id) => properties[id]! < 1e-6 || properties[id]! > 1)) {
    throw new Error("Native source region exceeds sampler range");
  }
  return properties;
}

export function readNativeProjection(node: SharedOperationReader & { id: string }): NativeProjection | undefined {
  const raw = node.getSharedPluginData(SHARED_NAMESPACE, SHARED_NATIVE_KEY);
  if (!raw || raw.length > 4096) return undefined;
  try {
    const v: unknown = JSON.parse(raw);
    if (!isRecord(v) || Object.keys(v).length !== 11 || v["schema"] !== "worldbend.figma.native" ||
      v["version"] !== "0.2" || v["resultNodeId"] !== node.id ||
      ![v["contentNodeId"], v["surfaceNodeId"], v["shaderId"]].every((id) =>
        typeof id === "string" && id.length > 0 && id.length <= 256) ||
      v["contentNodeId"] === v["surfaceNodeId"] || v["contentNodeId"] === node.id || v["surfaceNodeId"] === node.id ||
      !isRecord(v["sourceSize"]) || Object.keys(v["sourceSize"]).length !== 2 ||
      ![v["sourceSize"]["width"], v["sourceSize"]["height"]].every((axis) =>
        typeof axis === "number" && Number.isFinite(axis) && axis > 0 && axis <= 4096) ||
      !isRecord(v["outputSize"]) || Object.keys(v["outputSize"]).length !== 2 ||
      ![v["outputSize"]["width"], v["outputSize"]["height"]].every((axis) =>
        typeof axis === "number" && Number.isFinite(axis) && axis > 0 && axis <= 4096) ||
      !isRecord(v["placement"]) || Object.keys(v["placement"]).length !== 4 ||
      ![v["placement"]["x"], v["placement"]["y"]].every((axis) => typeof axis === "number" && Number.isFinite(axis)) ||
      v["placement"]["width"] !== v["outputSize"]["width"] || v["placement"]["height"] !== v["outputSize"]["height"] ||
      typeof v["operation"] !== "string" || v["operation"].length > 2048 ||
      !parseOwnedTransformSpec(v["operation"]) ||
      v["operation"] !== node.getSharedPluginData(SHARED_NAMESPACE, "transform") ||
      !isRecord(v["properties"]) || Object.keys(v["properties"]).length !== 11 ||
      !Object.values(v["properties"]).every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e6)) return undefined;
    return v as unknown as NativeProjection;
  } catch { return undefined; }
}

/** Read a duplicate's old record without ever resolving its old node IDs. */
export function readCopiedNativeProjection(node: SharedOperationReader & { id: string }): NativeProjection | undefined {
  const raw = node.getSharedPluginData(SHARED_NAMESPACE, SHARED_NATIVE_KEY);
  if (!raw || raw.length > 4096) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value["resultNodeId"] !== "string" ||
      !value["resultNodeId"] || value["resultNodeId"].length > 256 || value["resultNodeId"] === node.id) return undefined;
    return readNativeProjection({ id: value["resultNodeId"],
      getSharedPluginData: (namespace, key) => node.getSharedPluginData(namespace, key) });
  } catch { return undefined; }
}
