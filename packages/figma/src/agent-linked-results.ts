import { rasterPaintsIntact, SHARED_RASTER_PAINT_KEY } from "./raster-paint-guard";
import { figmaError } from "./state-fingerprint";
import { sameJsonValue } from "./json-value";
import { captureDocumentShapeForSource } from "./native-shape-document";
import { normalizedDocumentShape } from "./native-shape";
import { isStoredDesignerTask, type FigmaDeformationTask } from "./stored-designer-task";
import type { MockupClip } from "@worldbend/web/types";
import { boundResultGraph } from "./linked-results";
import { nodePage } from "./native-document";
import { readResultBinding } from "./stored-binding";
import { writeSceneReadProof } from "./native-scene-read-proof";
import { readStoredOperation, readStoredOperationSlots, operationDraftKey } from "./stored-operation";
import { boundedStateFingerprint, mockupSlots, mockupSources, captureMockupSources, exportCapturedSources, effectSourceGraph, publishResultImage, assertRasterSize } from "./agent-handoff";
import { prepareRasterSourceProof, RASTER_SOURCE_PROOF_ENABLED } from "./native-raster-source-proof";
import { parseStoredEffectDraft, parseStoredMockupDraft } from "./stored-designer-task";
import { workSourcesMatch, dynamicCanvas } from "./agent-work-operation";
import type { StoredOperation } from "./stored-operation";

export interface LinkedUpdateItem {
  nodeId: string;
  name: string;
  kind: string;
  revision: number;
  expected: string;
  sourceNodeIds: string[];
  dependencyNodeIds: string[];
  updatable: boolean;
}

export interface LinkedUpdatePlan {
  schema: "worldbend.figma.linked-update";
  version: "0.1";
  fileKey: string;
  pageId: string;
  sourceNodeId: string;
  items: LinkedUpdateItem[];
}

export interface LinkedUpdateCompletion { nodeId: string; revision: number; expected: string }

function validatePendingDraft(node: SceneNode, operation: StoredOperation, revision: number, sourceCount: number) {
  const key = operationDraftKey(operation);
  const raw = key && node.getSharedPluginData("worldbend", key);
  if (!raw) return;
  const draft = key === "effectDraft" ? parseStoredEffectDraft(raw) : parseStoredMockupDraft(raw);
  if (!draft || draft.baseRevision !== revision || (draft.task.kind === "effect"
    ? draft.task.recipe.layers.length !== sourceCount : !mockupSlots(draft.task, sourceCount))) {
    throw figmaError("STATE", "reopen/repair stale/invalid draft");
  }
}

export function linkedOperationUpdatable(node: SceneNode, operation: StoredOperation, sourceCount: number) {
  return node.type === "RECTANGLE" && rasterPaintsIntact(node) &&
    workSourcesMatch(operation,sourceCount);
}

/** Capture target state independently of pixels that upstream publication will
 * deliberately change. Native edits and every operation slot remain guarded. */
export function linkedTargetExpected(node: SceneNode): string {
  const value = node as unknown as Record<string, unknown>;
  const facts: Record<string, unknown> = {
    id: node.id, type: node.type, parentId: node.parent?.id, removed: node.removed,
    binding: node.getSharedPluginData("worldbend", "binding"), operation: readStoredOperationSlots(node),
    mockupDraft: node.getSharedPluginData("worldbend", "mockupDraft"),
    effectDraft: node.getSharedPluginData("worldbend", "effectDraft"),
    canvasOutputId: node.getSharedPluginData("worldbend", "canvasOutputId"),
    rasterPaint: node.getSharedPluginData("worldbend", SHARED_RASTER_PAINT_KEY),
  };
  for (const key of "name,x,y,width,height,relativeTransform,visible,opacity,blendMode,fills,strokes,strokeWeight,strokeTopWeight,strokeRightWeight,strokeBottomWeight,strokeLeftWeight,strokeAlign,strokeCap,strokeJoin,dashPattern,effects,cornerRadius,cornerSmoothing,topLeftRadius,topRightRadius,bottomLeftRadius,bottomRightRadius".split(",")) {
    if (key in value) facts[key] = value[key];
  }
  return boundedStateFingerprint(JSON.stringify(facts));
}

