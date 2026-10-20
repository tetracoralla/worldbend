import {parseNativeSceneReference} from "./native-scene-model";
import {copyNativeScene,nativeSceneForResult} from "./native-scene-main";
import {prepareNativeCopy,nativeNodeSnapshot} from "./native-copy-closure";
import {readStoredOperationSlots} from "./stored-operation";
import {rasterPaintsIntact,writeRasterPaintProof} from "./raster-paint-guard";
import type {FigmaCompositionTask} from "./stored-designer-task";

export const SCENE_ANIMATION_KEY="sceneAnimation";
const FRAME_KEY="sceneAnimationFrame";
const MAX_BYTES=64*1024*1024;
export function sceneAnimationAuthoringResult(node:SceneNode):RectangleNode|undefined {
 if(node.type!=="FRAME"||!node.getSharedPluginData("worldbend",SCENE_ANIMATION_KEY))return;
 const reference=parseNativeSceneReference(node.getSharedPluginData("worldbend","nativeScene"));
 if(!reference||reference.rootNodeId!==node.id)return;
 const result=node.findOne(child=>child.id===reference.resultNodeId);
 return result?.type==="RECTANGLE"?result:undefined;
}
export function sceneFrameVisibility(index:number,count:number,fps:number,end:number,restingOpacity=0):ManualKeyframeTrackInput {
 const key=(timelinePosition:number,value:number):ManualKeyframeInput=>({timelinePosition,value:{type:"FLOAT",value},easing:{type:"HOLD"}});
 const start=index/fps;
 const keys=index===0?[key(0,1)]:[key(0,0),key(start,1)];
 if(index<count-1)keys.push(key((index+1)/fps,0));
 else if(end>start)keys.push(key(end,1));
 return {baseValue:{type:"FLOAT",value:restingOpacity},keyframes:keys};
}

interface AnimationMetadata {frameCount:number;fps:number;posterFrame:number;timelineEnd:number;frameGeometry?:string;frameAppearance?:string}
function readAnimationMetadata(root:FrameNode):AnimationMetadata|undefined {
 try{const v=JSON.parse(root.getSharedPluginData("worldbend",SCENE_ANIMATION_KEY));
  if(v.schema!=="worldbend.figma.scene-animation"||v.version!=="0.1"||!Number.isSafeInteger(v.frameCount)||v.frameCount<1||v.frameCount>240||![12,24,30,60].includes(v.fps)||!Number.isSafeInteger(v.posterFrame)||v.posterFrame<0||v.posterFrame>=v.frameCount||!Number.isFinite(v.timelineEnd)||v.timelineEnd<(v.frameCount-1)/v.fps-1e-6)return;
  if((v.frameGeometry!==undefined&&typeof v.frameGeometry!=="string")||(v.frameAppearance!==undefined&&typeof v.frameAppearance!=="string"))return;
  return v;
 }catch{return;}
}
/** Generated gates can be rebuilt only while their owned geometry/timing is
 * intact. Native edits outside those gates remain ordinary copied scene work. */
export function sceneAnimationGateIntact(wrapper:FrameNode,meta:AnimationMetadata):boolean {
 let index:number;try{index=JSON.parse(wrapper.getSharedPluginData("worldbend",FRAME_KEY)).index;}catch{return false;}
 if(!Number.isSafeInteger(index)||index<0||index>=meta.frameCount||wrapper.parent?.type!=="FRAME"||wrapper.width!==wrapper.parent.width||wrapper.height!==wrapper.parent.height||wrapper.opacity!==(index===meta.posterFrame?1:0)||!wrapper.visible||wrapper.isMask||wrapper.clipsContent||wrapper.blendMode!=="PASS_THROUGH"||wrapper.layoutMode!=="NONE"||wrapper.cornerRadius!==0||!Array.isArray(wrapper.fills)||wrapper.fills.length||wrapper.strokes.length||wrapper.effects.length||JSON.stringify(wrapper.relativeTransform)!==JSON.stringify([[1,0,0],[0,1,0]])||(wrapper.animationStyles?.length??0)>0)return false;
 const tracks=wrapper.manualKeyframeTracks;if(Object.keys(tracks).length!==1||!tracks.OPACITY)return false;
 const expected=sceneFrameVisibility(index,meta.frameCount,meta.fps,meta.timelineEnd,index===meta.posterFrame?1:0),actual=tracks.OPACITY;
 if(JSON.stringify(actual.baseValue)!==JSON.stringify(expected.baseValue)||actual.keyframes.length!==expected.keyframes.length)return false;
 return actual.keyframes.every((key,i)=>Math.abs(key.timelinePosition-expected.keyframes[i]!.timelinePosition)<=1e-6&&JSON.stringify(key.value)===JSON.stringify(expected.keyframes[i]!.value)&&JSON.stringify(key.easing)===JSON.stringify(expected.keyframes[i]!.easing));
}
function leafAppearance(node:RectangleNode):string {
 return JSON.stringify({visible:node.visible,opacity:node.opacity,blendMode:node.blendMode,effects:node.effects,strokes:node.strokes,strokeWeight:node.strokeWeight,strokeAlign:node.strokeAlign,cornerRadius:node.cornerRadius,isMask:node.isMask});
}
function leafPlacement(node:RectangleNode):string{return JSON.stringify({width:node.width,height:node.height,transform:node.relativeTransform});}
export function sceneAnimationFrameIntact(wrapper:FrameNode,meta:AnimationMetadata,primary:RectangleNode):boolean {
 const leaf=wrapper.children[0];
 return sceneAnimationGateIntact(wrapper,meta)&&wrapper.children.length===1&&leaf?.type==="RECTANGLE"&&rasterPaintsIntact(leaf)&&leafAppearance(leaf)===(meta.frameAppearance??leafAppearance(primary))&&(leaf===primary||leafPlacement(leaf)===(meta.frameGeometry??leafPlacement(primary)));
}

