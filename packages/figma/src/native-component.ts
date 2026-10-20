import type { NativeFramePlan, TransformSpec, NativeAffineFrameState } from "@worldbend/web/types";
import type { Placement } from "./messages";
import type { NativeComponentProjection } from "./native-frame-record";
import { readComponentNativeProjection } from "./native-frame-record";
import type { NativeRenderer } from "./native-projective";
import { nativeShaderProperties, nativeCurrentSpec } from "./native-projective";
import { readStoredBinding, SHARED_BINDING_KEY, writeStoredBinding } from "./stored-binding";
import { readStoredOperationSlots, restoreStoredOperationSlots, writeStoredOperation } from "./stored-operation";
import { SHARED_NAMESPACE } from "./stored-plane";
import { prepareNativeCopy } from "./native-copy-closure";
import { clonedNativeGraph, rebindClonedNativeGraph } from "./native-clone-bindings";
import { placementBeside } from "./result-placement";
import { NativeRollbackIncompleteError } from "./native-errors";
import { nativePagePlacement, pointInCoordinateParent } from "./coordinate-parent";
import {nativeOutputBounds,nativeOutputAtBounds} from "./native-output-position";
import {createNativeShaderSurface} from "./native-shader-surface";
import {placeIndependentNativeCopy,fitNativePlacementContainers,nativePlacementContainers,nativeCopyPlacementNodeCount} from "./native-copy-placement";
import {captureNativeMotion,recordedRenderer,restoreNativeMotion,validateProjectiveMotionBase,
  readNativeMotionPlayhead,type NativeMotionGeometry,type NativeMotionSnapshot} from "./native-motion";
import {sameJsonValue} from "./json-value";

const identity:Transform=[[1,0,0],[0,1,0]];
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
const close=(a:number,b:number)=>Math.abs(a-b)<=Math.max(1e-4,Math.abs(b)*1e-6);
const sameMatrix=(a:Transform,b:Transform)=>a.every((row,i)=>row.every((v,j)=>close(v,b[i]![j]!)));

export { componentNativeTopology } from "./native-component-topology";
import { componentNativeTopology, type ComponentNativeTopology } from "./native-component-topology";
import { componentMasterMatches, localizeComponentCopy } from "./native-component-copy";

function rawRecord(result:FrameNode):NativeComponentProjection|undefined {
  const owned=readComponentNativeProjection(result);if(owned)return owned;
  try {const value=JSON.parse(result.getSharedPluginData(SHARED_NAMESPACE,"native"));
    return typeof value.resultNodeId==="string"&&value.resultNodeId!==result.id
      ?readComponentNativeProjection({id:value.resultNodeId,getSharedPluginData:(ns,key)=>result.getSharedPluginData(ns,key)}):undefined;
  }catch{return undefined;}
}

function validateTopology(result:FrameNode,record:NativeComponentProjection,parts:ComponentNativeTopology,identityMode:"strict"|"motion"="strict"):void {
  const {surface,basis,instance,master,content,masterContent}=parts;
  const copied=record.resultNodeId!==result.id;
  const ids=[content.id,surface.id,master.id,masterContent.id,instance.id,basis.id];
  const stored=[record.contentNodeId,record.surfaceNodeId,record.frame.masterNodeId,record.frame.masterContentNodeId,record.frame.instanceNodeId,record.frame.basisNodeId];
  if(identityMode==="strict"&&(!copied&&ids.some((id,i)=>id!==stored[i])||copied&&ids.some(id=>stored.includes(id))))throw Error("Native projection structure changed");
  const editing=record.sourceEditing===true;
  const scaleX=editing?1:result.width/record.outputSize.width,scaleY=editing?1:result.height/record.outputSize.height;
  const scaled=close(scaleX,scaleY)&&close(surface.width,record.frame.surfaceSize.width*scaleX)&&close(surface.height,record.frame.surfaceSize.height*scaleY)&&
    close(basis.width,record.frame.basisSize.width*scaleX)&&close(basis.height,record.frame.basisSize.height*scaleY);
  const actualOuter=copy(record.frame.outerBasis);
  if(scaled){actualOuter[0][2]*=scaleX;actualOuter[1][2]*=scaleY;}
  if(result.clipsContent===editing||master.visible!==editing||surface.visible===editing||!instance.visible||!content.visible||
    surface.layoutMode!=="NONE"||basis.layoutMode!=="NONE"||master.layoutMode!=="NONE"||
    basis.clipsContent||!sameMatrix(surface.relativeTransform,actualOuter)||!sameMatrix(basis.relativeTransform,record.frame.innerBasis)||
    !sameMatrix(instance.relativeTransform,identity)||!sameMatrix(content.relativeTransform,identity)||!sameMatrix(masterContent.relativeTransform,identity)||
    ![result.width,result.height].every(n=>Number.isFinite(n)&&n>0&&(editing||n<=4096))||
    ![content.width,content.height,instance.scaleFactor].every(n=>Number.isFinite(n)&&n>0))throw Error("Native projection structure changed");
  if(!scaled&&(!close(surface.width,record.frame.surfaceSize.width)||!close(surface.height,record.frame.surfaceSize.height)||
    !close(basis.width,record.frame.basisSize.width)||!close(basis.height,record.frame.basisSize.height)))throw Error("Native projection view box changed");
  if(!close(instance.scaleFactor,record.frame.instanceScale*(scaled?scaleX:1)))throw Error("Native projection scale changed");
  const effects=surface.effects as readonly {type:string;visible?:boolean;id?:string;properties?:Record<string,number>}[];
  if(record.renderer.kind==="affine") {
    if(surface.clipsContent||effects.length)throw Error("Native projection effect changed");
  }else {
    const effect=effects[0];
    if(!surface.clipsContent||effects.length!==1||effect?.type!=="SHADER"||effect.visible!==true||effect.id!==record.renderer.shaderId||
      !effect.properties)throw Error("Native projection effect changed");
    validateProjectiveMotionBase(surface,record.renderer.properties);
  }
}

