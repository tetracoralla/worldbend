import type { TransformSpec } from "@worldbend/web/types";
import { isFigmaImageAxis, isOwnedTransformSpec, isRecord } from "./stored-plane";
import {
  isLocalePreference,
  isSupportedLocale,
  type LocalePreference,
  type SupportedLocale,
  type UserMessage,
} from "./i18n";

export interface SourcePayload {
  bytes: Uint8Array;
  sourceNodeId: string;
  sourceName: string;
  renderWidth: number;
  renderHeight: number;
  placement: { x: number; y: number; width: number; height: number };
  spec?: TransformSpec;
  targetNodeId?: string;
}

export type Placement = SourcePayload["placement"];

export type MainToUiMessage =
  | { type: "locale"; preference: LocalePreference; locale: SupportedLocale }
  | { type: "preference-error"; message: UserMessage }
  | { type: "selection-loading"; generation: number; nodeIds: string[] }
  | { type: "source"; generation: number; payload: SourcePayload }
  | { type: "selection-error"; generation: number; message: UserMessage }
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
  | { type: "apply-error"; generation: number; message: UserMessage };

export type UiToMainMessage =
  | { type: "ready"; systemLocales: string[] }
  | { type: "set-locale"; preference: LocalePreference }
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
        spec: TransformSpec;
        sourceNodeId: string;
        renderWidth: number;
        renderHeight: number;
        placement: Placement;
        targetNodeId?: string;
        /** Create a new result instead of replacing an existing pair target. */
        duplicate?: boolean;
      };
    };

export function isUiToMainMessage(value: unknown): value is UiToMainMessage {
  if (!isRecord(value) || typeof value["type"] !== "string") return false;
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
  if (value["type"] !== "apply" || !isRecord(value["payload"])) return false;
  const payload = value["payload"];
  const allowed = new Set([
    "generation",
    "bytes",
    "spec",
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
    !isOwnedTransformSpec(payload["spec"]) ||
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
