import { NATIVE_SCENE_KEY, NATIVE_SCENE_TEMPLATE_KEY, parseNativeSceneReference, parseNativeSceneTemplateMarker } from "./native-scene-model";
import { readResultBinding } from "./stored-binding";
import { sameJsonValue } from "./json-value";
import type { FigmaCompositionTask } from "./stored-designer-task";
import type { TemplateSummary } from "./template-library-summary";
import { spatialTemplateFromCompositionTask, templateAppearance, templateSlotName } from "./stored-template-library";

const MAX_NODES = 20000;
const MAX_SCENES = 64;
const MAX_DEPTH = 64;
type Issue = { nodeId: string; reason: "page-unavailable" | "invalid-scene" | "invalid-task" | "missing-content" | "invalid-binding" };

function within(node: BaseNode, root: BaseNode): boolean {
  for (let current: BaseNode | null = node; current; current = current.parent) if (current.id === root.id) return true;
  return false;
}

/** Read shared file data outside findAll predicates: external Figma providers
 * may evaluate those predicates without the plugin metadata. Never changes
 * pages, selection or document nodes; unreadable/limited scans stay explicit. */
export async function discoverFileNativeTemplates(readTask: (result: RectangleNode) => FigmaCompositionTask | undefined) {
  const templates: TemplateSummary[] = [];
  const issues: Issue[] = [];
  const pageIds: string[] = [];
  let issueCount = 0, visitedNodes = 0, complete = true;
  const issue = (nodeId: string, reason: Issue["reason"]) => {
    issueCount += 1;
    if (issues.length < 32) issues.push({ nodeId, reason });
  };
  for (const pageReference of figma.root.children) {
    if (visitedNodes >= MAX_NODES || templates.length >= MAX_SCENES) { complete = false; break; }
    // Root/page child references can be shallow in the external provider even
    // though children/getSharedPluginData are exposed. Resolve containers
    // explicitly before treating their inventory as complete.
    let page: BaseNode | null;
    try { page = await figma.getNodeByIdAsync(pageReference.id); }
    catch { complete = false; issue(pageReference.id, "page-unavailable"); continue; }
    if (page?.type !== "PAGE") { complete = false; issue(pageReference.id, "page-unavailable"); continue; }
    let children: readonly SceneNode[];
    try { children = page.children; }
    catch {
      try { await page.loadAsync(); children = page.children; }
      catch { complete = false; issue(page.id, "page-unavailable"); continue; }
    }
    pageIds.push(page.id);
    const stack: Array<{ children: readonly SceneNode[]; index: number }> = [{ children, index: 0 }];
    while (stack.length) {
      const current = stack[stack.length - 1]!;
      if (current.index >= current.children.length) { stack.pop(); continue; }
      if (visitedNodes >= MAX_NODES || templates.length >= MAX_SCENES) { complete = false; break; }
      const reference = current.children[current.index++]!;
      visitedNodes += 1;
      let node: BaseNode | null = reference;
      try { if ("children" in reference) node = await figma.getNodeByIdAsync(reference.id); }
      catch { complete = false; issue(reference.id, "missing-content"); continue; }
      if (!node || !("visible" in node)) continue;
      if (node.type === "FRAME") {
        const raw = node.getSharedPluginData("worldbend", NATIVE_SCENE_TEMPLATE_KEY);
        if (raw) {
          const marker = parseNativeSceneTemplateMarker(raw);
          const scene = parseNativeSceneReference(node.getSharedPluginData("worldbend", NATIVE_SCENE_KEY));
          if (!marker || !scene || scene.rootNodeId !== node.id) issue(node.id, "invalid-scene");
          else {
            const [result, preview, ...sources] = await Promise.all([scene.resultNodeId, scene.previewNodeId,
              ...scene.sourceNodeIds].map(async id => { try { return await figma.getNodeByIdAsync(id); } catch { return null; } }));
            if (result?.type !== "RECTANGLE" || preview?.type !== "FRAME" || !within(result, preview) ||
              !within(preview, node) || !sources.every(source => source && within(source, node))) issue(node.id, "missing-content");
            else {
              const binding = readResultBinding(result);
              const task = readTask(result);
              if (!binding || !sameJsonValue(binding.sourceNodeIds, scene.sourceNodeIds)) issue(node.id, "invalid-binding");
              else if (!task) issue(node.id, "invalid-task");
              else {
                const slots = scene.replaceSourceNodeIds.map(id => sources.find(source => source?.id === id));
                if (!slots.every((slot): slot is SceneNode => slot !== undefined && slot !== null &&
                  "width" in slot && "height" in slot && Number.isFinite(slot.width) && Number.isFinite(slot.height) &&
                  slot.width > 0 && slot.height > 0)) issue(node.id, "missing-content");
                else templates.push({ ...marker, kind: task.kind === "mockup" ? "mockup" : "compositionProgram",
                  sourceCount: slots.length, nativeScene: scene, pageId: page.id,
                  slots: slots.map(slot => ({ name: templateSlotName(slot.name),
                    width: Math.ceil(slot.width), height: Math.ceil(slot.height) })),
                  appearance: templateAppearance(spatialTemplateFromCompositionTask(task)) });
              }
            }
          }
        }
      }
      if ("children" in node && node.children.length) {
        if (stack.length >= MAX_DEPTH) complete = false;
        else stack.push({ children: node.children, index: 0 });
      }
    }
  }
  return { templates, scan: { pageIds, visitedNodes, complete, issueCount, issues } };
}
