import { appearancePreviewContext } from "./appearance";
import { applyMaterialEdit, applyMaterialEditAsync } from "./material-edit";
import { withTimeout } from "./async-timeout";
import { isSceneDraftNode, type SceneDraftPayload } from "./scene-draft";
import type { UiToMainMessage } from "./messages";

export type MaterialTrialRequest = Extract<
  UiToMainMessage,
  { type: "request-material-trial" | "request-material-preview" | "request-scene-context" }
>;

/** Native scene capture. An opaque page permits locked in-place feedback;
 * transparent pages use the window preview to avoid double compositing.
 * Capture intersecting real roots, preserving their native
 * hierarchy, masks, layout, effects, transforms and foreground order. */
export function createMaterialTrial(input: {
  current(request: MaterialTrialRequest): readonly SceneNode[] | undefined;
  sessionId(): string;
  track(id: string): void;
  observe(id: string, node?: SceneNode): void;
  clear(): void;
  present(request: MaterialTrialRequest, frames: SceneDraftPayload[]): boolean;
  post(
    request: MaterialTrialRequest,
    ok: boolean,
    frames?: SceneDraftPayload[],
    canvas?: boolean,
  ): void;
}) {
  let queued: MaterialTrialRequest | undefined;
  let running = false;
  let revision = 0;
  let activeCopy: FrameNode | undefined;
  function clearCopy(): void {
    const copy = activeCopy;
    activeCopy = undefined;
    if (!copy || copy.removed) return;
    try {
      copy.setPluginData("sceneDraftRetired", "1");
    } catch {
      /* still remove only our copy */
    }
    copy.remove();
  }
  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (queued) {
        const request = queued,
          ownRevision = revision;
        queued = undefined;
        const selected = input.current(request);
        if (!selected?.length) {
          input.post(request, false);
          continue;
        }
        const page = figma.currentPage;
        input.observe(page.id);
        const frames: SceneDraftPayload[] = [];
        let ok = false;
        let canvas = false;
        try {
          const regions = mergeRegions(
            selected.map((n) => renderBounds(appearancePreviewContext(n))),
          );
          if (!regions.length) throw new Error("No visible scene");
          const roots = renderRoots(page.children);
          const pixelScale = Math.sqrt(
            4194304 /
              regions.reduce((area, box) => area + box.width * box.height, 0),
          );
          for (const box of regions) {
            if (ownRevision !== revision || !input.current(request)) break;
            const capture = figma.createFrame();
            activeCopy = capture;
            capture.setPluginData("sceneDraft", "1");
            capture.setPluginData("sceneDraftSession", input.sessionId());
            capture.setPluginData("sceneDraftRetired", "0");
            input.track(capture.id);
            capture.name = "Worldbend material capture";
            capture.x = 100000;
            capture.y = 100000;
            capture.resize(box.width, box.height);
            capture.clipsContent = true;
            capture.fills = [...page.backgrounds];
            const mapped = new Map<string, SceneNode>();
            for (const root of roots) {
              const bounds = renderBounds(root);
              if (!bounds || !intersects(box, bounds)) continue;
              input.observe(root.id, root);
              const transform = root.absoluteTransform;
              const copy = copyRoot(root, mapped, input.track);
              capture.appendChild(copy);
              const pendingModes=preserveRootModes(root,copy,()=>{
                if(ownRevision!==revision || !input.current(request))throw Error('Trial context changed');
              });if(pendingModes)await pendingModes;
              if(ownRevision!==revision || !input.current(request))throw Error("Trial context changed");
              copy.relativeTransform = [
                [transform[0][0], transform[0][1], transform[0][2] - box.x],
                [transform[1][0], transform[1][1], transform[1][2] - box.y],
              ];
            }
            const targets = selected.flatMap((n) =>
              mapped.has(n.id) ? [mapped.get(n.id)!] : [],
            );
            if (request.type === "request-material-trial") {
              const applied = request.edit.family==='foil'?await applyMaterialEditAsync(targets, request.edit,undefined,()=>{
                if(ownRevision!==revision || !input.current(request))throw Error('Trial context changed');
              }):applyMaterialEdit(targets,request.edit);
              if(ownRevision!==revision || !input.current(request))throw Error('Trial context changed');
              if (
                !applied.ok ||
                !applied.outcomes.some((o) => o.outcome === "applied" || o.outcome === "removed")
              )
                throw new Error("Trial unavailable");
            } else if (request.type === "request-scene-context") {
              if (targets.length !== 1 || targets[0]?.type !== "RECTANGLE") throw new Error("Scene result unavailable");
              const image = figma.createImage(request.bytes);
              targets[0].fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" }];
              await withTimeout((async () => {
                const size = await image.getSizeAsync();
                if (![size.width, size.height].every(axis => Number.isSafeInteger(axis) && axis > 0 && axis <= 4096)) throw new Error("Scene raster exceeds image limits");
                await image.getBytesAsync();
                if (ownRevision !== revision || !input.current(request)) return;
                // Prime the fresh image before capturing its surroundings:
                // whole-frame export can otherwise omit it in the real host.
                await targets[0]!.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: Math.min(1, 320 / targets[0]!.width, 320 / targets[0]!.height) } });
              })(), 10000, () => new Error("Scene raster timed out"));
              if (ownRevision !== revision || !input.current(request)) break;
            }
            const scale = Math.min(
              pixelScale,
              Math.max(1, figma.viewport.zoom * 2),
              4096 / Math.max(box.width, box.height),
            );
            const bytes = await withTimeout(
              capture.exportAsync({
                format: "PNG",
                useAbsoluteBounds: true,
                constraint: { type: "SCALE", value: scale },
              }),
              10000,
              () => new Error("Trial timed out"),
            );
            frames.push({
              generation: request.generation,
              bytes,
              placement: box,
              renderWidth: Math.max(1, Math.round(box.width * scale)),
              renderHeight: Math.max(1, Math.round(box.height * scale)),
            });
            clearCopy();
          }
          if (
            ownRevision === revision &&
            input.current(request) &&
            frames.length === regions.length
          ) {
            const opaque = page.backgrounds.some(
              (p) =>
                p.type === "SOLID" &&
                p.visible !== false &&
                (p.opacity ?? 1) === 1 &&
                (p.blendMode ?? "NORMAL") === "NORMAL",
            );
            ok =
              request.type === "request-material-preview" ||
              (request.type === "request-scene-context" && !request.showCanvas) ||
              !opaque ||
              (canvas = input.present(request, frames));
          }
        } catch {
          /* Keep original artwork and allow retry. */
        } finally {
          clearCopy();
        }
        if (ownRevision === revision) {
          if (request.type === "request-material-preview")
            input.post(request, ok, ok ? frames : undefined);
          else input.post(request, ok, ok ? frames : undefined, canvas);
        }
      }
    } finally {
      running = false;
    }
  }
  return {
    request(request: MaterialTrialRequest) {
      revision += 1;
      queued = request;
      input.clear();
      clearCopy();
      void drain();
    },
    cancel() {
      revision += 1;
      queued = undefined;
      clearCopy();
      input.clear();
    },
  };
}