function validateMotionGeometry(result:FrameNode,record:NativeComponentProjection,parts:ComponentNativeTopology):void {
  const exactMatrix=(actual:Transform,expected:Transform)=>actual.every((row,i)=>row.every((value,j)=>value===expected[i]![j]!));
  if(result.width!==record.outputSize.width||result.height!==record.outputSize.height||
    parts.content.width!==record.sourceSize.width||parts.content.height!==record.sourceSize.height||
    parts.surface.width!==record.frame.surfaceSize.width||parts.surface.height!==record.frame.surfaceSize.height||
    parts.basis.width!==record.frame.basisSize.width||parts.basis.height!==record.frame.basisSize.height||
    parts.instance.width!==record.frame.instanceSize.width||parts.instance.height!==record.frame.instanceSize.height||
    parts.instance.scaleFactor!==record.frame.instanceScale||
    !exactMatrix(parts.surface.relativeTransform,record.frame.outerBasis)||
    !exactMatrix(parts.basis.relativeTransform,record.frame.innerBasis))throw Error("Native projection geometry changed");
}

async function canonicalMotionTopology(record:NativeComponentProjection,evaluated:ComponentNativeTopology):Promise<ComponentNativeTopology> {
  const resolved=await Promise.all([
    record.surfaceNodeId,record.frame.basisNodeId,record.frame.instanceNodeId,record.frame.masterNodeId,
    record.contentNodeId,record.frame.masterContentNodeId,
  ].map(id=>figma.getNodeByIdAsync(id)));
  const [surface,basis,instance,master,content,masterContent]=resolved;
  if(surface?.type!=="FRAME"||basis?.type!=="FRAME"||instance?.type!=="INSTANCE"||master?.type!=="COMPONENT"||
    content?.type!=="FRAME"||masterContent?.type!=="FRAME"||
    surface.parent?.id!==evaluated.surface.parent?.id||master.parent?.id!==evaluated.master.parent?.id||
    basis.parent?.id!==evaluated.surface.id||instance.parent?.id!==evaluated.basis.id||
    content.parent?.id!==evaluated.instance.id||masterContent.parent?.id!==evaluated.master.id) {
    throw Error("Native projection structure changed");
  }
  return {surface,basis,instance,master,content,masterContent};
}

export async function componentNativeParts(result:FrameNode,record=rawRecord(result)) {
  if(!record)throw Error("Invalid native projection record");
  const parts=componentNativeTopology(result);
  const native=result.getSharedPluginData(SHARED_NAMESPACE,"native");
  const binding=readStoredBinding(record.resultNodeId===result.id?result:{id:record.resultNodeId,getSharedPluginData:(ns,key)=>result.getSharedPluginData(ns,key)});
  if(!binding||binding.sourceNodeIds.length!==1||binding.sourceNodeIds[0]!==record.contentNodeId)throw Error("Native projection binding changed");
  validateTopology(result,record,parts);
  if(!await componentMasterMatches(result.id,record,parts)||native!==result.getSharedPluginData(SHARED_NAMESPACE,"native"))throw Error("Native projection master changed");
  validateTopology(result,record,parts);
  const spec=record.renderer.kind==="projective"&&!record.sourceEditing?nativeCurrentSpec(record,parts.surface,result):JSON.parse(record.operation) as TransformSpec;
  // The saved operation owns unchanged geometry. Reconstructing it from the
  // host's float32 factors can turn an integer edge into N+epsilon, so a
  // no-op mode switch/update grows the tight canvas by a pixel on every read.
  // Rebase genuine native edits, without an epsilon that could hide small ones.
  const exactMatrix=(a:Transform,b:Transform)=>a.every((row,i)=>row.every((v,j)=>v===b[i]![j]!));
  const affineGeometryChanged=result.width!==record.outputSize.width||result.height!==record.outputSize.height||
    parts.content.width!==record.sourceSize.width||parts.content.height!==record.sourceSize.height||
    parts.instance.scaleFactor!==record.frame.instanceScale||
    !exactMatrix(parts.surface.relativeTransform,record.frame.outerBasis)||!exactMatrix(parts.basis.relativeTransform,record.frame.innerBasis);
  const affineState:NativeAffineFrameState|undefined=record.renderer.kind==="affine"&&!record.sourceEditing&&affineGeometryChanged?{
    outerBasis:copy(parts.surface.relativeTransform),innerBasis:copy(parts.basis.relativeTransform),
    sourceSize:{width:parts.content.width,height:parts.content.height},outputSize:record.sourceEditing?copy(record.outputSize):{width:result.width,height:result.height},orientation:spec.content.orientation??"native",
  }:undefined;
  return {...parts,record,binding,copied:record.resultNodeId!==result.id,spec,...(affineState?{affineState}:{})};
}

