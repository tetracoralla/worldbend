import { readResultBinding } from "./stored-binding";
import { readStoredOperation } from "./stored-operation";
import type { SourcePayload } from "./messages";

const MAX_VISIBLE_RESULTS = 32;

type LinkedSource = { id: string; type?: string; parent?: LinkedSource | null };
type LinkedCandidate = Pick<SceneNode, "id" | "name" | "absoluteBoundingBox" | "getSharedPluginData"> & LinkedSource;

/** Native containment carries changed pixels; only saved bindings create result edges. */
function contentIds(node: LinkedSource): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  let current: LinkedSource | null | undefined = node;
  while (current && current.type !== "PAGE" && current.type !== "DOCUMENT" && !seen.has(current.id)) {
    ids.push(current.id); seen.add(current.id); current = current.parent;
  }
  return ids;
}

/** Recompute local results before results that sample them, including native containers. */
export function linkedResultGraph<T extends LinkedCandidate>(candidates: readonly T[], source: LinkedSource | string) {
  const graph = boundResultGraph(candidates, source);
  return { ...graph, entries: graph.entries.map(entry => {
    const stored = readStoredOperation(entry.node);
    return { ...entry, operation: stored.status === "valid" ? stored.operation : undefined };
  }) };
}

/** Binding edges remain dependencies even if their operation needs repair. */
export function boundResultGraph<T extends LinkedCandidate>(candidates: readonly T[], source: LinkedSource | string) {
  const valid = candidates.flatMap(node => {
    const binding = readResultBinding(node);
    return binding ? [{ node, binding }] : [];
  });
  const consumers = new Map<string, typeof valid>();
  for (const entry of valid) for (const id of entry.binding.sourceNodeIds) {
    const list = consumers.get(id) ?? []; list.push(entry); consumers.set(id, list);
  }
  const changed = contentIds(typeof source === "string" ? { id: source } : source);
  const visited = new Set<string>();
  const affected = new Set<string>();
  for (let index = 0; index < changed.length; index += 1) {
    const id = changed[index]!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const entry of consumers.get(id) ?? []) {
      if (affected.has(entry.node.id)) continue;
      affected.add(entry.node.id); changed.push(...contentIds(entry.node));
    }
  }
  const entries = valid.filter(entry => affected.has(entry.node.id)).map(entry => ({ ...entry, dependencyNodeIds: [] as string[] }));
  const byId = new Map(entries.map(entry => [entry.node.id, entry]));
  for (const upstream of entries) for (const id of contentIds(upstream.node)) {
    for (const downstream of consumers.get(id) ?? []) {
      const entry = byId.get(downstream.node.id);
      if (entry && !entry.dependencyNodeIds.includes(upstream.node.id)) entry.dependencyNodeIds.push(upstream.node.id);
    }
  }
  const ordered: typeof entries = [];
  const remaining = new Set(entries);
  const completed = new Set<string>();
  while (remaining.size) {
    const ready = entries.find(entry => remaining.has(entry) && entry.dependencyNodeIds.every(id => completed.has(id)));
    if (!ready) break;
    remaining.delete(ready); ordered.push(ready); completed.add(ready.node.id);
  }
  return { entries: [...ordered, ...remaining], hasCycle: remaining.size > 0 };
}

/** Find saved results, never the temporary preview or an unbound copy. */
export function linkedResultsForSource(candidates: readonly LinkedCandidate[], source: LinkedSource | string) {
  const items: NonNullable<SourcePayload["linkedResults"]>["items"] = [];
  let total = 0;
  for (const { node, binding, operation } of linkedResultGraph(candidates, source).entries) {
    total += 1;
    if (items.length < MAX_VISIBLE_RESULTS) {
      const box = node.absoluteBoundingBox;
      items.push({ nodeId: node.id, name: Array.from(node.name).slice(0, 128).join(""),
        revision: binding.revision,
        kind: operation?.kind === "task" ? operation.task.kind : operation?.kind ?? "invalid",
        ...(box ? { position: { x: Math.round(box.x), y: Math.round(box.y) } } : {}),
      });
    }
  }
  return { total, items };
}