function renderRoots(nodes: readonly SceneNode[]): SceneNode[] {
  return nodes.flatMap((node) =>
    node.removed || !node.visible || isSceneDraftNode(node) ? [] : [node],
  );
}
function copyRoot(
  source: SceneNode,
  map: Map<string, SceneNode>,
  track: (id: string) => void,
): SceneNode {
  if (source.type !== "SECTION") {
    const copy = source.clone();
    mapCopies(source, copy, map, track);
    return copy;
  }
  // Figma sections cannot be nested in a capture frame. Preserve their native
  // paints and child ordering in a plain frame, without clipping the contents.
  const copy = figma.createFrame();
  track(copy.id);
  map.set(source.id, copy);
  copy.resize(source.width, source.height);
  copy.clipsContent = false;
  copy.fills = source.fills;
  copy.strokes = source.strokes;
  if (typeof source.strokeWeight === "number")
    copy.strokeWeight = source.strokeWeight;
  copy.strokeAlign = source.strokeAlign;
  copy.dashPattern = source.dashPattern;
  copy.topLeftRadius = source.topLeftRadius;
  copy.topRightRadius = source.topRightRadius;
  copy.bottomLeftRadius = source.bottomLeftRadius;
  copy.bottomRightRadius = source.bottomRightRadius;
  if (!source.sectionContentsHidden)
    for (const child of source.children) {
      const next = copyRoot(child, map, track);
      copy.appendChild(next);
      next.relativeTransform = child.relativeTransform;
    }
  return copy;
}
function renderBounds(node: SceneNode): Rect | null {
  return (
    ("absoluteRenderBounds" in node ? node.absoluteRenderBounds : null) ??
    node.absoluteBoundingBox
  );
}
function mapCopies(
  source: SceneNode,
  copy: SceneNode,
  map: Map<string, SceneNode>,
  track: (id: string) => void,
): void {
  map.set(source.id, copy);
  track(copy.id);
  if ("children" in source && "children" in copy)
    source.children.forEach((child, index) => {
      const next = copy.children[index];
      if (next) mapCopies(child, next, map, track);
    });
}
function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}
function mergeRegions(boxes: (Rect | null)[]): Rect[] {
  const result: Rect[] = [];
  for (const box of boxes) {
    if (!box || box.width <= 0 || box.height <= 0) continue;
    let region = { ...box };
    for (let i = 0; i < result.length; ) {
      const other = result[i]!;
      if (!intersects(region, other)) {
        i += 1;
        continue;
      }
      const x = Math.min(region.x, other.x),
        y = Math.min(region.y, other.y);
      region = {
        x,
        y,
        width: Math.max(region.x + region.width, other.x + other.width) - x,
        height: Math.max(region.y + region.height, other.y + other.height) - y,
      };
      result.splice(i, 1);
      i = 0;
    }
    result.push(region);
  }
  return result;
}

/** Moving a root into the temporary capture must retain inherited variable
 * modes; otherwise its Shader colors can change only in the preview. */
function preserveRootModes(source:SceneNode,copy:SceneNode,assertCurrent:()=>void):Promise<void>|undefined {
  if(!('resolvedVariableModes' in source)||!('setExplicitVariableModeForCollection' in copy))return;
  const modes=Object.entries(source.resolvedVariableModes);if(!modes.length)return;
  return (async()=>{for(const [id,mode] of modes) {
    const collection=await figma.variables.getVariableCollectionByIdAsync(id);
    assertCurrent();
    if(!collection||copy.removed)throw Error('Material variable mode unavailable');
    copy.setExplicitVariableModeForCollection(collection,mode);
  }})();
}
