import type { DeformationWorkSpecInput, ShapeFitDomain } from "@worldbend/web";
import { sameJsonValue } from "./json-value";
import { normalizedDocumentShape, type DocumentShape } from "./native-shape";
import type { LoadedDesignerSource } from "./designer-workspace-common";
import { deformationWorkFromMesh } from "./deformation-work-state";
import { createMeshSpec } from "./mesh-workspace";
import { planDeformationWork, shapeFitDomains, refreshShapeFit } from "./designer-plan";
import { deformationTask, type FigmaDeformationTask } from "./stored-designer-task";

export function nativeShapeFitGuide(sources: readonly LoadedDesignerSource[], selected?: 0 | 1): 0 | 1 | undefined {
  if (sources.length!==2) return undefined;
  if (selected!==undefined && sources[selected]?.shapeGuide) return selected;
  const guides=sources.flatMap((source,index)=>source.shapeGuide && !source.quadGuide ? [index as 0|1] : []);
  if (guides.length===1) return guides[0];
  return sources[1]?.shapeGuide ? 1 : sources[0]?.shapeGuide ? 0 : undefined;
}

export async function prepareNativeShapeFit(sources:readonly LoadedDesignerSource[], domainIndex=0, base?:DeformationWorkSpecInput, selectedGuide?:0|1):Promise<{
  task:FigmaDeformationTask;domains:ShapeFitDomain[];
}> {
  const guideIndex=nativeShapeFitGuide(sources,selectedGuide);
  const guide=guideIndex===undefined ? undefined : sources[guideIndex]?.shapeGuide;
  if (!guide || guideIndex===undefined) throw new Error("Select artwork and one closed native shape");
  const clip=normalizedDocumentShape(guide),domains=await shapeFitDomains(clip);
  const domain=domains[domainIndex];
  if (!domain) throw new Error("This shape has no fitting domain");
  const scale=Math.min(1,4096/Math.max(guide.bounds.width,guide.bounds.height));
  const width=Math.max(1,Math.round(guide.bounds.width*scale)),height=Math.max(1,Math.round(guide.bounds.height*scale));
  const work:DeformationWorkSpecInput=base ? {...structuredClone(base),targetSize:{width,height}} : deformationWorkFromMesh(createMeshSpec(width,height,4));
  work.shapeFit={contour:structuredClone(domain.contour),clip,...(base?.shapeFit?.cornerPositions ? {cornerPositions:structuredClone(base.shapeFit.cornerPositions)} : {}),...(base?.shapeFit?.refinement ? {refinement:base.shapeFit.refinement} : {})};
  await planDeformationWork(work);
  return {task:deformationTask(work,"mesh",guideIndex,{kind:domain.kind,...(domain.contourIndex === undefined ? {} : {contourIndex:domain.contourIndex})}),domains};
}

/** Refresh geometry only: output size and all authored interior edits survive. */
export async function refreshNativeShapeFit(task:FigmaDeformationTask,guide:DocumentShape|undefined,base=task.spec):Promise<FigmaDeformationTask> {
  if(task.shapeGuideSourceIndex === undefined) return task;
  if(!guide || !base.shapeFit) throw Error("The bound native shape is unavailable; select artwork and a closed shape again");
  const clip=normalizedDocumentShape(guide);
  if(sameJsonValue(base.shapeFit.clip,clip)) return {...task,spec:base};
  const refreshed=await refreshShapeFit({shapeFit:base.shapeFit,clip,...(task.shapeGuideDomain ? {domain:task.shapeGuideDomain} : {})});
  const work={...structuredClone(base),shapeFit:refreshed.shapeFit};
  await planDeformationWork(work);
  return {...task,spec:work,shapeGuideDomain:refreshed.domain};
}
