import { inspectEffect } from "./agent-handoff";
import { createLinkedArtifact, type LinkedCreationInput } from "./agent-linked-creation";
import { isFigmaSpatialEffectTask, type FigmaSpatialEffectTask } from "./stored-designer-task";

export interface AgentEffectCreateInput extends LinkedCreationInput { task: FigmaSpatialEffectTask }

/** Create linked Depth state; ordinary source export and core publication
 * finish the image. The shared creator owns atomic retry and recovery. */
export async function createEffect(input: AgentEffectCreateInput) {
  if (!isFigmaSpatialEffectTask(input.task) || input.sourceNodeIds.length !== input.task.recipe.layers.length ||
    new Set(input.sourceNodeIds).size !== input.sourceNodeIds.length ||
    !input.sourceNodeIds.every(id => typeof id === "string" && id.length > 0 && id.length <= 256) ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(input.requestId) ||
    (input.name !== undefined && (!input.name.trim() || Array.from(input.name).length > 80))) {
    throw Error("E_FIGMA_INPUT: choose matching distinct Depth sources, a supported task and a bounded creation identity");
  }
  return createLinkedArtifact(input, {kind:"task",task:input.task}, input.task.recipe.viewport,
    {key:"effectCreation",identity:JSON.stringify(input),schema:"worldbend.figma.effect-creation",defaultName:"Depth · Worldbend",
      inspect: result => inspectEffect(result.id,input.fileKey,input.pageId)});
}
