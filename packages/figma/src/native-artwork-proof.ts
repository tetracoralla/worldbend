import { nodePage } from "./native-document";
import { nativeNodeSnapshot } from "./native-copy-closure";

/** Native capture uses the artwork currently on canvas. Its physical subtree
 * must stay current, but an old Worldbend binding is not a prerequisite for
 * outlining that artwork again as an independent source. Linked source-graph
 * copying remains the separate prepareNativeCopy contract. */
export function nativeArtworkProof(root: SceneNode) {
  const fileKey = figma.fileKey, pageId = figma.currentPage.id;
  const originals = new Map<string, SceneNode>(), states = new Map<string, string>();
  let bytes = 0;
  function visit(node: SceneNode, depth: number) {
    if (depth > 64 || originals.size >= 20000) throw Error("Native artwork limit: 20000 nodes / 64 levels");
    if (node.removed || nodePage(node)?.id !== pageId) throw Error("Native artwork unavailable");
    const state = nativeNodeSnapshot(node); bytes += state.length * 2;
    if (bytes > 16 * 1024 * 1024) throw Error("Native artwork state exceeds 16 MiB");
    originals.set(node.id, node); states.set(node.id, state);
    if ("children" in node) for (const child of node.children) visit(child, depth + 1);
  }
  visit(root, 0);
  const validate = () => {
    if (figma.fileKey !== fileKey || figma.currentPage.id !== pageId) throw Error("Native artwork scope changed");
    for (const [id, node] of originals) if (node.removed || nodePage(node)?.id !== pageId ||
      nativeNodeSnapshot(node) !== states.get(id)) throw Error("Native artwork changed");
  };
  return { originals, validate };
}
