import { statePage, workState, workScope, type WorkScope, type WorkPage } from "./agent-work-state";
import { effectSourceGraph, exportBoundSources, mockupSources } from "./agent-handoff";
import { dynamicCanvas, workOperationSupports } from "./agent-work-operation";
import { figmaError } from "./state-fingerprint";

/** This read has no proposal fields. Its operation and source order are always
 * the published controls. Current media remains separately acquired, so a
 * changed source can be recomputed without claiming the old pixels are current. */
export async function readWorkContinuation(input: WorkScope & WorkPage & {
  includeSourceRasters?: boolean; sourceRasterTransport?: "inline" | "artifact";
}) {
  const capture = async () => {
    const base = await workState(input, "report");
    if (!base.published) throw figmaError("STATE", "finish core publication before continuing this work");
    if (!base.imageIntact) throw figmaError("STATE", "preserve the edited image; restore its published fill before continuing");
    if (!workOperationSupports(base.operation, base.sourceNodeIds.length, base.renderWidth, base.renderHeight)) {
      throw figmaError("STATE", "published work has unsupported controls or bindings");
    }
    const graph = await effectSourceGraph(base.sourceNodeIds, input.fileKey, input.pageId, input.nodeId, 1);
    const sources = await mockupSources(base.sourceNodeIds, input.pageId,
      dynamicCanvas(base.operation) ? "native" : {width:base.renderWidth,height:base.renderHeight});
    graph(); await workState({...input,revision:base.revision,targetExpected:base.targetExpected}, "report"); graph();
    return {data:{schema:"worldbend.figma.work-continuation-snapshot" as const,version:"0.1" as const,
      fileKey:base.fileKey,pageId:base.pageId,nodeId:base.nodeId,revision:base.revision,
      targetExpected:base.targetExpected,operation:base.operation,sourceNodeIds:base.sourceNodeIds,sources,
      renderWidth:base.renderWidth,renderHeight:base.renderHeight,placement:base.placement,
      sourceGraphExpected:graph.fingerprint,
      draftStatus:base.draftIssue ? "unusable" as const : base.pendingDraft ? "pending" as const : "absent" as const},graph};
  };
  const {data,graph} = await capture();
  const part = statePage(data,input);
  if (!input.includeSourceRasters) return part;
  const sourceRasters = await exportBoundSources(input.nodeId,input.pageId,data.renderWidth,data.renderHeight,
    input.sourceRasterTransport,{sources:data.sources,validate(){workScope(input);graph();}},data.sourceNodeIds,
    dynamicCanvas(data.operation) ? "native" : undefined);
  const fresh = await capture();
  if (statePage(fresh.data,{}).token !== part.token) throw figmaError("CONFLICT", "work changed during continuation export; reread");
  return {...part,sourceRasters};
}