/** Figma Motion evaluates a selected timeline into transient descendant IDs.
 * Admit that view only while the host owns an active playhead and only when
 * its complete topology, base geometry and Motion data still match the
 * canonical stored graph. Ordinary reads and every general publication keep
 * using componentNativeParts' strict identity checks. */
export async function componentNativeMotionParts(result:FrameNode,record=rawRecord(result)) {
  const playheadPosition=readNativeMotionPlayhead(figma);
  if(playheadPosition===undefined||!record||record.resultNodeId!==result.id||record.sourceEditing||record.renderer.kind!=="projective") {
    throw Error("Native Motion view unavailable");
  }
  const native=result.getSharedPluginData(SHARED_NAMESPACE,"native");
  const bindingState=result.getSharedPluginData(SHARED_NAMESPACE,SHARED_BINDING_KEY);
  const binding=readStoredBinding(result);
  if(!binding||binding.sourceNodeIds.length!==1||binding.sourceNodeIds[0]!==record.contentNodeId)throw Error("Native projection binding changed");
  const parts=componentNativeTopology(result);
  validateTopology(result,record,parts,"motion");validateMotionGeometry(result,record,parts);
  const evaluatedMaster=await parts.instance.getMainComponentAsync();
  // Motion's evaluated instance and evaluated master receive transient IDs,
  // while getMainComponentAsync deliberately retains the canonical master.
  if(evaluatedMaster?.id!==record.frame.masterNodeId)throw Error("Native projection master changed");
  const canonical=await canonicalMotionTopology(record,parts);
  validateTopology(result,record,canonical);validateMotionGeometry(result,record,canonical);
  if(!await componentMasterMatches(result.id,record,canonical))throw Error("Native projection master changed");
  const evaluatedMotion=captureNativeMotion(parts.surface),canonicalMotion=captureNativeMotion(canonical.surface);
  evaluatedMotion.validate();canonicalMotion.validate();
  if(!sameJsonValue(evaluatedMotion.snapshot,canonicalMotion.snapshot))throw Error("Native projection Motion changed");
  if(native!==result.getSharedPluginData(SHARED_NAMESPACE,"native")||
    bindingState!==result.getSharedPluginData(SHARED_NAMESPACE,SHARED_BINDING_KEY)||readNativeMotionPlayhead(figma)!==playheadPosition) {
    throw Error("Native Motion view changed");
  }
  validateTopology(result,record,parts,"motion");
  validateMotionGeometry(result,record,parts);
  evaluatedMotion.validate();canonicalMotion.validate();
  return {...parts,record,binding,copied:false,spec:JSON.parse(record.operation) as TransformSpec};
}

export async function componentNativeSourceOwner(source:SceneNode):Promise<FrameNode|undefined> {
  let ancestor:BaseNode|null=source.parent;
  while(ancestor&&ancestor.type!=="PAGE"&&ancestor.type!=="DOCUMENT") {
    if(ancestor.type==="FRAME"&&rawRecord(ancestor)) {
      const parts=await componentNativeParts(ancestor);
      return parts.content.id===source.id?ancestor:undefined;
    }
    ancestor=ancestor.parent;
  }
  return undefined;
}

export interface ComponentNativeSnapshot {
  result:{width:number;height:number;x:number;y:number;transform?:Transform};
  outer:Transform;inner:Transform;scale:number;
  surfaceSize:{width:number;height:number};basisSize:{width:number;height:number};
  effects:readonly Effect[];clipsContent:boolean;
  resultClipsContent:boolean;surfaceVisible:boolean;masterVisible:boolean;
  containers?:Array<{id:string;width:number;height:number;transform:Transform}>;
}
export function componentSnapshot(result:FrameNode,p:ComponentNativeTopology):ComponentNativeSnapshot {
  const containers=nativePlacementContainers(result).map(node=>({id:node.id,width:node.width,height:node.height,transform:copy(node.relativeTransform)}));
  return {result:{width:result.width,height:result.height,x:result.x,y:result.y,transform:copy(result.relativeTransform)},outer:copy(p.surface.relativeTransform),inner:copy(p.basis.relativeTransform),
    scale:p.instance.scaleFactor,surfaceSize:{width:p.surface.width,height:p.surface.height},basisSize:{width:p.basis.width,height:p.basis.height},
    effects:copy(p.surface.effects),clipsContent:p.surface.clipsContent,
    resultClipsContent:result.clipsContent,surfaceVisible:p.surface.visible,masterVisible:p.master.visible,...(containers.length?{containers}:{})};
}
export function restoreComponentSnapshot(result:FrameNode,p:ComponentNativeTopology,s:ComponentNativeSnapshot):void {
  const containers=nativePlacementContainers(result);
  for(const saved of s.containers??[]){const node=containers.find(n=>n.id===saved.id);if(!node)throw Error("Native coordinate context changed");
    node.resizeWithoutConstraints(saved.width,saved.height);node.relativeTransform=copy(saved.transform);}
  p.instance.scaleFactor=s.scale;
  result.resizeWithoutConstraints(s.result.width,s.result.height);result.x=s.result.x;result.y=s.result.y;
  if(s.result.transform)result.relativeTransform=copy(s.result.transform);
  p.surface.resizeWithoutConstraints(s.surfaceSize.width,s.surfaceSize.height);p.surface.relativeTransform=copy(s.outer);
  p.basis.resizeWithoutConstraints(s.basisSize.width,s.basisSize.height);p.basis.relativeTransform=copy(s.inner);
  p.surface.clipsContent=s.clipsContent;p.surface.effects=copy(s.effects);
  result.clipsContent=s.resultClipsContent;p.surface.visible=s.surfaceVisible;p.master.visible=s.masterVisible;
}

