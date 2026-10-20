import {authorMockupMotion,planMockupMotion,type MockupMotionEdit,type MockupMotionPlan} from "@worldbend/web";
import type {MockupMotionPresentation} from "@worldbend/web/types";
import {sameJsonValue} from "./json-value";
import {continuedCompositionTask,type FigmaCompositionTask} from "./stored-designer-task";
export type MotionComposition=Extract<FigmaCompositionTask,{kind:"composition"}>;

export function compositionMotionPresentation(task:MotionComposition):MockupMotionPresentation {
  const stage=task.template.operation.postprocess.stages[0];
  if(stage?.kind!=="transform"||stage.canvas!=="reference"||!stage.target_size)throw Error("Composition framing is unavailable");
  return {transform:stage.spec,size:stage.target_size,output:task.template.output,outputId:task.previewOutputId} as MockupMotionPresentation;
}

export async function startCompositionMotion(task:FigmaCompositionTask,seconds=4):Promise<MotionComposition> {
  const complete=task.kind==="composition"?structuredClone(task):continuedCompositionTask(task.spec) as MotionComposition;
  if(complete.motion)return complete;
  const state=await authorMockupMotion({action:"create",scene:complete.template.operation.composition,timebase:{numerator:24,denominator:1},frameCount:Math.round(seconds*24)});
  const next=await authorMockupMotion({action:"revise",spec:state.spec,expectedFingerprint:state.fingerprint,edit:{kind:"setPresentation",presentation:compositionMotionPresentation(complete)}});
  return {...complete,motion:{spec:next.spec,frame:0}};
}
export async function poseComposition(task:MotionComposition,frame:number,prepared?:MockupMotionPlan):Promise<MotionComposition> {
  if(!task.motion)throw Error("Enable animation first");
  const plan=prepared??await planMockupMotion(task.motion.spec),scene=plan.frameSpecs[frame];
  if(!scene)throw Error("Choose a frame inside the animation");
  const presentation=plan.presentationFrames?.[frame]??plan.presentation;
  const postprocess=presentation?{...task.template.operation.postprocess,stages:task.template.operation.postprocess.stages.map((stage,index)=>index===0&&stage.kind==="transform"?{...stage,spec:presentation.spec.transform}:stage) as typeof task.template.operation.postprocess.stages}:task.template.operation.postprocess;
  return {...task,motion:{spec:task.motion.spec,frame},template:{...task.template,operation:{...task.template.operation,composition:scene,postprocess}}};
}
export async function synchronizeCompositionMotion(task:MotionComposition):Promise<MotionComposition> {
  if(!task.motion)return task;
  let current=task;
  const presentation=compositionMotionPresentation(task);
  const plan=await planMockupMotion(task.motion.spec),sampledPresentation=plan.presentationFrames?.[task.motion.frame]??plan.presentation;
  const sampledSpec=sampledPresentation?(({keyframes:_keys,...rest})=>rest)(sampledPresentation.spec):undefined;
  if(!sameJsonValue(sampledSpec,presentation)){
    const state=await authorMockupMotion({action:"inspect",spec:task.motion.spec});
    const next=await authorMockupMotion({action:"revise",spec:state.spec,expectedFingerprint:state.fingerprint,edit:{kind:"setPresentationAtFrame",frame:task.motion.frame,presentation}});
    current={...task,motion:{spec:next.spec,frame:task.motion.frame}};
  }
  const sampled=await poseComposition(current,current.motion!.frame);
  if(sameJsonValue(sampled.template.operation.composition,current.template.operation.composition))return current;
  const state=await authorMockupMotion({action:"inspect",spec:current.motion!.spec});
  const next=await authorMockupMotion({action:"revise",spec:state.spec,expectedFingerprint:state.fingerprint,edit:{kind:"setScenePose",frame:current.motion!.frame,scene:current.template.operation.composition}});
  return poseComposition({...current,motion:{spec:next.spec,frame:current.motion!.frame}},current.motion!.frame);
}
export async function reviseCompositionMotion(task:MotionComposition,edit:MockupMotionEdit):Promise<MotionComposition> {
  const current=await synchronizeCompositionMotion(task);
  if(!current.motion)throw Error("Enable animation first");
  const state=await authorMockupMotion({action:"inspect",spec:current.motion.spec});
  const next=await authorMockupMotion({action:"revise",spec:state.spec,expectedFingerprint:state.fingerprint,edit});
  const frame=edit.kind==="retime"?Math.round(current.motion.frame*(next.spec.frameCount-1)/Math.max(1,current.motion.spec.frameCount-1)):Math.min(current.motion.frame,next.spec.frameCount-1);
  return poseComposition({...current,motion:{spec:next.spec,frame}},frame);
}
