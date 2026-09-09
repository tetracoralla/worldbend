import type { NineNumbers, RectifySpecInput, TransformSpec } from "@worldbend/web/types";
import type { NativeRenderer } from "./native-projective";
import {
  isFigmaImageAxis,
  isOwnedRectifySpec,
  isOwnedTransformSpec,
  isRecord,
} from "./stored-plane";
import {
  isLocalePreference,
  isSupportedLocale,
  type LocalePreference,
  type SupportedLocale,
  type UserMessage,
} from "./i18n";
import {
  isOwnedCanvasSetSpec,
  ownedCanvasOperationOutput,
  type OwnedCanvasSetSpec,
  type OwnedCanvasSpec,
} from "./stored-canvas";
import {
  MAX_FIGMA_CANVAS_PIXELS,
  MAX_FIGMA_CANVAS_VARIANTS,
} from "./canvas-state";
import {
  isStoredDesignerTask,
  type StoredDesignerTask,
} from "./stored-designer-task";
import {
  isFigmaTaskTemplate,
  normalizeTemplateName,
  type FigmaTaskTemplate,
  type SavedSpatialTemplate,
} from "./stored-template-library";

export interface SourceRasterPayload {
  bytes: Uint8Array;
  sourceNodeId: string;
  sourceName: string;
  renderWidth: number;
  renderHeight: number;
  placement: { x: number; y: number; width: number; height: number };
}

export interface SourcePayload extends SourceRasterPayload {
  sources?: SourceRasterPayload[];
  spec?: TransformSpec;
  rectification?: RectifySpecInput;
  canvas?: OwnedCanvasSpec;
  task?: StoredDesignerTask;
  targetNodeId?: string;
  nativeRenderer?: NativeRenderer;
  nativeRendererPending?: true;
  nativeTarget?: true;
}

export interface NativeApplyPayload {
  generation: number;
  spec: TransformSpec;
  inverse: NineNumbers;
  sourceNodeId: string;
  targetNodeId?: string;
  renderWidth: number;
  renderHeight: number;
  placement: Placement;
  duplicate?: boolean;
}

export type Placement = SourcePayload["placement"];

export type TemplateMutationReceipt =
  | {
      kind: "save";
      workspace: "canvas" | "mockup";
      requestId: number;
    }
  | { kind: "delete"; requestId: number };

export type MainToUiMessage =
  | { type: "locale"; preference: LocalePreference; locale: SupportedLocale }
  | { type: "preference-error"; message: UserMessage }
  | {
      type: "template-library";
      templates: SavedSpatialTemplate[];
      mutation?: TemplateMutationReceipt;
    }
  | {
      type: "template-library-error";
      message: UserMessage;
      mutation?: TemplateMutationReceipt;
    }
  | { type: "selection-loading"; generation: number; nodeIds: string[] }
  | { type: "source"; generation: number; payload: SourcePayload }
  | { type: "source-renderer"; generation: number; sourceNodeId: string; targetNodeId?: string; renderer?: NativeRenderer }
  | { type: "selection-error"; generation: number; message: UserMessage; nativeRecovery?: { nodeId: string; expected: string } }
  | {
      type: "source-raster";
      generation: number;
      requestId: number;
      bytes: Uint8Array;
    }
  | {
      type: "source-raster-error";
      generation: number;
      requestId: number;
      message: UserMessage;
    }
  | {
      type: "apply-complete";
      generation: number;
      targetNodeId: string;
      operation: "apply" | "replace";
    }
  | { type: "apply-error"; generation: number; message: UserMessage }
  | {
      type: "apply-canvas-complete";
      generation: number;
      targetNodeIds: string[];
      operation: "apply" | "replace";
    }
  | { type: "apply-canvas-error"; generation: number; message: UserMessage }
  | {
      type: "apply-designer-complete";
      generation: number;
      targetNodeId: string;
      operation: "apply" | "replace";
    }
  | { type: "apply-designer-error"; generation: number; message: UserMessage };