function scope(fileKey: string, pageId: string) {
  if (figma.fileKey !== fileKey || figma.currentPage.id !== pageId || figma.currentPage.removed) {
    throw figmaError("SCOPE", "inspect the granted live page");
  }
}

/** Resolve shallow connector references explicitly; partial discovery cannot
 * establish a safe update order. This read never changes selection or artwork. */
async function pageNodes(fileKey: string, pageId: string) {
  scope(fileKey, pageId);
  const stack = [...figma.currentPage.children].reverse().map(node => ({ id: node.id, depth: 0 }));
  const nodes: SceneNode[] = [];
  const seen = new Set<string>();
  const stamps: Array<{ node: BaseNode & ChildrenMixin; ids: string[] }> = [
    { node: figma.currentPage, ids: figma.currentPage.children.map(node => node.id) },
  ];
  while (stack.length) {
    const item = stack.pop()!;
    if (seen.has(item.id)) continue;
    if (seen.size >= 20000 || item.depth > 64) throw figmaError("LIMIT", "linked scan exceeds 20000 nodes / 64 levels");
    seen.add(item.id);
    const node = await figma.getNodeByIdAsync(item.id);
    scope(fileKey, pageId);
    if (!node || node.removed || nodePage(node)?.id !== pageId || node.type === "PAGE" || node.type === "DOCUMENT") {
      throw figmaError("CONFLICT", "page changed; rediscover");
    }
    nodes.push(node as SceneNode);
    if ("children" in node) {
      const ids = node.children.map(child => child.id);
      stamps.push({ node: node as BaseNode & ChildrenMixin, ids });
      if (stack.length + seen.size + ids.length > 20000) throw figmaError("LIMIT", "linked scan exceeds 20000 nodes");
      // Reverse stack insertion retains native document order.
      stack.push(...[...ids].reverse().map(id => ({ id, depth: item.depth + 1 })));
    }
  }
  if (stamps.some(({ node, ids }) => node.removed || JSON.stringify(node.children.map(child => child.id)) !== JSON.stringify(ids))) {
    throw figmaError("CONFLICT", "page graph changed; rediscover");
  }
  return nodes;
}

export async function inspectLinkedResults(input: { fileKey: string; pageId: string; sourceNodeId: string }): Promise<LinkedUpdatePlan> {
  scope(input.fileKey, input.pageId);
  const source = await figma.getNodeByIdAsync(input.sourceNodeId);
  scope(input.fileKey, input.pageId);
  if (!source || source.removed || nodePage(source)?.id !== input.pageId || !("exportAsync" in source)) {
    throw figmaError("STATE", "source unavailable on page");
  }
  const nodes = await pageNodes(input.fileKey, input.pageId);
  const graph = boundResultGraph(nodes, source);
  if (graph.hasCycle) throw figmaError("CYCLE", "cyclic linked results");
  if (graph.entries.length > 64) throw figmaError("LIMIT", "at most 64 linked results");
  const items = graph.entries.map(({ node, binding, dependencyNodeIds }): LinkedUpdateItem => {
    const stored = readStoredOperation(node);
    const operation = stored.status === "valid" ? stored.operation : undefined;
    const kind = operation?.kind === "task" ? operation.task.kind : operation?.kind ?? "invalid";
    const updatable = !!operation && linkedOperationUpdatable(node, operation, binding.sourceNodeIds.length);
    return { nodeId: node.id, name: Array.from(node.name).slice(0, 128).join(""), kind,
      revision: binding.revision, expected: linkedTargetExpected(node),
      sourceNodeIds: [...binding.sourceNodeIds], dependencyNodeIds, updatable };
  });
  scope(input.fileKey, input.pageId);
  if (source.removed || nodePage(source)?.id !== input.pageId ||
    graph.entries.some(({ node }, index) => !readResultBinding(node) || linkedTargetExpected(node) !== items[index]!.expected)) {
    throw figmaError("CONFLICT", "results changed; rediscover");
  }
  return { schema: "worldbend.figma.linked-update", version: "0.1", ...input, items };
}

