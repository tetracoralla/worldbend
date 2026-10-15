import { componentNativeTopology } from "./native-component-topology";
import { nodePage } from "./native-document";
import { readCopiedNativeProjection, readNativeProjection } from "./native-projective";
import { readNativeVectorProjection } from "./native-vector";
import { readResultBinding } from "./stored-binding";
import {ephemeralWorldbendKey,inactiveOperationBankKey,operationBankBytes} from "./operation-storage";
import {nativeAncestorClipState} from "./native-ancestor-clips";

const changed = () => new Error("Scene changed. Select artwork and retry.");
const unavailable = () => new Error("Source unavailable. Repair binding to copy.");

function binding(node: SceneNode) {
  const raw = node.getSharedPluginData("worldbend", "binding");
  if (!raw) return undefined;
  const native = readNativeProjection(node) ?? readCopiedNativeProjection(node);
  if ((node.getSharedPluginData("worldbend", "native") && !native) ||
    (node.getSharedPluginData("worldbend", "nativeVector") && !readNativeVectorProjection(node))) throw unavailable();
  const value = readResultBinding(node) ?? (native && readResultBinding({ id: native.resultNodeId,
    getSharedPluginData: (namespace, key) => node.getSharedPluginData(namespace, key) }));
  if (!value) throw unavailable();
  // A copied shader owns its two wrapper levels even before its first reopen.
  if (native && native.resultNodeId !== node.id && node.type === "FRAME") {
    const surface = node.children[0];
    const content = native.version==="0.3"?componentNativeTopology(node).content:surface?.type === "FRAME" ? surface.children[0] : undefined;
    if (value.sourceNodeIds.length !== 1 || value.sourceNodeIds[0] !== native.contentNodeId ||
      !content || content.id === native.contentNodeId) throw unavailable();
    return { ...value, sourceNodeIds: [content.id] };
  }
  return value;
}

export function nativeNodeSnapshot(node: SceneNode): string {
  // World bounds/transform also change when an unbound ancestor moves. They
  // belong to every source proof, including a native fitting guide.
  const facts: Record<string, unknown> = { id: node.id, parent: node.parent?.id, removed: node.removed,
    absoluteTransform:node.absoluteTransform,absoluteBoundingBox:node.absoluteBoundingBox };
  const value = node as unknown as Record<string, unknown>;
  const ancestorClips=nativeAncestorClipState(node);
  if(ancestorClips.length)facts.ancestorClips=ancestorClips;
  for (const key of "type,name,width,height,x,y,relativeTransform,resolvedVariableModes,explicitVariableModes,boundVariables,visible,opacity,blendMode,fills,strokes,strokeWeight,strokeTopWeight,strokeRightWeight,strokeBottomWeight,strokeLeftWeight,strokeAlign,strokeCap,strokeJoin,dashPattern,effects,clipsContent,cornerRadius,cornerSmoothing,topLeftRadius,topRightRadius,bottomLeftRadius,bottomRightRadius,characters,fontName,fontSize,textAlignHorizontal,textAlignVertical,textAutoResize,textStyleId,letterSpacing,lineHeight,arcData,vectorNetwork,vectorPaths,layoutMode,layoutSizingHorizontal,layoutSizingVertical,layoutGrow,layoutAlign,primaryAxisSizingMode,counterAxisSizingMode,primaryAxisAlignItems,counterAxisAlignItems,itemSpacing,paddingLeft,paddingRight,paddingTop,paddingBottom,constraints,isMask,maskType,booleanOperation".split(",")) {
    if (key in value) facts[key] = value[key];
  }
  // Motion is optional on older hosts. Include admitted authored tracks in
  // native freshness/copy proofs without requiring the beta for static work.
  if (typeof node.applyManualKeyframeTrack === "function") {
    try { facts.motion={tracks:node.manualKeyframeTracks,styles:node.animationStyles,timelines:node.timelines}; }
    catch(error) { if(!String(error).includes("not a supported API"))throw error; }
  }
  if ("children" in node) facts.children = node.children.map(child => child.id);
  for (const key of ["absoluteRenderBounds", "pointCount", "innerRadius", "strokeMiterLimit", "variableWidthStrokeProperties", "complexStrokeProperties",
    "fillStyleId", "strokeStyleId",
    "paragraphSpacing", "paragraphIndent", "listSpacing", "textTruncation", "maxLines", "leadingTrim", "hangingPunctuation", "hangingList"]) {
    if (key in value) facts[key] = value[key];
  }
  if (node.type === "TEXT") facts.text = node.getStyledTextSegments([
    "fontName", "fontSize", "fills", "letterSpacing", "lineHeight", "textDecoration", "textCase", "textStyleId", "fillStyleId"]);
  const keys = typeof node.getSharedPluginDataKeys === "function" ? node.getSharedPluginDataKeys("worldbend") :
    ["binding", "transform", "rectification", "canvas", "task", "native", "nativeVector", "nativeScene", "sceneTemplate", "sceneCreation", "mockupDraft", "effectDraft"];
  // Enumeration is optional on supported older hosts. The owning manifests,
  // not namespace enumeration, identify every active byte of saved controls.
  const activeKeys=["transform","rectification","canvas","task"].flatMap(slot=>
    Object.keys(operationBankBytes(node,node.getSharedPluginData("worldbend",slot))??{}));
  facts.shared = [...new Set([...keys,...activeKeys])].filter(key=>!ephemeralWorldbendKey(key)&&!inactiveOperationBankKey(node,key))
    .sort().map(key => [key, node.getSharedPluginData("worldbend", key)]);
  return JSON.stringify(facts);
}

