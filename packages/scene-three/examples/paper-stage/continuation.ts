import type { SpatialDocumentSpec } from "../../src/index";

// Host authoring policy only. Every result still passes through the ordinary
// core update plan and guarded SceneSession; this never evaluates scene geometry.
export type Choice = "local" | "source";
export interface Difference {
  path: string;
  local: unknown;
  source: unknown;
}
const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (object(a) && object(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]));
  }
  return false;
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const pointer = (key: string) => key.replaceAll("~", "~0").replaceAll("/", "~1");

export function continueFromAuthor(
  base: SpatialDocumentSpec,
  local: SpatialDocumentSpec,
  source: SpatialDocumentSpec,
  choices: Record<string, Choice> = {},
  ownedFields: string[] = [],
) {
  const conflicts: Difference[] = [], preserved: Difference[] = [],
    changes: string[] = [], localFields: string[] = [], paths: string[] = [];
  const merge = (a: unknown, b: unknown, c: unknown, path: string, atomic = false): unknown => {
    if (!atomic && object(a) && object(b) && object(c)) {
      if (a.schema === "worldbend.scene3d" && Object.hasOwn(a, "frameCount") && b.schema === a.schema && c.schema === a.schema) {
        // A saved duration is one intention. Mixing local frameCount with an
        // author's new rate would silently change the accepted rhythm.
        const timing = (v: Record<string, unknown>) => ({ frameCount: v.frameCount, timebase: v.timebase });
        const rest = (v: Record<string, unknown>) => Object.fromEntries(Object.entries(v).filter(([key]) => !["frameCount", "timebase"].includes(key)));
        return { ...merge(rest(a), rest(b), rest(c), path) as object,
          ...merge(timing(a), timing(b), timing(c), path + "/timing", true) as object };
      }
      return Object.fromEntries(
        [...new Set([...Object.keys(a), ...Object.keys(b), ...Object.keys(c)])]
          .map((key) => [key, merge(a[key], b[key], c[key], path + "/" + pointer(key))])
          .filter(([, value]) => value !== undefined),
      );
    }
    paths.push(path);
    if (!equal(a, c)) changes.push(path);
    const owned = ownedFields.includes(path) || !equal(a, b);
    if (!owned) return structuredClone(c);
    const difference = { path, local: b, source: c };
    const conflict = !equal(a, c) && !equal(b, c);
    if (conflict) conflicts.push(difference);
    if (conflict && choices[path] === "source") return structuredClone(c);
    preserved.push(difference);
    localFields.push(path);
    return structuredClone(b);
  };
  const collection = <T extends { id: string }>(
    a: [T, ...T[]], b: [T, ...T[]], c: [T, ...T[]], name: string,
  ): [T, ...T[]] => {
    const ids = (items: T[]) => items.map((item) => item.id).sort().join("\0");
    // This example imports revisions of its existing work. Structural authoring
    // remains available through Spatial Documents, outside this receiving UI.
    if (ids(a) !== ids(b) || ids(a) !== ids(c))
      throw Error("这个文件属于不同的作品结构，请打开它对应的完整作品包。");
    return b.map((item) => merge(
      a.find((x) => x.id === item.id), item,
      c.find((x) => x.id === item.id), "/" + name + "/" + pointer(item.id),
    ) as T) as [T, ...T[]];
  };
  const document: SpatialDocumentSpec = {
    ...structuredClone(local),
    assets: collection(base.assets, local.assets, source.assets, "assets"),
    expressions: collection(base.expressions, local.expressions, source.expressions, "expressions"),
  };
  return { document, conflicts, preserved, changes, localFields, paths };
}

export function fieldName(path: string) {
  if (path === "/assets/paper-stage/contentVersion") return "Blender 场景";
  if (path === "/assets/field-notes/contentVersion") return "共享封面";
  if (path.endsWith("/camera")) return "观看视角";
  if (path.endsWith("/timing")) return "镜头节奏";
  if (path.endsWith("/backgroundRgb")) return "背景颜色";
  if (path.endsWith("/exposure")) return "曝光";
  if (path.endsWith("/ambientIntensity")) return "环境光";
  if (path.includes("/canvas/")) return "画面尺寸";
  if (path.endsWith("/animation")) return "动画";
  return "作品设置";
}
