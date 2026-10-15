import { createLinkedArtifact, type LinkedCreationInput } from "./agent-linked-creation";
import { readLinkedResult } from "./agent-linked-results";
import { workOperationSupports, dynamicCanvas } from "./agent-work-operation";
import { isStoredOperation, type StoredOperation } from "./stored-operation";
import { isFigmaImageAxis } from "./stored-plane";
import { sourceRasterViewBox } from "./source-raster";

export interface AgentWorkCreateInput extends LinkedCreationInput {
  operation: StoredOperation;
  renderWidth?: number;
  renderHeight?: number;
}

/** Closed authoring operations retain the same source bindings and reopen
 * controls as human-created raster work. Geometry is validated in the core
 * packet preparer; this carrier guards native state and publication status. */
export async function createWork(input: AgentWorkCreateInput) {
  if (!isStoredOperation(input.operation) ||
    !Array.isArray(input.sourceNodeIds) || input.sourceNodeIds.length < 1 || input.sourceNodeIds.length > 8 ||
    new Set(input.sourceNodeIds).size !== input.sourceNodeIds.length ||
    !input.sourceNodeIds.every(id => typeof id === "string" && id.length > 0 && id.length <= 256) ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(input.requestId) ||
    (input.name !== undefined && (!input.name.trim() || Array.from(input.name).length > 80))) throw Error("E_FIGMA_INPUT: invalid work creation");
  const operation = input.operation, count = input.sourceNodeIds.length;
  const width=input.renderWidth,height=input.renderHeight;
  const implicit=width===undefined && height===undefined && dynamicCanvas(operation) && count===1;
  if (!implicit && !(typeof width==="number" && typeof height==="number" && workOperationSupports(operation,count,width,height))) {
    throw Error("E_FIGMA_INPUT: use matching source slots and a supported raster operation");
  }
  const size=implicit ? async()=>{
    const source=await figma.getNodeByIdAsync(input.sourceNodeIds[0]!);
    const box=source && source.type!=="PAGE" && source.type!=="DOCUMENT" ? sourceRasterViewBox(source as SceneNode) : undefined;
    if(!box) throw Error("E_FIGMA_INPUT: Canvas source requires visible raster bounds");
    const size={width:Math.ceil(box.width),height:Math.ceil(box.height)};
    if(!workOperationSupports(operation,count,size.width,size.height)) throw Error("E_FIGMA_INPUT: invalid provisional Canvas size");
    return size;
  } : {width:width!,height:height!};
  return createLinkedArtifact(input,operation,size,
    {key:"workCreation",identity:JSON.stringify(input),schema:"worldbend.figma.work-creation",
      inspect: result => readLinkedResult(input.fileKey,input.pageId,result.id)});
}