/** Keep the canonical source inside its result so native Duplicate owns a
 * complete, independent graph in either view. Returning uses core publication. */
export async function showComponentNativeSource(result:FrameNode,spec:TransformSpec,beforeWrite:()=>void):Promise<FrameNode> {
  const initial=await componentNativeParts(result);
  if(initial.record.sourceEditing&&initial.master.type==="COMPONENT")return initial.masterContent;
  const {proof}=await loadSourceContext(result);
  const old={geometry:componentSnapshot(result,initial),native:result.getSharedPluginData(SHARED_NAMESPACE,"native"),
    binding:result.getSharedPluginData(SHARED_NAMESPACE,SHARED_BINDING_KEY),slots:readStoredOperationSlots(result)};
  beforeWrite();proof.validate();
  let adoption:ReturnType<typeof localizeComponentCopy>|undefined;
  try {
    adoption=localizeComponentCopy(result,initial,initial.record.sourceEditing);
    const p={...initial,...adoption.parts};
    const record:NativeComponentProjection={...p.record,sourceEditing:true,resultNodeId:result.id,
      contentNodeId:p.content.id,surfaceNodeId:p.surface.id,
      operation:JSON.stringify(spec),sourceSize:{width:p.content.width,height:p.content.height},
      outputSize:p.record.sourceEditing?copy(p.record.outputSize):{width:result.width,height:result.height},
      placement:nativePagePlacement(result,p.record.sourceEditing?p.record.outputSize:result),
      frame:{...p.record.frame,masterNodeId:p.master.id,masterContentNodeId:p.masterContent.id,instanceNodeId:p.instance.id,basisNodeId:p.basis.id,
        instanceScale:p.instance.scaleFactor,outerBasis:copy(p.surface.relativeTransform),innerBasis:copy(p.basis.relativeTransform),
        surfaceSize:{width:p.surface.width,height:p.surface.height},basisSize:{width:p.basis.width,height:p.basis.height},
        instanceSize:{width:p.instance.width,height:p.instance.height}}};
    result.clipsContent=false;p.surface.visible=false;p.master.visible=true;
    result.resizeWithoutConstraints(p.masterContent.width,p.masterContent.height);
    fitNativePlacementContainers(result);
    writeStoredOperation(result,{kind:"transform",spec});
    writeStoredBinding(result,{sourceNodeIds:[p.content.id],renderWidth:p.binding.renderWidth,renderHeight:p.binding.renderHeight});
    result.setSharedPluginData(SHARED_NAMESPACE,"native",JSON.stringify(record));
    await componentNativeParts(result);
    adoption.commit();
    return p.masterContent;
  }catch(error){
    try{adoption?.rollback();restoreComponentSnapshot(result,initial,old.geometry);restoreStoredOperationSlots(result,old.slots);
      result.setSharedPluginData(SHARED_NAMESPACE,SHARED_BINDING_KEY,old.binding);result.setSharedPluginData(SHARED_NAMESPACE,"native",old.native);}
    catch{throw new NativeRollbackIncompleteError("Native source view rollback incomplete");}
    throw error;
  }
}

/** Reapply the recorded publication after a host Undo returned metadata first. */
export async function restoreComponentProjection(result:FrameNode,beforeWrite:()=>void):Promise<void> {
  const record=rawRecord(result);if(!record)throw Error("Native recovery unavailable");
  const parts=componentNativeTopology(result),prior=componentSnapshot(result,parts);
  const raw=result.getSharedPluginData(SHARED_NAMESPACE,"native");
  if(!await componentMasterMatches(result.id,record,parts)||raw!==result.getSharedPluginData(SHARED_NAMESPACE,"native"))throw Error("Native recovery master changed");
  beforeWrite();
  try {
    const point=pointInCoordinateParent(result,record.placement);
    restoreComponentSnapshot(result,parts,{result:{...(record.sourceEditing?{width:parts.masterContent.width,height:parts.masterContent.height}:record.outputSize),...point},
      outer:record.frame.outerBasis,inner:record.frame.innerBasis,scale:record.frame.instanceScale,
      surfaceSize:record.frame.surfaceSize,basisSize:record.frame.basisSize,
      resultClipsContent:!record.sourceEditing,surfaceVisible:!record.sourceEditing,masterVisible:!!record.sourceEditing,
      clipsContent:record.renderer.kind==="projective",effects:record.renderer.kind==="affine"?[]:[{type:"SHADER",visible:true,id:record.renderer.shaderId,properties:record.renderer.properties}] as unknown as Effect[]});
    await componentNativeParts(result);
  }catch(error){try{restoreComponentSnapshot(result,parts,prior);}catch{throw new NativeRollbackIncompleteError("Native recovery rollback incomplete");}throw error;}
}

