import { componentNativeTopology } from "./native-component-topology";
import { readCopiedNativeProjection, readNativeProjection, SHARED_NATIVE_KEY } from "./native-projective";
import { nativeVectorFingerprint, readNativeVectorProjection, readCopiedNativeVectorProjection, serializeNativeVectorProjection, SHARED_NATIVE_VECTOR_KEY } from "./native-vector";
import { readResultBinding, writeStoredBinding } from "./stored-binding";
import { NATIVE_SCENE_KEY, NATIVE_SCENE_CREATION_KEY, newNativeSceneId, parseNativeSceneReference } from "./native-scene-model";

function rebaseCopiedDrafts(original: SceneNode, copy: SceneNode): void {
  const prior = readResultBinding(original), current = readResultBinding(copy);
  if (!prior || !current) return;
  for (const key of ["mockupDraft", "effectDraft"]) {
    const raw = original.getSharedPluginData("worldbend", key);
    if (!raw || raw.length > 128 * 1024) continue;
    try {
      const draft = JSON.parse(raw);
      // This is reference rebinding, not authoring or admission of task bytes.
      // Preserve the entire draft; its owning reader still validates the task.
      // A stale/malformed draft must never be made current merely by copying.
      if (draft && typeof draft === "object" && !Array.isArray(draft) &&
        draft.schema === (key === "mockupDraft" ? "worldbend.figma.mockup-draft" : "worldbend.figma.effect-draft") &&
        draft.version === "0.1") {
        if (draft.baseRevision === prior.revision) {
          copy.setSharedPluginData("worldbend", key, JSON.stringify({ ...draft, baseRevision: current.revision }));
        } else if (draft.baseRevision === current.revision) {
          // A new copy starts at revision one. An old revision-one draft
          // cannot accidentally become current on that unrelated instance.
          copy.setSharedPluginData("worldbend", key, JSON.stringify({ ...draft, baseRevision: 0 }));
        }
      }
    } catch { /* Keep a damaged record available to its normal repair route. */ }
  }
}

/** Keep native continuation records and source bindings on the same cloned
 * graph. Figma copies shared data verbatim; rebinding only the binding would
 * otherwise leave a shader's content IDs or a vector's identity pointing back
 * at its original. This changes carrier references, never transform meaning. */
