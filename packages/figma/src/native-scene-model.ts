import { isRecord } from "./stored-plane";

/** A file-native scene master. Object identity prevents a client-local record
 * from accidentally resolving an unrelated node in another document. */
export interface NativeSceneReference {
  schema: "worldbend.figma.scene";
  version: "0.1";
  sceneId: string;
  pageId: string;
  rootNodeId: string;
  previewNodeId: string;
  resultNodeId: string;
  sourceNodeIds: string[];
  replaceSourceNodeIds: string[];
}
export const NATIVE_SCENE_KEY = "nativeScene";
export const NATIVE_SCENE_TEMPLATE_KEY = "sceneTemplate";
export const NATIVE_SCENE_CREATION_KEY = "sceneCreation";
export function parseNativeSceneTemplateMarker(raw: string): { id: string; name: string } | undefined {
  if (!raw || raw.length > 2048) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || Object.keys(value).length !== 2 || typeof value["id"] !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value["id"]) || typeof value["name"] !== "string" ||
      value["name"].length < 1 || value["name"].length > 80) return undefined;
    return { id: value["id"], name: value["name"] };
  } catch { return undefined; }
}
const nodeId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256;
export function isNativeSceneReference(value: unknown): value is NativeSceneReference {
  if (!isRecord(value) || Object.keys(value).length !== 9 || value["schema"] !== "worldbend.figma.scene" ||
    value["version"] !== "0.1" || typeof value["sceneId"] !== "string" || !/^[a-zA-Z0-9_-]{16,80}$/.test(value["sceneId"]) ||
    !["pageId", "rootNodeId", "previewNodeId", "resultNodeId"].every(key => nodeId(value[key])) ||
    !Array.isArray(value["sourceNodeIds"]) || !Array.isArray(value["replaceSourceNodeIds"])) return false;
  const sources = value["sourceNodeIds"], replacements = value["replaceSourceNodeIds"];
  return sources.length >= 1 && sources.length <= 8 && sources.every(nodeId) && new Set(sources).size === sources.length &&
    replacements.length >= 1 && replacements.length <= sources.length && replacements.every(id => sources.includes(id)) &&
    new Set(replacements).size === replacements.length && !sources.includes(value["resultNodeId"] as string);
}
export function parseNativeSceneReference(raw: string): NativeSceneReference | undefined {
  if (!raw || raw.length > 8192) return undefined;
  try { const value: unknown = JSON.parse(raw); return isNativeSceneReference(value) ? value : undefined; } catch { return undefined; }
}
export function newNativeSceneId(): string {
  return `scene-${Date.now().toString(36)}-${Array.from({ length: 4 }, () => Math.floor(Math.random() * 0x100000000).toString(36)).join("-")}`;
}