export interface ComponentNativePublishInput {
  source:FrameNode;existing?:FrameNode;nativePlan:NativeFramePlan;renderer?:NativeRenderer;
  spec:TransformSpec;placement:Placement;renderWidth:number;renderHeight:number;
  beforeWrite?:()=>void;onCreated?:(result:FrameNode)=>void;replaceContent?:boolean;
  surfaceAppearance?:FrameNode;
  surfaceMotion?:NativeMotionSnapshot;
  surfaceMotionRenderer?:NativeRenderer;
  surfaceMotionGeometry?:NativeMotionGeometry;
}

async function loadSourceContext(source:FrameNode) {
  const proof=await prepareNativeCopy([source]);
  const fonts=new Map<string,FontName>();
  for(const node of proof.originals.values())if(node.type==="TEXT")for(const segment of node.getStyledTextSegments(["fontName"]))fonts.set(JSON.stringify(segment.fontName),segment.fontName);
  if(fonts.size>256)throw Error("Native source exceeds 256 fonts");
  await Promise.all([...fonts.values()].map(font=>figma.loadFontAsync(font)));
  const modes=Object.entries(source.resolvedVariableModes);
  if(modes.length>256)throw Error("Native source exceeds 256 variable collections");
  const resolved=await Promise.all(modes.map(async([id,mode])=>{const collection=await figma.variables.getVariableCollectionByIdAsync(id);
    if(!collection||!collection.modes.some(m=>m.modeId===mode))throw Error("Native source variable mode unavailable");return {collection,mode};}));
  proof.validate();return {proof,modes:resolved};
}

function prepareFrame(frame:FrameNode):void {
  frame.fills=[];frame.strokes=[];frame.effects=[];frame.layoutMode="NONE";frame.clipsContent=false;
}

export async function publishComponentNativeResult(input:ComponentNativePublishInput,preparedSurface?:FrameNode):Promise<FrameNode> {
  const {nativePlan:plan}=input;
  if(input.spec.content.warp||![input.placement.width,input.placement.height].every(n=>Number.isFinite(n)&&n>0&&n<=4096)||
    !close(plan.sourceSize.width,input.source.width)||!close(plan.sourceSize.height,input.source.height)||
    !close(plan.outputSize.width,input.placement.width)||!close(plan.outputSize.height,input.placement.height))throw Error("Native plan/source changed");
  if(plan.kind==="projective"&&!input.renderer)throw Error("Native sampler unavailable");
  // A Content sublayer must keep its instance overrides and the owned master
  // relationships. Copy their complete graph, never clone computed text alone.
  if(!input.existing) {
    let ancestor:BaseNode|null=input.source.parent;
    while(ancestor&&ancestor.type!=="PAGE"&&ancestor.type!=="DOCUMENT") {
      if(ancestor.type==="FRAME"&&rawRecord(ancestor)) {
        const original=await componentNativeParts(ancestor);
        if(original.content.id!==input.source.id)break;
        const context=await loadSourceContext(ancestor);input.beforeWrite?.();context.proof.validate();
        if(context.proof.nodeCount+nativeCopyPlacementNodeCount(ancestor)>20000)throw Error("Native copy exceeds 20000 nodes");
        let result:FrameNode|undefined,outer:FrameNode|undefined;
        try {
          preparedSurface=(await prepareProjectiveSurface(input,original.surface,()=>{input.beforeWrite?.();context.proof.validate();}))();
          result=ancestor.clone();
          outer=placeIndependentNativeCopy(result,ancestor,input.placement);
          const point=pointInCoordinateParent(result,input.placement);
          for(const {collection,mode} of context.modes)result.setExplicitVariableModeForCollection(collection,mode);
          const graph=clonedNativeGraph(ancestor,result);rebindClonedNativeGraph(graph.copies,graph.originals,undefined,true);
          input.onCreated?.(result);
          if(outer!==result)outer.name=result.name;
          const content=componentNativeTopology(result).content;
          const {beforeWrite:_before,onCreated:_created,...next}=input;
          return await publishPreparedComponentNativeResult({...next,source:content,existing:result,placement:{...input.placement,...point}},
            {...original,...componentNativeTopology(result)},context,preparedSurface);
        }catch(error){try{if(outer&&!outer.removed)outer.remove();if(result&&!result.removed)result.remove();if(preparedSurface&&!preparedSurface.removed)preparedSurface.remove();}catch{throw new NativeRollbackIncompleteError("Native copy rollback incomplete");}throw error;}
      }
      ancestor=ancestor.parent;
    }
  }
  const existing=input.existing?await componentNativeParts(input.existing):undefined;
  const copiedSourceEdit=existing?.record.sourceEditing&&existing.master.type==="INSTANCE"&&existing.masterContent.id===input.source.id;
  if(existing&&existing.content.id!==input.source.id&&!copiedSourceEdit) {
    if(!input.replaceContent)throw Error("Select the native content to update this result");
    return replaceComponentSource(input,existing);
  }
  const context=await loadSourceContext(input.source);
  input.beforeWrite?.();context.proof.validate();
  return publishPreparedComponentNativeResult(input,existing,context,preparedSurface);
}