export function sourceFacts(sources: Awaited<ReturnType<typeof mockupSources>>) {
  return sources.map(({previewFingerprint: _bytes,...facts})=>facts);
}
function linkedExpected(targetExpected:string, sources:Awaited<ReturnType<typeof mockupSources>>, shapeGuideClip?:MockupClip, sourceState?:string) {
  return boundedStateFingerprint(JSON.stringify({targetExpected,sources:sourceState?sourceFacts(sources):sources,
    ...(sourceState?{sourceState}:{}),...(shapeGuideClip?{shapeGuideClip}:{})}));
}

export async function readLinkedResult(fileKey: string, pageId: string, nodeId: string,
  options?:{captured?:(captures:Awaited<ReturnType<typeof captureMockupSources>>)=>void;legacyPixelProof?:boolean}) {
  scope(fileKey, pageId);
  const result = await figma.getNodeByIdAsync(nodeId);
  scope(fileKey, pageId);
  const stored = result && "getSharedPluginData" in result ? readStoredOperation(result) : undefined;
  const binding = result && readResultBinding(result);
  if (!result || result.removed || result.type !== "RECTANGLE" || nodePage(result)?.id !== pageId ||
    stored?.status !== "valid" || !binding || !linkedOperationUpdatable(result, stored.operation, binding.sourceNodeIds.length)) {
    throw figmaError("STATE", "reopen/repair result");
  }
  const targetExpected = linkedTargetExpected(result);
  validatePendingDraft(result, stored.operation, binding.revision, binding.sourceNodeIds.length);
  const validateGraph = await effectSourceGraph(binding.sourceNodeIds, fileKey, pageId, nodeId, 1);
  const sourceProof = options?.legacyPixelProof || !RASTER_SOURCE_PROOF_ENABLED ? undefined : await prepareRasterSourceProof(binding.sourceNodeIds,validateGraph);
  const raster = { width: binding.renderWidth, height: binding.renderHeight };
  const captures = await captureMockupSources(binding.sourceNodeIds, pageId, dynamicCanvas(stored.operation) ? "native" : raster);
  const sources = captures.map(capture=>capture.source);
  const validate = () => {
    scope(fileKey, pageId); validateGraph();sourceProof?.validate();
    if (result.removed || linkedTargetExpected(result) !== targetExpected) throw figmaError("CONFLICT", "result changed");
  };
  validate();

  const task=stored.operation.kind === "task" && stored.operation.task.kind === "deformation" ? stored.operation.task : undefined;
  let shapeGuideClip:MockupClip|undefined;
  if(task?.shapeGuideSourceIndex !== undefined) {
    const guide=await figma.getNodeByIdAsync(binding.sourceNodeIds[task.shapeGuideSourceIndex]!);
    const shape=guide?.type === "VECTOR" ? await captureDocumentShapeForSource(guide as VectorNode) : undefined;
    if(!shape) throw figmaError("STATE", "guide unavailable; choose closed shape");
    shapeGuideClip=normalizedDocumentShape(shape);
    validate();
  }
  const sourceState=sourceProof?.fingerprint;
  const expected = linkedExpected(targetExpected,sources,shapeGuideClip,sourceState);
  options?.captured?.(captures);
  validate();
  return { schema: "worldbend.figma.linked-result" as const, version: "0.1" as const, fileKey, pageId, nodeId,
    revision: binding.revision, operation: stored.operation, operationJson: JSON.stringify(stored.operation),
    sourceNodeIds: [...binding.sourceNodeIds], sources,
    renderWidth: raster.width, renderHeight: raster.height,
    placement: { x: result.x, y: result.y, width: result.width, height: result.height },
    targetExpected, expected, ...(sourceState?{sourceState}:{}), ...(shapeGuideClip ? {shapeGuideClip} : {}) };
}