export function rebindClonedNativeGraph(
  copies: ReadonlyMap<string, SceneNode>, originals: ReadonlyMap<string, SceneNode>,
  sourceCopy: (id: string) => SceneNode | undefined = id => copies.get(id),
  requireCopiedSources = false,
): void {
  const sourceId = (id: string) => {
    const copy = sourceCopy(id);
    if (!copy && requireCopiedSources) throw new Error("Scene linked source was not copied.");
    return copy?.id ?? id;
  };
  for (const [id, copy] of copies) {
    const original = originals.get(id);
    if (!original || copy.removed) continue;
    const scene = parseNativeSceneReference(original.getSharedPluginData("worldbend", NATIVE_SCENE_KEY));
    if (scene?.rootNodeId === original.id && [scene.previewNodeId, scene.resultNodeId, ...scene.sourceNodeIds, ...scene.replaceSourceNodeIds].every(id => copies.has(id))) {
      copy.setSharedPluginData("worldbend", NATIVE_SCENE_KEY, JSON.stringify({ ...scene,
        sceneId: newNativeSceneId(), pageId: figma.currentPage.id, rootNodeId: copy.id,
        previewNodeId: copies.get(scene.previewNodeId)!.id, resultNodeId: copies.get(scene.resultNodeId)!.id,
        sourceNodeIds: scene.sourceNodeIds.map(id => copies.get(id)!.id), replaceSourceNodeIds: scene.replaceSourceNodeIds.map(id => copies.get(id)!.id) }));
      copy.setSharedPluginData("worldbend", "sceneTemplate", "");
      copy.setSharedPluginData("worldbend", NATIVE_SCENE_CREATION_KEY, "");
    }
    const native = readNativeProjection(original) ?? readCopiedNativeProjection(original);
    if (native && original.type === "FRAME") {
      const binding = readResultBinding({ id: native.resultNodeId,
        getSharedPluginData: (namespace, key) => original.getSharedPluginData(namespace, key) });
      if(native.version==="0.3") {
        const parts=componentNativeTopology(original);
        if(copy.type!=="FRAME"||binding?.sourceNodeIds.length!==1||binding.sourceNodeIds[0]!==native.contentNodeId)throw Error("Damaged native result. Repair before copying.");
        const next=componentNativeTopology(copy);
        for(const key of ["surface","basis","instance","master","content","masterContent"] as const) {
          if(copies.get(parts[key].id)?.id!==next[key].id)throw Error("Native component copy changed");
        }
        copy.setSharedPluginData("worldbend",SHARED_NATIVE_KEY,JSON.stringify({...native,resultNodeId:copy.id,
          surfaceNodeId:next.surface.id,contentNodeId:next.content.id,frame:{...native.frame,
            masterNodeId:next.master.id,masterContentNodeId:next.masterContent.id,instanceNodeId:next.instance.id,basisNodeId:next.basis.id}}));
        writeStoredBinding(copy,{...binding,sourceNodeIds:[next.content.id]},{newResult:true});
        continue;
      }
      const surface = original.children[0];
      const content = surface?.type === "FRAME" ? surface.children[0] : undefined;
      const copySurface = surface && copies.get(surface.id), copyContent = content && copies.get(content.id);
      if (binding?.sourceNodeIds.length !== 1 || binding.sourceNodeIds[0] !== native.contentNodeId ||
        !copySurface || !copyContent || copySurface.parent?.id !== copy.id || copyContent.parent?.id !== copySurface.id) {
        if (requireCopiedSources) throw new Error("Damaged native result. Repair before copying.");
        continue;
      }
      copy.setSharedPluginData("worldbend", SHARED_NATIVE_KEY, JSON.stringify({ ...native,
        resultNodeId: copy.id, surfaceNodeId: copySurface.id, contentNodeId: copyContent.id }));
      writeStoredBinding(copy, { ...binding, sourceNodeIds: [copyContent.id] }, { newResult: true });
      continue;
    }
    const vector = readNativeVectorProjection(original) ?? readCopiedNativeVectorProjection(original);
    const binding = readResultBinding(vector ? { id: vector.resultNodeId,
      getSharedPluginData: (namespace, key) => original.getSharedPluginData(namespace, key) } : original);
    if (!binding) continue;
    if (vector && original.type === "FRAME" && copy.type === "FRAME") {
      const copied = vector.resultNodeId !== original.id;
      const contents = vector.parts.map((part, index) => copied ? original.children[index] :
        original.children.find((child) => child.id === part.contentNodeId));
      const copyContents = contents.map((content) => content && copies.get(content.id));
      if ((vector.version==="0.3"?JSON.stringify(binding.sourceNodeIds)!==JSON.stringify(vector.sourceNodeIds):
        binding.sourceNodeIds.length !== 1 || binding.sourceNodeIds[0] !== vector.sourceNodeId) ||
        original.children.length !== vector.parts.length ||
        (!copied && vector.parts.some((part, index) => original.children[index]?.id !== part.contentNodeId)) ||
        (copied && contents.some(content => vector.parts.some(part => part.contentNodeId === content?.id))) ||
        contents.some((content) => content?.type !== "VECTOR") ||
        copyContents.some((content) => content?.type !== "VECTOR" || content.parent?.id !== copy.id) ||
        vector.parts.some((part, index) =>
          nativeVectorFingerprint(contents[index] as VectorNode) !== part.fingerprint)) {
        if (requireCopiedSources) throw new Error("Damaged native vector. Repair before copying.");
        continue;
      }
      const copiedSourceId = sourceId(vector.sourceNodeId);
      const copiedSourceIds=binding.sourceNodeIds.map(sourceId);
      const transform = copy.absoluteTransform;
      copy.setSharedPluginData("worldbend", SHARED_NATIVE_VECTOR_KEY, serializeNativeVectorProjection({
        ...vector,
        resultNodeId: copy.id,
        sourceNodeId: copiedSourceId,
        ...(vector.version==="0.3"?{sourceNodeIds:copiedSourceIds}:{}),
        outputSize: { width: copy.width, height: copy.height },
        placement: { x: transform[0][2], y: transform[1][2], width: copy.width, height: copy.height },
        parts: vector.parts.map((part, index) => ({
          contentNodeId: copyContents[index]!.id,
          fingerprint: nativeVectorFingerprint(copyContents[index] as VectorNode),
          ...(part.role?{role:part.role}:{}),
        })),
      }));
      writeStoredBinding(copy, { ...binding, sourceNodeIds: copiedSourceIds }, { newResult: true });
      continue;
    }
    writeStoredBinding(copy, { ...binding, sourceNodeIds: binding.sourceNodeIds.map(sourceId) }, { newResult: true });
    rebaseCopiedDrafts(original, copy);
  }
}

export function clonedNativeGraph(original: SceneNode, copy: SceneNode) {
  const copies = new Map<string, SceneNode>(), originals = new Map<string, SceneNode>();
  function pair(left: SceneNode, right: SceneNode) {
    copies.set(left.id, right); originals.set(left.id, left);
    if ("children" in left && "children" in right) {
      if (left.children.length !== right.children.length) throw new Error("Native scene copy changed");
      left.children.forEach((child, index) => pair(child, right.children[index]!));
    }
  }
  pair(original, copy); return { copies, originals };
}
