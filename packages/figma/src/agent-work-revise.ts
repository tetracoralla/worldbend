import { statePage, workState, workScope, operationDraftKey, type WorkReference, type WorkPage } from "./agent-work-state";
import { workOperationSupports, dynamicCanvas,deformationOperation } from "./agent-work-operation";
import {isRasterCanvasFrames,transportRasterCanvas,type RasterCanvasFrames} from "./raster-canvas-change";
import { boundedStateFingerprint, captureMockupSources, effectSourceGraph, exportCapturedSources, publishResultImage, assertRasterSize } from "./agent-handoff";
import { linkedTargetExpected, sourceFacts } from "./agent-linked-results";
import { prepareRasterSourceProof } from "./native-raster-source-proof";
import { readResultBinding } from "./stored-binding";
import { writeStoredOperation, type StoredOperation } from "./stored-operation";
import { sameJsonValue } from "./json-value";
import { figmaError } from "./state-fingerprint";
import { captureDocumentShapeForSource } from "./native-shape-document";
import { normalizedDocumentShape } from "./native-shape";
import { writeSceneReadProof } from "./native-scene-read-proof";

export interface WorkRevisionInput extends WorkReference {
  operation?: StoredOperation;
  sourceNodeIds?: string[];
  renderWidth?: number;
  renderHeight?: number;
}

// A typed core consumer may serialize equivalent object keys in another order.
// Hash all JSON values canonically while retaining significant source order.
function proposalFingerprint(value: unknown) {
  return boundedStateFingerprint(JSON.stringify(value,(_key,item:unknown)=>item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)) : item));
}

async function proposal(input: WorkRevisionInput, legacyPixelProof = false) {
  const base = await workState(input);
  if (!base.imageIntact) throw figmaError("STATE", "preserve the hand-edited image; restore its fill before updating");
  const operation = input.operation ?? base.operation, sourceNodeIds = input.sourceNodeIds ?? base.sourceNodeIds;
  const renderWidth = input.renderWidth ?? base.renderWidth, renderHeight = input.renderHeight ?? base.renderHeight;
  if (!Array.isArray(sourceNodeIds) || new Set(sourceNodeIds).size !== sourceNodeIds.length ||
    !sourceNodeIds.every(id => typeof id === "string" && id.length > 0 && id.length <= 256 && id !== input.nodeId) ||
    !workOperationSupports(operation, sourceNodeIds.length, renderWidth, renderHeight)) throw figmaError("INPUT", "use valid controls and matching distinct source slots");
  const preserveDraft = sameJsonValue(operation, base.operation);
  if (base.pendingDraft && (!workOperationSupports({kind:"task",task:base.pendingDraft.task}, sourceNodeIds.length, renderWidth, renderHeight) ||
    (!preserveDraft && !sameJsonValue(operation, {kind:"task",task:base.pendingDraft.task})))) {
    throw figmaError("CONFLICT", "retain the pending draft or explicitly publish its exact controls");
  }
  const validateGraph = await effectSourceGraph(sourceNodeIds, input.fileKey, input.pageId, input.nodeId, 1);
  const proof = legacyPixelProof ? undefined : await prepareRasterSourceProof(sourceNodeIds,validateGraph);
  const captures = await captureMockupSources(sourceNodeIds, input.pageId, dynamicCanvas(operation) ? "native" : {width:renderWidth,height:renderHeight});
  const sources = captures.map(capture=>capture.source);
  const validate = () => { workScope(input); validateGraph(); proof?.validate(); };
  validate();
  const task = operation.kind === "task" && operation.task.kind === "deformation" ? operation.task : undefined;
  let shapeGuideClip: ReturnType<typeof normalizedDocumentShape> | undefined;
  if (task?.shapeGuideSourceIndex !== undefined) {
    const guide = await figma.getNodeByIdAsync(sourceNodeIds[task.shapeGuideSourceIndex]!);
    const shape = guide?.type === "VECTOR" ? await captureDocumentShapeForSource(guide as VectorNode) : undefined;
    if (!shape) throw figmaError("STATE", "choose a current closed vector guide");
    shapeGuideClip = normalizedDocumentShape(shape);
  }
  validate(); await workState(input); validate();
  const deformed=deformationOperation(operation);
  const placement = deformed ? {...base.placement} : {...base.placement, width:base.placement.width * renderWidth / base.renderWidth,
    height:base.placement.height * renderHeight / base.renderHeight};
  const data = {schema:"worldbend.figma.work-revision" as const, version:"0.1" as const,
    fileKey:input.fileKey,pageId:input.pageId,nodeId:input.nodeId,revision:base.revision,targetExpected:base.targetExpected,
    operation,sourceNodeIds,sources,renderWidth,renderHeight,placement,preserveDraft,
    ...(deformed?{previousOperation:base.operation}:{}),
    ...(proof ? {sourceState:proof.fingerprint} : {}),
    ...(operationDraftKey(operation) ? {draftKey:operationDraftKey(operation)!} : {}), ...(shapeGuideClip ? {shapeGuideClip} : {})};
  return { data:{...data,expected:proposalFingerprint({...data,sources:proof?sourceFacts(sources):sources})},validateGraph,validate,captures };
}