async function verifyPlan(plan: LinkedUpdatePlan, nodeId: string, completed: LinkedUpdateCompletion[]) {
  if (plan.schema !== "worldbend.figma.linked-update" || plan.version !== "0.1" || plan.items.length > 64 ||
    new Set(plan.items.map(item => item.nodeId)).size !== plan.items.length ||
    new Set(completed.map(item => item.nodeId)).size !== completed.length) throw figmaError("INPUT", "invalid update plan");
  const fresh = await inspectLinkedResults(plan);
  const structure = (items: LinkedUpdateItem[]) => JSON.stringify(items.map(({ nodeId, sourceNodeIds, dependencyNodeIds, kind, updatable }) =>
    ({ nodeId, sourceNodeIds, dependencyNodeIds, kind, updatable })));
  if (structure(plan.items) !== structure(fresh.items)) throw figmaError("CONFLICT", "links changed; rediscover");
  const item = plan.items.find(item => item.nodeId === nodeId);
  const current = fresh.items.find(item => item.nodeId === nodeId);
  if (!item || !current || !item.updatable) throw figmaError("STATE", "result cannot join update");
  if (item.revision !== current.revision || item.expected !== current.expected) throw figmaError("CONFLICT", "result has a newer edit");
  const required = [...item.dependencyNodeIds]; const visited = new Set<string>();
  while (required.length) {
    const id = required.pop()!; if (visited.has(id)) continue; visited.add(id);
    const prior = plan.items.find(item => item.nodeId === id);
    const done = completed.find(item => item.nodeId === id);
    if (!prior || !prior.updatable || !done || done.revision !== prior.revision + 1) {
      throw figmaError("PREREQUISITE", "finish upstream update");
    }
    const actual = await readLinkedResult(plan.fileKey, plan.pageId, id);
    if (actual.revision !== done.revision || actual.expected !== done.expected) {
      throw figmaError("CONFLICT", "prerequisite changed; rediscover");
    }
    required.push(...prior.dependencyNodeIds);
  }
  return item;
}

export async function inspectLinkedResult(input: { plan: LinkedUpdatePlan; nodeId: string;
  completed: LinkedUpdateCompletion[]; includeSourceRasters?: boolean; sourceRasterTransport?: "inline" | "artifact" }) {
  const item = await verifyPlan(input.plan, input.nodeId, input.completed);
  let sourceRasters:ReturnType<typeof exportCapturedSources>|undefined;
  const snapshot = await readLinkedResult(input.plan.fileKey, input.plan.pageId, input.nodeId,
    input.includeSourceRasters?{captured:captures=>{sourceRasters=exportCapturedSources(input.nodeId,captures,input.sourceRasterTransport??"inline");}}:undefined);
  if (snapshot.targetExpected !== item.expected) throw figmaError("CONFLICT", "result changed; reread");
  return {...snapshot,...(sourceRasters?{sourceRasters}:{})};
}

