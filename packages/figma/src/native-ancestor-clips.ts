/** Source exports retain clipping Frames outside the selected subtree. Their
 * windows are capture dependencies, not additional artwork or clone roots. */
export type NativeClipFrame = FrameNode | InstanceNode | ComponentNode | ComponentSetNode;

function ancestors(source: SceneNode): SceneNode[] {
  const result: SceneNode[] = [], seen = new Set<string>([source.id]);
  let node = source.parent;
  while (node && node.type !== "PAGE" && node.type !== "DOCUMENT") {
    if (result.length >= 64 || seen.has(node.id)) throw Error("Native clip ancestry exceeds 64 levels or contains a cycle");
    seen.add(node.id); result.push(node as SceneNode); node = node.parent;
  }
  return result.reverse();
}
function isClipFrame(node: SceneNode): node is NativeClipFrame {
  return ["FRAME", "INSTANCE", "COMPONENT", "COMPONENT_SET"].includes(node.type);
}
/** Outermost first, including clips outside a standalone VECTOR/TEXT source. */
export function nativeAncestorClips(source: SceneNode): NativeClipFrame[] {
  return ancestors(source).filter((node): node is NativeClipFrame => isClipFrame(node) && node.clipsContent);
}
/** Include inactive clipping Frames too: enabling a previously disabled clip
 * must invalidate a captured source. Do not include unrelated siblings, paints,
 * bindings or temporary nodes in this dependency witness. */
export function nativeAncestorClipState(source: SceneNode): unknown[] {
  return ancestors(source).filter(isClipFrame).map(node => ({
    id: node.id, parent: node.parent?.id, type: node.type, removed: node.removed,
    clipsContent: node.clipsContent,
    ...(node.clipsContent ? { transform: node.absoluteTransform, width: node.width, height: node.height,
      radii: [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius],
      cornerSmoothing: node.cornerSmoothing } : {}),
  }));
}