/** One provisional native scene. Core-produced frames replace only the linked
 * image; its surrounding native graph and native Motion remain native. */
export async function beginNativeSceneAnimation(input:{
 result:RectangleNode;task:Extract<FigmaCompositionTask,{kind:"composition"}>;renderWidth:number;renderHeight:number;
 name:string;placement:{x:number;y:number};assertCurrent():void;track(node:SceneNode):void;
}) {
 const motion=input.task.motion;if(!motion)throw Error("Enable animation first");
 const fps=motion.spec.timebase.numerator/motion.spec.timebase.denominator;
 if(![12,24,30,60].includes(fps))throw Error("Native Motion video supports 12, 24, 30 or 60 frames per second. Retime this work before creating its native animation.");
 // Probe the actual beta getters before creating a document object.
 void input.result.manualKeyframeTracks;
 const reference=nativeSceneForResult(input.result);
 const originalRoot=reference?await figma.getNodeByIdAsync(reference.rootNodeId):input.result.parent;
 if(!originalRoot||originalRoot.type!=="FRAME")throw Error("Select a linked result inside a native scene");
 const originalProof=await prepareNativeCopy([originalRoot]);
 input.assertCurrent();originalProof.validate();
 const copied=await copyNativeScene({result:input.result,task:input.task,expectedSlots:readStoredOperationSlots(input.result),name:input.name,
  renderSize:{width:input.renderWidth,height:input.renderHeight},placement:input.placement,assertCurrent:input.assertCurrent,begin(){}});
 const root=copied.root;
 const externals:SceneNode[]=[];
 let disposed=false,committed=false,next=0,totalBytes=0,pending=false;
 const wrappers:FrameNode[]=[];
 const originalPrimary=copied.result;
 // Continued delivery rebuilds only its owned frame gates. Native decoration,
 // source copies and designer-authored Motion are retained in the new delivery.
 const previousWrappers=copied.preview.findAll(n=>n.type==="FRAME"&&Boolean(n.getSharedPluginData("worldbend",FRAME_KEY))) as FrameNode[];
 if(previousWrappers.length){
  try{
  const metadata=readAnimationMetadata(root);const indices=new Set<number>();
  for(const wrapper of previousWrappers){
   const index=JSON.parse(wrapper.getSharedPluginData("worldbend",FRAME_KEY)).index as number;
   const changed=!metadata||previousWrappers.length!==metadata.frameCount||indices.has(index)||!sceneAnimationFrameIntact(wrapper,metadata,originalPrimary);
   if(changed){root.remove();throw Error("A generated animation frame was edited. Keep this scene and create animation from its original editable source.");}
   indices.add(index);
  }
  const primaryWrapper=originalPrimary.parent;
  if(!primaryWrapper||primaryWrapper.type!=="FRAME"||!previousWrappers.includes(primaryWrapper)||primaryWrapper.parent?.type!=="FRAME"){root.remove();throw Error("Animation source relationship is unavailable");}
  const outer=primaryWrapper.parent,relative=originalPrimary.relativeTransform;
  outer.insertChild(outer.children.indexOf(primaryWrapper),originalPrimary);originalPrimary.relativeTransform=relative;
  for(const wrapper of previousWrappers)wrapper.remove();
  root.setSharedPluginData("worldbend",SCENE_ANIMATION_KEY,"");
  }catch(error){if(!root.removed)root.remove();throw error;}
 }
 const parent=originalPrimary.parent;
 if(!parent||parent.type!=="FRAME"){root.remove();throw Error("Native scene image parent is unavailable");}
 const transform=originalPrimary.relativeTransform,primaryWidth=originalPrimary.width,primaryHeight=originalPrimary.height;
 const insertion=parent.children.indexOf(originalPrimary);
 const check=()=>{if(disposed)throw Error("Scene animation cancelled");input.assertCurrent();originalProof.validate();};
 const mark=(node:SceneNode)=>{node.setPluginData("sceneDraft","1");input.track(node);};
 const retire=()=>{if(disposed)return;disposed=true;if(!committed){if(!root.removed)root.remove();for(const node of externals)if(!node.removed)node.remove();}};
 try{
  // Keep editable source copies beside the output, outside the encoded frame.
  const preview=copied.preview;
  if(preview!==root){
   root.layoutMode="NONE";root.resize(preview.width,preview.height);root.clipsContent=true;preview.x=0;preview.y=0;
   for(const child of [...root.children])if(child!==preview){figma.currentPage.appendChild(child);child.x=root.x+root.width+96;child.y=root.y;externals.push(child);}
  }
  mark(root);for(const node of externals)mark(node);
  root.name=input.name;
  const sourceEnd=root.timelines[0]?.duration??0;
  const hasNativeMotion=preview.findAll(n=>Object.keys(n.manualKeyframeTracks??{}).length>0||(n.animationStyles?.length??0)>0).length>0;
  // Native export includes its endpoint frame; a 96-frame/24fps programme
  // therefore has native timeline end95/24 and encoded display duration4.
  const end=Math.max((motion.spec.frameCount-1)/fps,hasNativeMotion?sourceEnd:0,1e-6);
  const finish=async()=>{
   check();if(pending||next!==motion.spec.frameCount)throw Error("Receive every animation frame before finishing");
   const timeline=root.timelines[0];if(!timeline)throw Error("Native Motion timeline is unavailable");
   root.setTimelineDuration(timeline.id,end);
   root.setSharedPluginData("worldbend",SCENE_ANIMATION_KEY,JSON.stringify({schema:"worldbend.figma.scene-animation",version:"0.1",resultNodeId:originalPrimary.id,frameCount:next,fps,posterFrame:motion.frame,timelineEnd:end,frameGeometry:leafPlacement(originalPrimary),frameAppearance:leafAppearance(originalPrimary),wrapperIds:wrappers.map(n=>n.id)}));
   for(const node of [root,...externals])node.setPluginData("sceneDraft","0");
   committed=true;return {root,result:originalPrimary,reference:copied.reference,sourceAreas:externals,fps,end};
  };
  const receive=async(index:number,bytes:Uint8Array)=>{
   check();if(pending||index!==next||index>=motion.spec.frameCount)throw Error("Animation frames must arrive once in order");
   if(!bytes.length||bytes.length>MAX_BYTES-totalBytes)throw Error("Scene animation image bytes exceed the 64 MiB staging limit");
   pending=true;
   try{
    const image=figma.createImage(bytes);const size=await image.getSizeAsync();check();
    if(size.width!==input.renderWidth||size.height!==input.renderHeight)throw Error("Scene animation frame dimensions changed");
    const leaf=index===motion.frame?originalPrimary:originalPrimary.clone();
    if(leaf!==originalPrimary){leaf.setRelaunchData({});for(const key of ["binding","task","transform","canvas","native","nativeVector","effectDraft","mockupDraft","rasterPaint"])leaf.setSharedPluginData("worldbend",key,"");}
    const wrapper=figma.createFrame();wrapper.name=`Animation frame ${index+1}`;wrapper.fills=[];wrapper.clipsContent=false;wrapper.blendMode="PASS_THROUGH";wrapper.resize(parent.width,parent.height);
    parent.insertChild(insertion+index,wrapper);if(parent.layoutMode!=="NONE")wrapper.layoutPositioning="ABSOLUTE";wrapper.x=0;wrapper.y=0;wrapper.opacity=index===motion.frame?1:0;
    wrapper.appendChild(leaf);leaf.resize(primaryWidth,primaryHeight);leaf.relativeTransform=transform;
    leaf.fills=[{type:"IMAGE",imageHash:image.hash,scaleMode:"FILL"}];writeRasterPaintProof(leaf);
    wrapper.applyManualKeyframeTrack({type:"PROPERTY",name:"OPACITY"},sceneFrameVisibility(index,motion.spec.frameCount,fps,end,index===motion.frame?1:0));
    wrapper.setSharedPluginData("worldbend",FRAME_KEY,JSON.stringify({index,resultNodeId:leaf.id}));
    wrappers.push(wrapper);input.track(wrapper);input.track(leaf);totalBytes+=bytes.length;next++;
   }catch(error){retire();throw error;}finally{pending=false;}
  };
  return {root,receive,finish,cancel:retire,get committed(){return committed;},sourceSnapshot:()=>nativeNodeSnapshot(originalRoot)};
 }catch(error){retire();throw error;}
}
