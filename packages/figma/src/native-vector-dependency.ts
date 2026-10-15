/** Vector publication retires its old physical children. Neither direction of
 * source/result containment can form a durable independently linked source.
 * Native Frame Content has a different, intentionally contained lifecycle. */
export function assertIndependentVectorSource(source: SceneNode, resultId: string): void {
  if (!resultId) return;
  const seen = new Set<string>();
  let node: BaseNode | null = source;
  while (node && node.type !== "PAGE" && node.type !== "DOCUMENT") {
    if (node.id === resultId) throw Error("E_FIGMA_INPUT: Vector source cannot depend on its result");
    if (seen.has(node.id) || seen.size >= 64) throw Error("E_FIGMA_INPUT: Vector source ancestry unavailable");
    seen.add(node.id); node = node.parent;
  }
  // The containing-source direction is checked by the complete physical
  // artwork proof at every caller; walking parents also covers direct callers.
  const result = findContained(source, resultId, 0, new Set<string>());
  if (result) throw Error("E_FIGMA_INPUT: Vector source cannot depend on its result");
}

function findContained(node: SceneNode, id: string, depth: number, seen: Set<string>): boolean {
  if (depth > 64 || seen.size >= 20000 || seen.has(node.id)) throw Error("E_FIGMA_INPUT: Vector source subtree unavailable");
  seen.add(node.id);
  return node.id === id || ("children" in node && node.children.some(child => findContained(child, id, depth + 1, seen)));
}
