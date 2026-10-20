interface PendingCreation {
  identity: string;
  pageKey: string;
  reservedNodes: number;
  promise: Promise<SceneNode>;
}
const pendingCreations = new WeakMap<object, Map<string, PendingCreation>>();
/** Recover durable identities and share an in-flight asynchronous publication.
 * Preparing native styles/samplers can yield before the first result exists. */
export function recoverCreation<T extends SceneNode>(page: PageNode, requestId: string, key: string,
  identity: string, accepts: (node: SceneNode) => node is T, create?: () => T | Promise<T>, reserveNodes = 0): T | Promise<T> | undefined {
  let pending=pendingCreations.get(figma);
  if(!pending){pending=new Map();pendingCreations.set(figma,pending);}
  const pageKey = JSON.stringify([figma.fileKey, page.id]);
  const pendingKey=JSON.stringify([pageKey,key,requestId]),active=pending.get(pendingKey);
  if(active){
    if(active.identity!==identity)throw Error("E_FIGMA_CONFLICT: creation identity belongs to different inputs");
    return active.promise as Promise<T>;
  }
  if (page.children.length > 20000) throw Error("E_FIGMA_LIMIT: creation recovery exceeds 20000 nodes");
  const stack = page.children.map(node => ({ node, depth: 0 }));
  const seen = new Set<string>();
  let found: T | undefined;
  while (stack.length) {
    if (stack.length + seen.size > 20000) throw Error("E_FIGMA_LIMIT: creation recovery exceeds 20000 nodes");
    const { node, depth } = stack.pop()!;
    if (seen.has(node.id) || depth > 64) throw Error("E_FIGMA_LIMIT: creation recovery exceeds its bounded page tree");
    seen.add(node.id);
    if (node.removed) continue;
    if (accepts(node)) {
      const raw = node.getSharedPluginData("worldbend", key);
      let saved: { nodeId?: string; requestId?: string; identity?: string } | undefined;
      try { saved = raw ? JSON.parse(raw) : undefined; } catch { /* An unrelated damaged marker owns no identity. */ }
      if (saved?.nodeId === node.id && saved.requestId === requestId) {
        if (saved.identity !== identity || found) throw Error("E_FIGMA_CONFLICT: creation identity is ambiguous or belongs to different inputs");
        found = node;
      }
    }
    if ("children" in node) {
      if (seen.size + stack.length + node.children.length > 20000) throw Error("E_FIGMA_LIMIT: creation recovery exceeds 20000 nodes");
      stack.push(...node.children.map(child => ({ node: child, depth: depth + 1 })));
    }
  }
  const reservedNodes = [...pending.values()].reduce((total, creation) =>
    total + (creation.pageKey === pageKey ? creation.reservedNodes : 0), 0);
  if (!found && create && (!Number.isSafeInteger(reserveNodes) || reserveNodes < 0 ||
    seen.size + reservedNodes + reserveNodes > 20000)) {
    throw Error("E_FIGMA_LIMIT: creation would exceed its recoverable page budget");
  }
  if(found||!create)return found;
  const created=create();
  if(!(created instanceof Promise))return created;
  const promise=created.finally(()=>{if(pending.get(pendingKey)?.promise===promise)pending.delete(pendingKey);});
  pending.set(pendingKey,{identity,pageKey,reservedNodes:reserveNodes,promise});return promise;
}