async function publishPreparedComponentNativeResult(input:ComponentNativePublishInput,existing:Awaited<ReturnType<typeof componentNativeParts>>|undefined,
  context:Awaited<ReturnType<typeof loadSourceContext>>,preparedSurface?:FrameNode):Promise<FrameNode> {
  const plan=input.nativePlan;
  const capturedMotion=existing?captureNativeMotion(existing.surface):undefined;
  const motion=capturedMotion?.snapshot??input.surfaceMotion;
  const oldMotionRenderer=existing?.record.renderer.kind==="projective"
    ?recordedRenderer(existing.record.renderer.shaderId,existing.record.renderer.properties):input.surfaceMotionRenderer;
  const oldMotionGeometry:NativeMotionGeometry|undefined=existing?{source:existing.record.sourceSize,
    surface:existing.record.frame.surfaceSize}:input.surfaceMotionGeometry;
  let result=input.existing;
  const old=existing&&result?{geometry:componentSnapshot(result,existing),native:result.getSharedPluginData(SHARED_NAMESPACE,"native"),
    binding:result.getSharedPluginData(SHARED_NAMESPACE,SHARED_BINDING_KEY),slots:readStoredOperationSlots(result)}:undefined;
  let parts:ComponentNativeTopology|undefined=existing;
  let detached:SceneNode|undefined;
  let retiredSurface:FrameNode|undefined;
  let replacementSurface:FrameNode|undefined;
  let adoption:ReturnType<typeof localizeComponentCopy>|undefined;
  try {
    if(plan.kind==="projective"||existing||input.surfaceAppearance)preparedSurface??=(await prepareProjectiveSurface(input,existing?.surface??input.surfaceAppearance,()=>{input.beforeWrite?.();context.proof.validate();capturedMotion?.validate();}))();
    capturedMotion?.validate();
    result??=figma.createFrame();
    if(parts){adoption=localizeComponentCopy(result,parts,existing?.record.sourceEditing);parts=adoption.parts;}
    if(!parts){
      prepareFrame(result);result.clipsContent=true;result.name=`${input.source.name} · Worldbend`;input.onCreated?.(result);
      const surface=preparedSurface??figma.createFrame();if(!preparedSurface)prepareFrame(surface);surface.name="Projection";result.appendChild(surface);
      const basis=figma.createFrame();prepareFrame(basis);basis.name="Basis";surface.appendChild(basis);
      const master=figma.createComponent();master.fills=[];master.strokes=[];master.effects=[];master.layoutMode="NONE";master.clipsContent=false;master.name="Source";
      result.appendChild(master);master.resizeWithoutConstraints(input.source.width,input.source.height);master.x=0;master.y=0;
      const masterContent=input.source.clone();detached=masterContent;
      for(const {collection,mode} of context.modes)masterContent.setExplicitVariableModeForCollection(collection,mode);
      master.appendChild(masterContent);detached=undefined;masterContent.x=0;masterContent.y=0;masterContent.name="Content";
      const instance=master.createInstance();detached=instance;basis.appendChild(instance);detached=undefined;
      instance.name="Live content";instance.x=0;instance.y=0;master.visible=false;instance.visible=true;
      const content=instance.children[0];if(content?.type!=="FRAME")throw Error("Native instance content unavailable");
      parts={surface,basis,master,masterContent,instance,content};
    }else if(preparedSurface||parts.surface.effects.some(effect=>effect.type==="SHADER")){
      const surface=preparedSurface??figma.createFrame();if(!preparedSurface)prepareFrame(surface);
      replacementSurface=surface;
      surface.name=parts.surface.name;
      retiredSurface=parts.surface;
      // Keep the old effect untouched until validation succeeds. Reparenting
      // the actual Basis preserves Content, instance overrides and their IDs.
      figma.currentPage.appendChild(retiredSurface);retiredSurface.visible=false;
      result.insertChild(0,surface);surface.appendChild(parts.basis);
      parts={...parts,surface};
    }
    const {surface,basis,instance,content}=parts;
    result.clipsContent=true;surface.visible=true;parts.master.visible=false;
    result.resizeWithoutConstraints(input.placement.width,input.placement.height);result.x=input.placement.x;result.y=input.placement.y;
    if(plan.kind==="affine") {
      instance.scaleFactor*=plan.contentScale;
      surface.relativeTransform=copy(plan.outerBasis);basis.relativeTransform=copy(plan.innerBasis);
      surface.effects=[];surface.clipsContent=false;
    }else {surface.relativeTransform=copy(identity);basis.relativeTransform=copy(identity);surface.clipsContent=true;}
    surface.resizeWithoutConstraints(Math.ceil(Math.max(content.width,result.width)),Math.ceil(Math.max(content.height,result.height)));
    basis.resizeWithoutConstraints(content.width,content.height);
    fitNativePlacementContainers(result);
    let renderer:NativeComponentProjection["renderer"]={kind:"affine"};
    let properties:Record<string,number>|undefined;
    if(plan.kind==="projective") {
      properties=nativeShaderProperties(input.renderer!,plan.inverse,content,surface);
      renderer={kind:"projective",shaderId:(surface.effects[0] as unknown as {id:string}).id,properties};
    }
    const motionGeometryCompatible=!oldMotionGeometry||
      close(oldMotionGeometry.source.width,content.width)&&close(oldMotionGeometry.source.height,content.height)&&
      close(oldMotionGeometry.surface.width,surface.width)&&close(oldMotionGeometry.surface.height,surface.height);
    restoreNativeMotion(surface,motion,oldMotionRenderer,plan.kind==="projective"?input.renderer:undefined,properties,motionGeometryCompatible);
    const record:NativeComponentProjection={schema:"worldbend.figma.native",version:"0.3",resultNodeId:result.id,contentNodeId:content.id,surfaceNodeId:surface.id,
      sourceSize:{width:content.width,height:content.height},outputSize:{width:result.width,height:result.height},
      placement:nativePagePlacement(result),operation:JSON.stringify(input.spec),renderer,
      frame:{masterNodeId:parts.master.id,masterContentNodeId:parts.masterContent.id,instanceNodeId:instance.id,basisNodeId:basis.id,
        instanceScale:instance.scaleFactor,outerBasis:copy(surface.relativeTransform),innerBasis:copy(basis.relativeTransform),
        surfaceSize:{width:surface.width,height:surface.height},basisSize:{width:basis.width,height:basis.height},instanceSize:{width:instance.width,height:instance.height}}};
    validateTopology(result,record,parts);
    writeStoredOperation(result,{kind:"transform",spec:input.spec});
    writeStoredBinding(result,{sourceNodeIds:[content.id],renderWidth:input.renderWidth,renderHeight:input.renderHeight});
    result.setSharedPluginData(SHARED_NAMESPACE,"native",JSON.stringify(record));
    if(!readComponentNativeProjection(result))throw Error("Native publication record did not persist");
    retiredSurface?.remove();
    adoption?.commit();
    return result;
  }catch(error){
    try {if(!input.existing){detached?.remove();if(preparedSurface&&!preparedSurface.removed&&preparedSurface.parent?.id!==result?.id)preparedSurface.remove();result?.remove();}
      else if(old&&parts&&result){
        if(retiredSurface&&existing){result.insertChild(0,retiredSurface);retiredSurface.appendChild(existing.basis);replacementSurface?.remove();parts=existing;}
        else if(preparedSurface&&!preparedSurface.removed&&preparedSurface.parent?.id!==result.id)preparedSurface.remove();
        adoption?.rollback();parts=existing!;
        restoreComponentSnapshot(result,parts,old.geometry);restoreStoredOperationSlots(result,old.slots);
        result.setSharedPluginData(SHARED_NAMESPACE,SHARED_BINDING_KEY,old.binding);result.setSharedPluginData(SHARED_NAMESPACE,"native",old.native);}}
    catch{throw new NativeRollbackIncompleteError("Native publication rollback incomplete");}
    throw error;
  }
}