/** Resolve the complete native/linked source graph before any clone is made.
 * Replacement slots retain their native bounds, but their discarded content
 * and old source dependencies do not belong to the replacement instance. */
export async function prepareNativeCopy(roots: readonly SceneNode[], replacedSlots: ReadonlySet<string> = new Set()) {
  const pageId = figma.currentPage.id;
  const fileKey = figma.fileKey;
  const originals = new Map<string, SceneNode>();
  const states = new Map<string, string>();
  const edges = new Map<string, string[]>();
  let stateBytes = 0;
  const scope = () => { if (figma.currentPage.id !== pageId || figma.fileKey !== fileKey) throw changed(); };
  async function visit(id: string, depth: number, active: Set<string>): Promise<void> {
    if (active.has(id)) throw new Error("Scene source cycle. Repair before copying.");
    if (originals.has(id)) return;
    if (depth > 64 || originals.size >= 20000) throw new Error("Scene limit: 20000 nodes / 64 levels.");
    scope();
    const node = await figma.getNodeByIdAsync(id);
    scope();
    if (!node || node.removed || !("visible" in node) || nodePage(node)?.id !== pageId) throw unavailable();
    const source = node as SceneNode;
    const snapshot = nativeNodeSnapshot(source);
    stateBytes += snapshot.length * 2;
    if (stateBytes > 16 * 1024 * 1024) throw new Error("Scene state exceeds 16 MiB.");
    originals.set(id, source); states.set(id, snapshot);
    const dependencies = replacedSlots.has(id) ? [] : [...new Set([
      ...("children" in source ? source.children.map(child => child.id) : []), ...(binding(source)?.sourceNodeIds ?? [])])];
    edges.set(id, dependencies);
    active.add(id);
    for (const dependency of dependencies) await visit(dependency, depth + 1, active);
    active.delete(id);
  }
  for (const root of roots) await visit(root.id, 0, new Set());
  // A node first reached through a shallow branch can still form a cycle with
  // a later branch. Check the complete admitted graph, independently of reads.
  const active = new Set<string>(), lengths = new Map<string, number>();
  function check(id: string): number {
    if (active.has(id)) throw new Error("Scene source cycle. Repair before copying.");
    const prior = lengths.get(id); if (prior !== undefined) return prior;
    if (active.size > 64) throw new Error("Scene copy exceeds 64 levels.");
    active.add(id);
    const length = Math.max(0, ...(edges.get(id) ?? []).map(next => check(next) + 1));
    active.delete(id);
    if (length > 64) throw new Error("Scene copy exceeds 64 levels.");
    lengths.set(id, length); return length;
  }
  for (const root of roots) check(root.id);
  // Native clone() also copies discarded slot content. Admit its physical
  // cost without following obsolete bindings that replacement will remove.
  const copyNodes = new Map(originals);
  async function physical(id: string, depth: number): Promise<void> {
    if (depth > 64) throw new Error("Scene copy exceeds 64 levels.");
    let node = copyNodes.get(id);
    if (!node) {
      if (copyNodes.size >= 20000) throw new Error("Scene copy limit: 20000 nodes.");
      scope(); const resolved = await figma.getNodeByIdAsync(id); scope();
      if (!resolved || resolved.removed || !("visible" in resolved) || nodePage(resolved)?.id !== pageId) throw changed();
      node = resolved as SceneNode;
      const snapshot = nativeNodeSnapshot(node); stateBytes += snapshot.length * 2;
      if (stateBytes > 16 * 1024 * 1024) throw new Error("Scene state exceeds 16 MiB.");
      copyNodes.set(id, node); states.set(id, snapshot);
    }
    if ("children" in node) for (const child of node.children) await physical(child.id, depth + 1);
  }
  const cloneRoots = [...originals.values()].filter(node => !node.parent || !originals.has(node.parent.id));
  for (const root of cloneRoots) await physical(root.id, 0);
  const validate = () => {
    scope();
    for (const [id, node] of copyNodes) if (node.removed || nodePage(node)?.id !== pageId || nativeNodeSnapshot(node) !== states.get(id)) throw changed();
  };
  validate();
  return { originals, stateBytes, nodeCount: copyNodes.size, roots: cloneRoots, validate };
}