export async function publishLinkedImage(input: { plan: LinkedUpdatePlan; completed: LinkedUpdateCompletion[];
  fileKey: string; pageId: string; nodeId: string; revision: number; expected: string;
  operationJson: string; sources: Awaited<ReturnType<typeof mockupSources>>; sourceState?:string;
  shapeGuideClip?:MockupClip; refreshedTask?:FigmaDeformationTask;
  renderWidth: number; renderHeight: number; imageBase64: string },validatePublication?:()=>void) {
  if (input.fileKey !== input.plan.fileKey || input.pageId !== input.plan.pageId) throw figmaError("SCOPE", "publication mismatch");
  await verifyPlan(input.plan, input.nodeId, input.completed);
  const proofOptions={legacyPixelProof:input.sourceState===undefined};
  const snapshot = await readLinkedResult(input.fileKey, input.pageId, input.nodeId,proofOptions);
  const matchesRenderedInputs = (actual: typeof snapshot) => actual.operationJson === input.operationJson &&
    sameJsonValue(actual.shapeGuideClip,input.shapeGuideClip) &&
    actual.sourceState===input.sourceState &&
    sameJsonValue(input.sourceState?sourceFacts(actual.sources):actual.sources,input.sourceState?sourceFacts(input.sources):input.sources);
  if (!matchesRenderedInputs(snapshot)) throw figmaError("CONFLICT", "operation/source PNG mismatch");
  if (dynamicCanvas(snapshot.operation)) assertRasterSize(input.imageBase64,input.renderWidth,input.renderHeight);
  if (!dynamicCanvas(snapshot.operation) && (snapshot.renderWidth !== input.renderWidth || snapshot.renderHeight !== input.renderHeight)) throw figmaError("INPUT", "preserve raster size");
  if(input.refreshedTask) {
    const old=snapshot.operation.kind === "task" && snapshot.operation.task.kind === "deformation" ? snapshot.operation.task : undefined;
    const next=input.refreshedTask;
    const interior=(task:FigmaDeformationTask)=>{const {shapeFit,...work}=task.spec;return {...work,view:task.view,shapeGuideSourceIndex:task.shapeGuideSourceIndex};};
    if(!old || old.shapeGuideSourceIndex === undefined || !isStoredDesignerTask(next) ||
      !sameJsonValue(interior(old),interior(next)) ||
      !sameJsonValue(next.spec.shapeFit?.clip,snapshot.shapeGuideClip)) throw figmaError("INPUT", "preserve interior/clip");
  }
  const draftKey = operationDraftKey(snapshot.operation);
  let accepted = snapshot;
  let validateSources: Awaited<ReturnType<typeof effectSourceGraph>> | undefined;
  let sourceProof:Awaited<ReturnType<typeof prepareRasterSourceProof>>;
  return publishResultImage({ ...input, ...(input.refreshedTask ? {task:input.refreshedTask} : {}), ...(draftKey ? { draftKey } : {}), preserveDraft: true },
    () => readLinkedResult(input.fileKey, input.pageId, input.nodeId,proofOptions),
    (result, fresh) => {
      scope(input.fileKey, input.pageId);
      validateSources?.();
      sourceProof?.validate();
      if (linkedTargetExpected(result) !== fresh.targetExpected) throw figmaError("CONFLICT", "result changed");
    }, async () => {
      await verifyPlan(input.plan, input.nodeId, input.completed);
      validateSources = await effectSourceGraph(snapshot.sourceNodeIds, input.fileKey, input.pageId, input.nodeId, 1);
      sourceProof=input.sourceState && RASTER_SOURCE_PROOF_ENABLED?await prepareRasterSourceProof(snapshot.sourceNodeIds,validateSources):undefined;
      if(input.sourceState && sourceProof?.fingerprint!==input.sourceState) throw figmaError("CONFLICT","source state changed");
      accepted = await readLinkedResult(input.fileKey, input.pageId, input.nodeId,proofOptions);
      if (accepted.expected !== input.expected || !matchesRenderedInputs(accepted)) throw figmaError("CONFLICT", "source pixels changed");
      validateSources();
      sourceProof?.validate();
    }, result => {
      const binding = readResultBinding(result)!;
      const targetExpected = linkedTargetExpected(result);
      // Capture synchronously at the write boundary. Later source edits must
      // invalidate this completion, rather than being mistaken for the pixels
      // this publication rendered by an asynchronous post-write reinspection.
      const operation=input.refreshedTask ? {kind:"task" as const,task:input.refreshedTask} : accepted.operation;
      return { ...accepted, sources:input.sources, operation, operationJson:JSON.stringify(operation),revision: binding.revision, targetExpected,
        renderWidth:binding.renderWidth,renderHeight:binding.renderHeight,
        placement:{x:result.x,y:result.y,width:result.width,height:result.height},
        expected: linkedExpected(targetExpected,input.sources,accepted.shapeGuideClip,input.sourceState) };
    }, result => {
      if (dynamicCanvas(snapshot.operation)) result.resize(snapshot.placement.width * input.renderWidth / snapshot.renderWidth,
        snapshot.placement.height * input.renderHeight / snapshot.renderHeight);
      if (snapshot.operation.kind === "task" && ["mockup", "composition"].includes(snapshot.operation.task.kind)) {
        writeSceneReadProof(result, validateSources!.fingerprint);
      }
    },validatePublication);
}