export async function readWorkRevision(input: WorkRevisionInput & WorkPage & { includeSourceRasters?: boolean; sourceRasterTransport?: "inline" | "artifact"; sourceFingerprints?:string[] }) {
  const {data,validate,captures} = await proposal(input);
  if(input.sourceFingerprints) {
    if(!(input.part && input.token) || input.sourceFingerprints.length!==data.sources.length ||
      input.sourceFingerprints.some(value=>!/^preview32x2:[1-9][0-9]*:[a-f0-9]{16}$/.test(value)))throw figmaError("INPUT","use captured source fingerprints only with a native-state part token");
    if(!data.sourceState)throw figmaError("CONFLICT","source state changed between parts; restart read");
    data.sources=data.sources.map((source,index)=>({...source,previewFingerprint:input.sourceFingerprints![index]!}));
  }
  const part = statePage(data,input);
  validate();
  if(input.sourceFingerprints && input.includeSourceRasters)throw figmaError("INPUT","source artifacts belong to the initial capture; do not re-export later parts");
  const sourceRasters=input.includeSourceRasters?exportCapturedSources(input.nodeId,captures,input.sourceRasterTransport??"inline"):undefined;
  validate();await workState(input);validate();
  return {...part,...(data.sourceState?{sourceFingerprints:data.sources.map(source=>source.previewFingerprint)}:{}),...(sourceRasters?{sourceRasters}:{})};
}

export async function publishWorkRevision(input: {snapshot:Awaited<ReturnType<typeof proposal>>["data"]; imageBase64:string; renderedOperation?:StoredOperation; renderedSize?:{width:number;height:number};canvasFrames?:RasterCanvasFrames},validatePublication?:()=>void) {
  const saved = input.snapshot, operation = input.renderedOperation ?? saved.operation;
  if(input.canvasFrames && (!deformationOperation(operation)||!saved.previousOperation||!isRasterCanvasFrames(input.canvasFrames))) {
    throw figmaError("INPUT","use the core canvas frames for a guarded deformation revision");
  }
  const size=input.renderedSize ?? {width:saved.renderWidth,height:saved.renderHeight};
  if(input.renderedSize && (!dynamicCanvas(operation) || !workOperationSupports(operation,saved.sourceNodeIds.length,size.width,size.height))) {
    throw figmaError("INPUT", "only dynamic Canvas resolves output size from actual pixels");
  }
  if(dynamicCanvas(operation)) assertRasterSize(input.imageBase64,size.width,size.height);
  const placement={...saved.placement,width:saved.placement.width * size.width / saved.renderWidth,
    height:saved.placement.height * size.height / saved.renderHeight};
  const ref:WorkRevisionInput = {fileKey:saved.fileKey,pageId:saved.pageId,nodeId:saved.nodeId,revision:saved.revision,
    targetExpected:saved.targetExpected,operation:saved.operation,sourceNodeIds:saved.sourceNodeIds,
    renderWidth:saved.renderWidth,renderHeight:saved.renderHeight};
  const renderedTask = operation.kind === "task" && operation.task.kind === "deformation" ? operation.task : undefined;
  if (input.renderedOperation) {
    const old = saved.operation.kind === "task" && saved.operation.task.kind === "deformation" ? saved.operation.task : undefined;
    const interior = (task:NonNullable<typeof old>) => {const {shapeFit,...work}=task.spec;return {...work,view:task.view,shapeGuideSourceIndex:task.shapeGuideSourceIndex};};
    if (!old || old.shapeGuideSourceIndex === undefined || !renderedTask ||
      !workOperationSupports(operation,saved.sourceNodeIds.length,saved.renderWidth,saved.renderHeight) ||
      !sameJsonValue(interior(old),interior(renderedTask)) || !sameJsonValue(renderedTask.spec.shapeFit?.clip,saved.shapeGuideClip)) {
      throw figmaError("INPUT", "preserve fitted work controls and the inspected guide");
    }
  }
  const current = () => proposal(ref,saved.sourceState===undefined);
  let accepted = await current();
  const comparable = (value:typeof saved)=>({...value,sources:value.sourceState?sourceFacts(value.sources):value.sources});
  const matches = () => {if (!sameJsonValue(comparable(accepted.data),comparable(saved))) throw figmaError("CONFLICT", "work/source changed; reread");};
  matches();
  return publishResultImage({...ref,expected:saved.expected,renderWidth:size.width,renderHeight:size.height,
    imageBase64:input.imageBase64,
    ...(saved.draftKey ? {draftKey:saved.draftKey} : {}),preserveDraft:saved.preserveDraft},
    async () => (await current()).data,
    (result) => {workScope(ref);accepted.validate();if (linkedTargetExpected(result)!==saved.targetExpected) throw figmaError("CONFLICT", "native work changed");},
    async () => {accepted=await current();matches();},
    result => {const binding=readResultBinding(result)!,targetExpected=linkedTargetExpected(result);
      return {...saved,revision:binding.revision,targetExpected,
        renderWidth:binding.renderWidth,renderHeight:binding.renderHeight,
        placement:{x:result.x,y:result.y,width:result.width,height:result.height},
        expected:boundedStateFingerprint(JSON.stringify({targetExpected,sources:saved.sourceState?sourceFacts(saved.sources):saved.sources,
          ...(saved.sourceState?{sourceState:saved.sourceState}:{}),...(saved.shapeGuideClip?{shapeGuideClip:saved.shapeGuideClip}:{})}))};},
    result => {
      // The common publisher restores geometry together with pixels and all
      // stored proofs if any write below fails.
      if(input.canvasFrames)transportRasterCanvas(result,input.canvasFrames);
      else if(result.width!==placement.width||result.height!==placement.height) result.resize(placement.width,placement.height);
      writeStoredOperation(result,operation);
      if(operation.kind==="task"&&["mockup","composition"].includes(operation.task.kind)) writeSceneReadProof(result,accepted.validateGraph.fingerprint);
    },validatePublication,
  ).then(done=>({schema:"worldbend.figma.work-publication",version:"0.1",fileKey:done.fileKey,pageId:done.pageId,
    nodeId:done.nodeId,revision:done.revision,targetExpected:done.targetExpected,expected:done.expected,affectedNodeIds:[done.nodeId]}));
}