export function checkCopyBudget(plans: readonly Awaited<ReturnType<typeof prepareNativeCopy>>[]) {
  if (plans.reduce((sum, plan) => sum + plan.nodeCount, 0) > 20000 ||
    plans.reduce((sum, plan) => sum + plan.stateBytes, 0) > 16 * 1024 * 1024) {
    throw new Error("Scene/replacements exceed 20000 nodes / 16 MiB.");
  }
}

export function sceneDependencyArea(root: FrameNode): FrameNode {
  const area = figma.createFrame(); area.name = "Linked sources · edit these originals";
  area.fills = []; area.clipsContent = false; area.layoutMode = "VERTICAL";
  area.primaryAxisSizingMode = "AUTO"; area.counterAxisSizingMode = "AUTO"; area.itemSpacing = 48;
  area.setSharedPluginData("worldbend", "sceneDependencies", "1");
  root.appendChild(area); return area;
}

/** Remove only plugin-owned source copies that the finished instance no longer
 * consumes. Native decoration and unmarked user Frames stay untouched. */
export function pruneSceneDependencies(root: FrameNode): void {
  const nodes = new Map<string, SceneNode>();
  function collect(node: SceneNode) {
    nodes.set(node.id, node); if ("children" in node) node.children.forEach(collect);
  }
  collect(root);
  const areas = [...nodes.values()].filter((node): node is FrameNode => node.type === "FRAME" &&
    node.getSharedPluginData("worldbend", "sceneDependencies") === "1");
  const areaIds = new Set(areas.map(node => node.id)), reached = new Set<string>();
  function visit(id: string, asSource = false) {
    const node = nodes.get(id);
    if (!node || reached.has(id)) return;
    // Source areas themselves are layout, not part of the scene's visible
    // input. If explicitly bound as artwork, they are ordinary native input.
    if (areaIds.has(id) && !asSource) return;
    reached.add(id);
    if ("children" in node) node.children.forEach(child => visit(child.id));
    for (const source of readResultBinding(node)?.sourceNodeIds ?? []) visit(source, true);
  }
  visit(root.id);
  const containsReached = (node: SceneNode): boolean => reached.has(node.id) ||
    ("children" in node && node.children.some(containsReached));
  for (const area of areas) if (!area.removed && !reached.has(area.id)) {
    for (const child of [...area.children]) if (!containsReached(child)) child.remove();
    if (!area.children.length) area.remove();
  }
}