export type UiToMainMessage =
  | { type: "restore-native"; generation: number; nodeId: string; expected: string }
  | { type: "apply-native"; payload: NativeApplyPayload }
  | { type: "ready"; systemLocales: string[] }
  | { type: "set-locale"; preference: LocalePreference }
  | {
      type: "save-template";
      workspace: "canvas" | "mockup";
      requestId: number;
      name: string;
      template: FigmaTaskTemplate;
    }
  | { type: "delete-template"; requestId: number; id: string }
  | { type: "trigger-undo" }
  | {
      type: "request-source-raster";
      generation: number;
      requestId: number;
      sourceNodeId: string;
      targetNodeId?: string;
      desiredWidth: number;
      desiredHeight: number;
    }
  | {
      type: "apply";
      payload: {
        generation: number;
        bytes: Uint8Array;
        spec?: TransformSpec;
        rectification?: RectifySpecInput;
        sourceNodeId: string;
        renderWidth: number;
        renderHeight: number;
        placement: Placement;
        targetNodeId?: string;
        /** Create a new result instead of replacing an existing pair target. */
        duplicate?: boolean;
      };
    }
  | {
      type: "apply-canvas";
      payload: {
        generation: number;
        sourceNodeId: string;
        setSpec: OwnedCanvasSetSpec;
        outputs: Array<{
          id: string;
          bytes: Uint8Array;
          renderWidth: number;
          renderHeight: number;
          placement: Placement;
        }>;
        targetNodeId?: string;
        /** Create a new result instead of replacing the selected Canvas result. */
        duplicate?: boolean;
      };
    }
  | {
      type: "apply-designer";
      payload: {
        generation: number;
        task: StoredDesignerTask;
        sourceNodeIds: string[];
        bytes: Uint8Array;
        renderWidth: number;
        renderHeight: number;
        placement: Placement;
        targetNodeId?: string;
        duplicate?: boolean;
      };
    };

export function isUiToMainMessage(value: unknown): value is UiToMainMessage {
  if (!isRecord(value) || typeof value["type"] !== "string") return false;
  if (value["type"] === "restore-native") return hasExactKeys(value, ["type", "generation", "nodeId", "expected"]) &&
    isRequestId(value["generation"]) && typeof value["nodeId"] === "string" && value["nodeId"].length > 0 && value["nodeId"].length <= 256 &&
    typeof value["expected"] === "string" && value["expected"].length > 0 && value["expected"].length <= 4096;
  if (value["type"] === "ready") {
    return (
      Object.keys(value).length === 2 &&
      Array.isArray(value["systemLocales"]) &&
      value["systemLocales"].length <= 16 &&
      value["systemLocales"].every(
        (locale) => typeof locale === "string" && locale.length > 0 && locale.length <= 64,
      )
    );
  }
  if (value["type"] === "set-locale") {
    return Object.keys(value).length === 2 && isLocalePreference(value["preference"]);
  }
  if (value["type"] === "save-template") {
    return (
      hasExactKeys(value, ["type", "workspace", "requestId", "name", "template"]) &&
      (value["workspace"] === "canvas" || value["workspace"] === "mockup") &&
      isRequestId(value["requestId"]) &&
      typeof value["name"] === "string" &&
      normalizeTemplateName(value["name"]) === value["name"] &&
      isFigmaTaskTemplate(value["template"]) &&
      value["template"].operation.kind === value["workspace"]
    );
  }
  if (value["type"] === "delete-template") {
    return (
      hasExactKeys(value, ["type", "requestId", "id"]) &&
      isRequestId(value["requestId"]) &&
      typeof value["id"] === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value["id"])
    );
  }
  if (value["type"] === "trigger-undo") return Object.keys(value).length === 1;
  if (value["type"] === "request-source-raster") {
    const allowed = new Set([
      "type",
      "generation",
      "requestId",
      "sourceNodeId",
      "targetNodeId",
      "desiredWidth",
      "desiredHeight",
    ]);
    return (
      !Object.keys(value).some((key) => !allowed.has(key)) &&
      Number.isSafeInteger(value["generation"]) &&
      Number(value["generation"]) >= 1 &&
      Number.isSafeInteger(value["requestId"]) &&
      Number(value["requestId"]) >= 1 &&
      typeof value["sourceNodeId"] === "string" &&
      value["sourceNodeId"].length > 0 &&
      (value["targetNodeId"] === undefined ||
        (typeof value["targetNodeId"] === "string" && value["targetNodeId"].length > 0)) &&
      isFigmaImageAxis(value["desiredWidth"]) &&
      isFigmaImageAxis(value["desiredHeight"])
    );
  }
  if (value["type"] === "apply-canvas") return isApplyCanvasMessage(value);
  if (value["type"] === "apply-designer") return isApplyDesignerMessage(value);
  if (value["type"] === "apply-native") {
    if (!hasExactKeys(value, ["type", "payload"]) || !isRecord(value["payload"])) return false;
    const p = value["payload"];
    return hasExactKeys(p, ["generation", "spec", "inverse", "sourceNodeId", "renderWidth", "renderHeight", "placement",
      ...(p["targetNodeId"] === undefined ? [] : ["targetNodeId"]),
      ...(p["duplicate"] === undefined ? [] : ["duplicate"])]) &&
      isRequestId(p["generation"]) && isOwnedTransformSpec(p["spec"]) && !p["spec"].content.warp &&
      Array.isArray(p["inverse"]) && p["inverse"].length === 9 &&
      p["inverse"].every((n) => typeof n === "number" && Number.isFinite(n)) &&
      typeof p["sourceNodeId"] === "string" && p["sourceNodeId"].length > 0 && p["sourceNodeId"].length <= 256 &&
      isFigmaImageAxis(p["renderWidth"]) && isFigmaImageAxis(p["renderHeight"]) && isPlacement(p["placement"]) &&
      (p["targetNodeId"] === undefined || (typeof p["targetNodeId"] === "string" && p["targetNodeId"].length > 0 && p["targetNodeId"].length <= 256)) &&
      (p["duplicate"] === undefined || typeof p["duplicate"] === "boolean");
  }
  if (value["type"] !== "apply" || !isRecord(value["payload"])) return false;
  const payload = value["payload"];
  const allowed = new Set([
    "generation",
    "bytes",
    "spec",
    "rectification",
    "sourceNodeId",
    "renderWidth",
    "renderHeight",
    "placement",
    "targetNodeId",
    "duplicate",
  ]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) return false;
  if (
    !Number.isSafeInteger(payload["generation"]) ||
    Number(payload["generation"]) < 1 ||
    !(payload["bytes"] instanceof Uint8Array) ||
    payload["bytes"].byteLength < 1 ||
    payload["bytes"].byteLength > 128 * 1024 * 1024 ||
    (isOwnedTransformSpec(payload["spec"]) ===
      isOwnedRectifySpec(payload["rectification"])) ||
    typeof payload["sourceNodeId"] !== "string" ||
    payload["sourceNodeId"].length === 0 ||
    !isFigmaImageAxis(payload["renderWidth"]) ||
    !isFigmaImageAxis(payload["renderHeight"])
    || !isPlacement(payload["placement"])
  ) {
    return false;
  }
  if (payload["duplicate"] !== undefined && typeof payload["duplicate"] !== "boolean") {
    return false;
  }
  return (
    payload["targetNodeId"] === undefined ||
    (typeof payload["targetNodeId"] === "string" && payload["targetNodeId"].length > 0)
  );
}