async function prepareProjectiveSurface(input:ComponentNativePublishInput,appearance?:FrameNode,beforeCreate?:()=>void):Promise<()=>FrameNode> {
  const size={width:Math.ceil(Math.max(input.source.width,input.placement.width)),
    height:Math.ceil(Math.max(input.source.height,input.placement.height))};
  if(input.nativePlan.kind==="projective"&&!input.renderer)throw Error("Native sampler unavailable");
  return createNativeShaderSurface({...size,appearance,...(beforeCreate?{beforeCreate}:{}),...(input.nativePlan.kind==="projective"?{shaderId:input.renderer!.id,
    properties:nativeShaderProperties(input.renderer!,input.nativePlan.inverse,input.source,size)}:{})});
}

/** Preserve the previous owned source graph (and every externally referenced
 * content ID) while replacing the selected result in place. */
async function replaceComponentSource(input:ComponentNativePublishInput, old:Awaited<ReturnType<typeof componentNativeParts>>):Promise<FrameNode> {
  const result=input.existing!;
  const context=await loadSourceContext(result);
  const proof=await prepareNativeCopy([result,input.source]);context.proof.validate();
  const page=figma.currentPage;
  if(page.children.length>20000)throw Error("Native replacement page exceeds 20000 roots");
  const occupied=page.children.flatMap(n=>n.visible&&n.absoluteBoundingBox?[n.absoluteBoundingBox]:[]);
  const box=result.absoluteBoundingBox;
  if(!box)throw Error("Native replacement bounds unavailable");
  const retainedBasis=copy(result.absoluteTransform);
  const retainedBounds=nativeOutputBounds(result,retainedBasis);
  const retainedPlacement=placementBeside([box],retainedBounds,occupied);
  const before={geometry:componentSnapshot(result,old),native:result.getSharedPluginData(SHARED_NAMESPACE,"native"),
    binding:result.getSharedPluginData(SHARED_NAMESPACE,SHARED_BINDING_KEY),slots:readStoredOperationSlots(result)};
  const motion=captureNativeMotion(old.surface);
  const motionRenderer=old.record.renderer.kind==="projective"
    ?recordedRenderer(old.record.renderer.shaderId,old.record.renderer.properties):undefined;
  const motionGeometry:NativeMotionGeometry={source:old.record.sourceSize,surface:old.record.frame.surfaceSize};
  const {existing:_existing,beforeWrite:_before,onCreated:_created,...fresh}=input;
  let replacement:FrameNode|undefined,retained:FrameNode|undefined,retainedOuter:FrameNode|undefined;
  input.beforeWrite?.();proof.validate();
  try {
    motion.validate();
    replacement=await publishComponentNativeResult({...fresh,surfaceAppearance:old.surface,
      ...(motion.snapshot?{surfaceMotion:motion.snapshot,surfaceMotionGeometry:motionGeometry}:{}),
      ...(motionRenderer?{surfaceMotionRenderer:motionRenderer}:{})});
    motion.validate();
    proof.validate();
    const next=await componentNativeParts(replacement);
    // Clone the outer wrapper to retain its authored fills, strokes, opacity,
    // effects and variable modes. Move the actual old graph into it so every
    // existing Content identity remains valid for continued use.
    retained=result.clone();
    for(const child of [...retained.children])child.remove();
    retained.name=`Previous artwork · ${result.name}`;
    const retainedOrigin=nativeOutputAtBounds(result,retainedPlacement,retainedBasis);
    retainedOuter=placeIndependentNativeCopy(retained,result,{x:retainedOrigin[0][2],y:retainedOrigin[1][2]});
    for(const {collection,mode} of context.modes)retained.setExplicitVariableModeForCollection(collection,mode);
    for(const child of [...result.children])retained.appendChild(child);
    restoreStoredOperationSlots(retained,before.slots);
    writeStoredBinding(retained,{...old.binding,sourceNodeIds:[old.content.id]},{newResult:true});
    const retainedSize=old.record.sourceEditing?old.record.outputSize:{width:result.width,height:result.height};
    retained.setSharedPluginData(SHARED_NAMESPACE,"native",JSON.stringify({...old.record,resultNodeId:retained.id,
      sourceSize:{width:old.content.width,height:old.content.height},outputSize:retainedSize,
      placement:nativePagePlacement(retained,retainedSize),frame:{...old.record.frame,
        instanceScale:old.instance.scaleFactor,outerBasis:copy(old.surface.relativeTransform),innerBasis:copy(old.basis.relativeTransform),
        surfaceSize:{width:old.surface.width,height:old.surface.height},basisSize:{width:old.basis.width,height:old.basis.height},
        instanceSize:{width:old.instance.width,height:old.instance.height}}}));
    if(old.master.type==="INSTANCE"){
      // Retain the unadopted host copy as a copy, including its shared origin.
      // Relabeling a proxy Source as an owned component would make the old
      // Content (still consumed elsewhere) impossible to reopen.
      retained.setSharedPluginData(SHARED_NAMESPACE,"native",before.native);
      retained.setSharedPluginData(SHARED_NAMESPACE,SHARED_BINDING_KEY,before.binding);
    }
    for(const child of [...replacement.children])result.appendChild(child);
    result.resizeWithoutConstraints(input.placement.width,input.placement.height);result.x=input.placement.x;result.y=input.placement.y;
    fitNativePlacementContainers(result);
    writeStoredOperation(result,{kind:"transform",spec:input.spec});
    writeStoredBinding(result,{sourceNodeIds:[next.content.id],renderWidth:input.renderWidth,renderHeight:input.renderHeight});
    result.setSharedPluginData(SHARED_NAMESPACE,"native",JSON.stringify({...next.record,resultNodeId:result.id,
      placement:nativePagePlacement(result)}));
    await componentNativeParts(result);await componentNativeParts(retained);
    replacement.remove();return result;
  }catch(error){
    try {
      if(retained) {
        // New children belong to the temporary result until the transaction
        // completes. Remove only those; the old graph keeps all its IDs.
        for(const child of [...result.children])if(child.id!==old.surface.id&&child.id!==old.master.id)child.remove();
        result.insertChild(0,old.surface);result.insertChild(1,old.master);
        restoreComponentSnapshot(result,old,before.geometry);restoreStoredOperationSlots(result,before.slots);
        result.setSharedPluginData(SHARED_NAMESPACE,SHARED_BINDING_KEY,before.binding);result.setSharedPluginData(SHARED_NAMESPACE,"native",before.native);
        if(retainedOuter&&!retainedOuter.removed)retainedOuter.remove();
        if(!retained.removed)retained.remove();
      }
      if(replacement&&!replacement.removed)replacement.remove();
    }catch{throw new NativeRollbackIncompleteError("Native source replacement rollback incomplete");}
    throw error;
  }
}
