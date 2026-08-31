import type {
  MeshWarpSpecInput,
  MockupSpecInput,
  RemapSpecInput,
} from "@worldbend/web/types";
import { isFigmaImageAxis, isOwnedTransformSpec, isRecord } from "./stored-plane";

export const SHARED_DESIGNER_TASK_KEY = "task";

export type StoredDesignerTask =
  | { kind: "mockup"; spec: MockupSpecInput }
  | { kind: "mesh"; spec: MeshWarpSpecInput }
  | { kind: "remap"; spec: RemapSpecInput };

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
  if (!isRecord(value) || !exact(value, ["kind", "spec"])) return false;
  if (value["kind"] === "mesh") return isMeshSpec(value["spec"]);
  if (value["kind"] === "mockup") return isMockupSpec(value["spec"]);
  return value["kind"] === "remap" && isRemapSpec(value["spec"]);
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
    !exact(value["mesh"], ["subdivisions", "vertices"])
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

function isMockupSpec(value: unknown): value is MockupSpecInput {
  if (
    !isRecord(value) ||
    !exact(value, ["schema", "version", "canvas", "background", "planes", "seams"]) ||
    value["schema"] !== "worldbend.mockup" ||
    value["version"] !== "0.1" ||
    !isSize(value["canvas"]) ||
    !isBackground(value["background"]) ||
    !Array.isArray(value["planes"]) ||
    value["planes"].length < 1 ||
    value["planes"].length > 8 ||
    !Array.isArray(value["seams"]) ||
    value["seams"].length !== 0
  ) return false;
  const ids = new Set<string>();
  return value["planes"].every((plane) => {
    if (!isRecord(plane)) return false;
    const allowed = ["id", "sourceId", "transform", "opacity", ...(plane["grid"] === undefined ? [] : ["grid"])];
    if (
      !exact(plane, allowed) ||
      !isId(plane["id"]) ||
      ids.has(String(plane["id"])) ||
      !isId(plane["sourceId"]) ||
      !isOwnedTransformSpec(plane["transform"]) ||
      !isUnit(plane["opacity"])
    ) return false;
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
function exact(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