function isRequestId(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function isApplyDesignerMessage(
  value: Record<string, unknown>,
): value is Extract<UiToMainMessage, { type: "apply-designer" }> {
  if (!hasExactKeys(value, ["type", "payload"]) || !isRecord(value["payload"])) return false;
  const payload = value["payload"];
  const expected = [
    "generation", "task", "sourceNodeIds", "bytes", "renderWidth", "renderHeight", "placement",
    ...(payload["targetNodeId"] === undefined ? [] : ["targetNodeId"]),
    ...(payload["duplicate"] === undefined ? [] : ["duplicate"]),
  ];
  return (
    hasExactKeys(payload, expected) &&
    Number.isSafeInteger(payload["generation"]) &&
    Number(payload["generation"]) >= 1 &&
    isStoredDesignerTask(payload["task"]) &&
    Array.isArray(payload["sourceNodeIds"]) &&
    payload["sourceNodeIds"].length >= 1 &&
    payload["sourceNodeIds"].length <= 8 &&
    new Set(payload["sourceNodeIds"]).size === payload["sourceNodeIds"].length &&
    payload["sourceNodeIds"].every((id) => typeof id === "string" && id.length > 0) &&
    payload["bytes"] instanceof Uint8Array &&
    payload["bytes"].byteLength >= 1 &&
    payload["bytes"].byteLength <= 128 * 1024 * 1024 &&
    isFigmaImageAxis(payload["renderWidth"]) &&
    isFigmaImageAxis(payload["renderHeight"]) &&
    isPlacement(payload["placement"]) &&
    (payload["targetNodeId"] === undefined ||
      (typeof payload["targetNodeId"] === "string" && payload["targetNodeId"].length > 0)) &&
    (payload["duplicate"] === undefined || typeof payload["duplicate"] === "boolean")
  );
}

function isApplyCanvasMessage(
  value: Record<string, unknown>,
): value is Extract<UiToMainMessage, { type: "apply-canvas" }> {
  if (!hasExactKeys(value, ["type", "payload"]) || !isRecord(value["payload"])) return false;
  const payload = value["payload"];
  if (
    !hasExactKeys(payload, [
      "generation",
      "sourceNodeId",
      "setSpec",
      "outputs",
      ...(payload["targetNodeId"] === undefined ? [] : ["targetNodeId"]),
      ...(payload["duplicate"] === undefined ? [] : ["duplicate"]),
    ]) ||
    !Number.isSafeInteger(payload["generation"]) ||
    Number(payload["generation"]) < 1 ||
    typeof payload["sourceNodeId"] !== "string" ||
    payload["sourceNodeId"].length === 0 ||
    !isOwnedCanvasSetSpec(payload["setSpec"]) ||
    !Array.isArray(payload["outputs"]) ||
    payload["outputs"].length < 1 ||
    payload["outputs"].length > MAX_FIGMA_CANVAS_VARIANTS ||
    payload["outputs"].length !== payload["setSpec"].variants.length ||
    (payload["targetNodeId"] !== undefined &&
      (typeof payload["targetNodeId"] !== "string" || payload["targetNodeId"].length === 0)) ||
    (payload["duplicate"] !== undefined && typeof payload["duplicate"] !== "boolean") ||
    (payload["targetNodeId"] !== undefined && payload["outputs"].length !== 1)
  ) {
    return false;
  }
  let pixels = 0;
  let bytes = 0;
  for (let index = 0; index < payload["outputs"].length; index += 1) {
    const output = payload["outputs"][index];
    const variant = payload["setSpec"].variants[index];
    const declaredOutput = variant
      ? ownedCanvasOperationOutput(variant.operation)
      : undefined;
    if (
      !isRecord(output) ||
      !hasExactKeys(output, ["id", "bytes", "renderWidth", "renderHeight", "placement"]) ||
      !variant ||
      output["id"] !== variant.id ||
      !(output["bytes"] instanceof Uint8Array) ||
      output["bytes"].byteLength < 1 ||
      !isFigmaImageAxis(output["renderWidth"]) ||
      !isFigmaImageAxis(output["renderHeight"]) ||
      (declaredOutput !== undefined &&
        (output["renderWidth"] !== declaredOutput.width ||
          output["renderHeight"] !== declaredOutput.height)) ||
      !isPlacement(output["placement"]) ||
      !sameAspectRatio(
        output["placement"],
        output["renderWidth"],
        output["renderHeight"],
      )
    ) {
      return false;
    }
    pixels += output["renderWidth"] * output["renderHeight"];
    bytes += output["bytes"].byteLength;
    if (
      !Number.isSafeInteger(pixels) ||
      pixels > MAX_FIGMA_CANVAS_PIXELS ||
      !Number.isSafeInteger(bytes) ||
      bytes > 128 * 1024 * 1024
    ) {
      return false;
    }
  }
  return true;
}

function sameAspectRatio(placement: Placement, width: number, height: number): boolean {
  const left = placement.width * height;
  const right = placement.height * width;
  const tolerance = Number.EPSILON * 16 * Math.max(1, Math.abs(left), Math.abs(right));
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
}

function isPlacement(value: unknown): value is Placement {
  if (!isRecord(value)) return false;
  if (
    Object.keys(value).length !== 4 ||
    !["x", "y", "width", "height"].every((key) => key in value)
  ) {
    return false;
  }
  const x = value["x"];
  const y = value["y"];
  const width = value["width"];
  const height = value["height"];
  return (
    typeof x === "number" &&
    Number.isFinite(x) &&
    typeof y === "number" &&
    Number.isFinite(y) &&
    typeof width === "number" &&
    Number.isFinite(width) &&
    width > 0 &&
    typeof height === "number" &&
    Number.isFinite(height) &&
    height > 0
  );
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export function isMainToUiLocaleMessage(
  value: unknown,
): value is Extract<MainToUiMessage, { type: "locale" }> {
  return (
    isRecord(value) &&
    value["type"] === "locale" &&
    Object.keys(value).length === 3 &&
    isLocalePreference(value["preference"]) &&
    isSupportedLocale(value["locale"])
  );
}
