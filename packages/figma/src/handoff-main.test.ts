import { afterEach, describe, expect, it, vi } from "vitest";
import { readStoredBinding, writeStoredBinding } from "./stored-binding";
import { readStoredOperation, writeStoredOperation } from "./stored-operation";
import { publishNativeResult, nativeDocumentParts, restoreNativeProjection } from "./native-document";
import { createMeshSpec } from "./mesh-workspace";

const spec = {
  schema: "worldbend.transform" as const, version: "0.1" as const,
  destination: { space: "normalized" as const, quad: {
    tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 },
  } }, content: { fit: "stretch" as const },
};
const renderer = { id: `sampler/${"a".repeat(40)}`, propertyIds: Array.from({ length: 9 }, (_, i) => String(i)), extentPropertyIds: ["9", "10"] as [string, string] };

function host() {
  const registry = new Map<string, any>();
  const handlers = new Map<string, (...args: any[]) => void>();
  const pageHandlers = new Map<string, (...args: any[]) => void>();
  const posts: any[] = [];
  let nextId = 1;
  const page: any = { id: "page", type: "PAGE", parent: null, selection: [], children: [],
    appendChild: vi.fn((child: any) => { if (!page.children.includes(child)) page.children.push(child); }),
    on: (name: string, fn: (...args: any[]) => void) => pageHandlers.set(name, fn), off: vi.fn(),
    getSharedPluginData: () => JSON.stringify({ schema: "worldbend.figma.projective-sampler", version: "0.1", id: renderer.id }),
  };
  function frame(): any {
    const shared = new Map<string, string>();
    const privateData = new Map<string, string>();
    const node: any = {
      id: `node-${nextId++}`, type: "FRAME", name: "Card", visible: true,
      width: 520, height: 606, x: 0, y: 0, parent: page, children: [], fills: [], effects: [], clipsContent: true,
      constraints: { horizontal: "MIN", vertical: "MIN" }, layoutMode: "NONE",
      relativeTransform: [[1, 0, 0], [0, 1, 0]], absoluteTransform: [[1, 0, 0], [0, 1, 0]],
      get absoluteBoundingBox() { return { x: node.x, y: node.y, width: node.width, height: node.height }; },
      resize: vi.fn((width: number, height: number) => {
        // Figma applies child constraints recursively. A width/height-only
        // stub concealed mutations of the supposedly untouched Content.
        for (const child of node.children) {
          for (const [axis, position, constraint] of [["width", "x", "horizontal"], ["height", "y", "vertical"]] as const) {
            const next = axis === "width" ? width : height;
            if (child.constraints[constraint] === "CENTER") child[position] += (next - node[axis]) / 2;
            if (child.constraints[constraint] === "SCALE") {
              child[position] *= next / node[axis]; child[axis] *= next / node[axis];
            }
          }
        }
        node.width = width; node.height = height;
      }),
      resizeWithoutConstraints: vi.fn((width: number, height: number) => { node.width = width; node.height = height; }),
      getSharedPluginData: (ns: string, key: string) => shared.get(`${ns}:${key}`) ?? "",
      setSharedPluginData: vi.fn((ns: string, key: string, value: string) => { shared.set(`${ns}:${key}`, value); }),
      getPluginData: (key: string) => privateData.get(key) ?? "",
      setPluginData: (key: string, value: string) => privateData.set(key, value),
      setRelaunchData: vi.fn(),
      exportAsync: vi.fn(async () => new Uint8Array([1, 2, 3])),
      appendChild: (child: any) => {
        child.parent.children = child.parent.children.filter((n: any) => n !== child);
        child.parent = node; node.children.push(child);
      },
      remove: () => {
        for (const child of [...node.children]) child.remove();
        node.parent.children = node.parent.children.filter((n: any) => n !== node);
        registry.delete(node.id);
      },
      clone: () => {
        const copy = frame(); copy.name = node.name; copy.resize(node.width, node.height);
        for (const [qualified, value] of shared) {
          const split = qualified.indexOf(":");
          copy.setSharedPluginData(qualified.slice(0, split), qualified.slice(split + 1), value);
        }
        for (const [key, value] of privateData) copy.setPluginData(key, value);
        copy.fills = structuredClone(node.fills); copy.effects = structuredClone(node.effects);
        copy.constraints = { ...node.constraints };
        for (const child of node.children) copy.appendChild(child.clone());
        return copy;
      },
    };
    registry.set(node.id, node); page.children.push(node); return node;
  }
  const source = frame(); source.name = "Editable source";
  page.selection = [source];
  const api = {
    currentPage: page, fileKey: "granted-file", mixed: Symbol("mixed"),
    on: (name: string, fn: (...args: any[]) => void) => handlers.set(name, fn),
    showUI: vi.fn(), commitUndo: vi.fn(), triggerUndo: vi.fn(), notify: vi.fn(),
    clientStorage: { getAsync: vi.fn(async () => undefined) },
    viewport: { scrollAndZoomIntoView: vi.fn() },
    ui: { on: vi.fn(), onmessage: undefined as ((message: unknown) => void) | undefined, postMessage: (message: unknown) => posts.push(message) },
    getNodeByIdAsync: vi.fn(async (id: string) => registry.get(id) ?? null),
    createFrame: vi.fn(frame), createImage: vi.fn(() => ({ hash: "rendered" })),
    createRectangle: vi.fn(() => { const n = frame(); n.type = "RECTANGLE"; return n; }),
    importShaderById: vi.fn(async (id: string) => ({ id, type: "effect", propertyDefinitions:
      Object.fromEntries(["h00", "h01", "h02", "h10", "h11", "h12", "h20", "h21", "h22", "sourceRight", "sourceBottom"].map((name, i) => [String(i), { name, type: "NUMBER" }])),
    })),
  };
  vi.stubGlobal("figma", api); vi.stubGlobal("__html__", "");
  return { api, source, page, registry, posts, handlers, pageHandlers, frame };
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.useRealTimers(); });

describe("designer and Agent handoff", () => {
  it("distinguishes an empty canvas selection from an unsupported selection and recovers", async () => {
    vi.useFakeTimers();
    const h = host(); h.page.selection = [];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({ type: "selection-error", message: { key: "selectOneSource" } });
    h.page.selection = Array.from({ length: 10 }, () => h.frame()); h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(150);
    expect(h.posts.at(-1)).toMatchObject({ type: "selection-error", message: { key: "selectOneOrPair" } });
    expect(h.source.exportAsync).not.toHaveBeenCalled();
    h.page.selection = [h.source]; h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(150);
    expect(h.posts.findLast(p => p.type === "source")).toMatchObject({ payload: { sourceNodeId: h.source.id } });
  });

  it.each([false, true])("keeps the whole editing frame while selecting and changing its descendants (native result: %s)", async (native) => {
    vi.useFakeTimers();
    const h = host();
    const anchor = native ? await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    }) : h.source;
    const content = native ? (await nativeDocumentParts(anchor)).content : h.source;
    const text = h.frame(); text.type = "TEXT"; content.appendChild(text);
    text.x = 50; text.y = 90; text.width = 550; text.height = 114;
    h.page.selection = [anchor];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.advanceTimersByTimeAsync(0);
    const before = h.posts.length;
    h.page.selection = [text]; h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(150);
    expect(h.posts).toHaveLength(before);
    expect(text.exportAsync).not.toHaveBeenCalled();
    content.exportAsync.mockResolvedValue(new Uint8Array([8, 9]));
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: text.id, node: text }] });
    await vi.advanceTimersByTimeAsync(120);
    expect(h.posts.at(-1)).toMatchObject({ type: "source", generation: 2, payload: {
      sourceNodeId: content.id, bytes: new Uint8Array([8, 9]), ...(native ? { targetNodeId: anchor.id } : {}),
    } });
    h.api.ui.onmessage?.({ type: "apply", payload: {
      generation: 2, sourceNodeId: content.id, ...(native ? { targetNodeId: anchor.id, duplicate: true } : {}),
      spec, bytes: new Uint8Array([4]), renderWidth: 1040, renderHeight: 1212,
      placement: { x: 800, y: 0, width: 520, height: 606 },
    } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({ type: "apply-complete", operation: "apply" });
    expect(h.registry.get(h.posts.at(-1).targetNodeId).y).toBe(anchor.y);
    const outside = h.frame(); h.page.selection = [outside]; h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(120);
    expect(h.posts.at(-1)).toMatchObject({ type: "source", payload: { sourceNodeId: outside.id } });
  });

  it.each(["native", "raster"] as const)("reopens a %s result and supports update plus independent outputs of both types", async (kind) => {
    vi.useFakeTimers();
    const h = host();
    const original = { width: h.source.width, fills: structuredClone(h.source.fills) };
    const result = kind === "native" ? await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    }) : h.api.createRectangle();
    if (kind === "raster") {
      writeStoredOperation(result, { kind: "transform", spec });
      writeStoredBinding(result, { sourceNodeIds: [h.source.id], renderWidth: 1040, renderHeight: 1212 });
    }
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.advanceTimersByTimeAsync(0);
    const { payload, generation } = h.posts.findLast(p => p.type === "source");
    const nextSpec = structuredClone(spec); nextSpec.destination.quad.tl.x = .1;
    for (const [output, duplicate] of [[kind, false], ["native", true], ["raster", true]] as const) {
      const previous = readStoredBinding(result);
      h.api.ui.onmessage?.({ type: output === "native" ? "apply-native" : "apply", payload: {
        generation, sourceNodeId: payload.sourceNodeId, targetNodeId: result.id, spec: nextSpec,
        ...(duplicate ? { duplicate: true } : {}),
        ...(output === "native" ? { inverse: [1 / 1040, 0, 0, 0, 1 / 1212, 0, 0, 0, 1] } : { bytes: new Uint8Array([9]) }),
        renderWidth: 1040, renderHeight: 1212, placement: { x: 800, y: 0, width: 520, height: 606 },
      } });
      await vi.advanceTimersByTimeAsync(0);
      const complete = h.posts.at(-1);
      expect(complete).toMatchObject({ type: "apply-complete", operation: duplicate ? "apply" : "replace" });
      expect(complete.targetNodeId === result.id).toBe(!duplicate);
      const published = h.registry.get(complete.targetNodeId);
      expect(readStoredOperation(published)).toEqual({ status: "valid", operation: { kind: "transform", spec: nextSpec } });
      if (duplicate) expect(readStoredBinding(result)).toEqual(previous);
      if (output === "native" && duplicate) {
        expect((await nativeDocumentParts(published)).content.id).not.toBe(payload.sourceNodeId);
      } else if (output === "raster") {
        expect(readStoredBinding(published)?.sourceNodeIds).toEqual([payload.sourceNodeId]);
      }
    }
    expect(h.source.width).toBe(original.width); expect(h.source.fills).toEqual(original.fills);
  });

  it.each(["warp", "rectify"] as const)("publishes a %s raster beside an open native result", async (mode) => {
    vi.useFakeTimers(); const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    });
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.advanceTimersByTimeAsync(0);
    const { payload, generation } = h.posts.findLast(p => p.type === "source");
    expect(payload.nativeTarget).toBe(true);
    const rasterSpec = { ...spec, content: { ...spec.content, warp: { preset: "arc" as const, amount: 0.5 } } };
    const rectification = { schema: "worldbend.rectify" as const, version: "0.1" as const,
      source: { space: "normalized" as const, quad: spec.destination.quad }, output: { width: 1040, height: 1212 } };
    // The primary Apply in Warp/Correct mode is the HD route and carries the
    // native frame's targetNodeId without a duplicate flag.
    h.api.ui.onmessage?.({ type: "apply", payload: {
      generation, sourceNodeId: payload.sourceNodeId, targetNodeId: result.id,
      ...(mode === "warp" ? { spec: rasterSpec } : { rectification }),
      bytes: new Uint8Array([9]), renderWidth: 1040, renderHeight: 1212,
      placement: { x: 800, y: 0, width: 520, height: 606 },
    } });
    await vi.advanceTimersByTimeAsync(0);
    const complete = h.posts.at(-1);
    expect(complete).toMatchObject({ type: "apply-complete", operation: "apply" });
    expect(complete.targetNodeId).not.toBe(result.id);
    const published = h.registry.get(complete.targetNodeId);
    expect(published.type).toBe("RECTANGLE");
    expect(readStoredOperation(published)).toEqual({ status: "valid", operation: mode === "warp"
      ? { kind: "transform", spec: rasterSpec } : { kind: "rectify", spec: rectification } });
    expect(readStoredBinding(published)?.sourceNodeIds).toEqual([payload.sourceNodeId]);
    // The editable result keeps its projection instead of being overwritten.
    expect(result.type).toBe("FRAME");
    expect(await nativeDocumentParts(result)).toBeDefined();
    expect(h.api.viewport.scrollAndZoomIntoView).toHaveBeenCalledWith(
      expect.arrayContaining([published, result]),
    );
  });

  it("keeps the document-node live draft disabled after the host-history failure", async () => {
    vi.useFakeTimers(); const h = host();
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.advanceTimersByTimeAsync(0);
    const { generation } = h.posts.findLast(p => p.type === "source");
    h.api.ui.onmessage?.({ type: "scene-draft", generation, bytes: new Uint8Array([1]),
      renderWidth: 100, renderHeight: 80,
      placement: { x: 5, y: 6, width: 50, height: 40 } });

    expect(h.page.children.some((node: any) => node.getPluginData?.("sceneDraft") === "1")).toBe(false);
    expect(h.api.createRectangle).not.toHaveBeenCalled();
    expect(h.api.commitUndo).not.toHaveBeenCalled();
  });

  it("commits leftover draft removal during the plugin-start sweep", async () => {
    vi.useFakeTimers(); const h = host();
    const leftover = h.api.createRectangle();
    leftover.setPluginData("sceneDraft", "1");
    await import("./main");
    expect(h.page.children.some((node: any) => node.getPluginData?.("sceneDraft") === "1")).toBe(false);
    expect(h.page.children).toContain(h.source);
    expect(h.api.commitUndo).toHaveBeenCalledTimes(1);
    expect(h.api.triggerUndo).not.toHaveBeenCalled();
  });

  it("removes a legacy live canvas draft synchronously when the host closes the plugin", async () => {
    vi.useFakeTimers(); const h = host();
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.advanceTimersByTimeAsync(0);
    const legacyDraft = h.api.createRectangle();
    legacyDraft.setPluginData("sceneDraft", "1");
    expect(h.page.children.some((node: any) => node.getPluginData?.("sceneDraft") === "1")).toBe(true);

    h.handlers.get("close")?.();

    expect(h.page.children.some((node: any) => node.getPluginData?.("sceneDraft") === "1")).toBe(false);
    expect(h.api.commitUndo).toHaveBeenCalledTimes(1);
    expect(h.api.triggerUndo).not.toHaveBeenCalled();
  });

  it("rejects a tagged result with missing transform data instead of applying perspective to its pixels again", async () => {
    vi.useFakeTimers(); const h = host(); const result = h.api.createRectangle();
    writeStoredBinding(result, { sourceNodeIds: [h.source.id], renderWidth: 1040, renderHeight: 1212 });
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({ type: "selection-error", message: { key: "invalidReusablePlane" } });
    expect(result.exportAsync).not.toHaveBeenCalled();
  });

  it("delivers the source and permits HD publication before an optional renderer import finishes", async () => {
    vi.useFakeTimers();
    const h = host();
    h.api.importShaderById.mockImplementation(() => new Promise(() => {}));
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.findLast((post) => post.type === "source")?.payload).toMatchObject({
      sourceNodeId: h.source.id, nativeRendererPending: true,
    });
    expect(h.posts.findLast((post) => post.type === "source")?.payload.nativeRenderer).toBeUndefined();
    h.api.ui.onmessage?.({ type: "apply", payload: {
      generation: 1, sourceNodeId: h.source.id, spec, bytes: new Uint8Array([4]),
      renderWidth: 520, renderHeight: 606, placement: { x: 0, y: 0, width: 520, height: 606 },
    } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.some((post) => post.type === "apply-complete")).toBe(true);
    expect(h.api.createRectangle).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.posts.at(-1)).toMatchObject({ type: "source-renderer", generation: 1, sourceNodeId: h.source.id });
    expect(h.posts.at(-1).renderer).toBeUndefined();
  });

  it("keeps image preview usable when the optional host import throws synchronously", async () => {
    vi.useFakeTimers();
    const h = host();
    h.api.importShaderById.mockImplementation(() => { throw new Error("Host import unavailable"); });
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.some(p => p.type === "selection-error")).toBe(false);
    expect(h.posts.findLast(p => p.type === "source").payload.sourceNodeId).toBe(h.source.id);
  });

  it.each(["content", "selection"])("does not deliver obsolete renderer availability after a %s change", async (change) => {
    vi.useFakeTimers();
    const h = host();
    const definition = await h.api.importShaderById(renderer.id);
    let finish!: (shader: typeof definition) => void;
    h.api.importShaderById.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.some(p => p.type === "source" && p.generation === 1)).toBe(true);
    if (change === "content") {
      h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: h.source.id, node: h.source }] });
    } else {
      const other = h.api.createRectangle(); h.page.selection = [other]; h.handlers.get("selectionchange")?.();
    }
    finish(definition);
    await vi.advanceTimersByTimeAsync(120);
    expect(h.posts.some(p => p.type === "source-renderer" && p.generation === 1)).toBe(false);
    expect(h.posts.findLast(p => p.type === "source").generation).toBe(2);
    if (change === "selection") expect(h.posts.findLast(p => p.type === "source").payload.nativeRenderer).toBeUndefined();
  });

  it("finishes optional discovery after an HD replacement without exporting again or resetting its source", async () => {
    vi.useFakeTimers();
    const h = host();
    const result = h.api.createRectangle();
    writeStoredOperation(result, { kind: "transform", spec });
    writeStoredBinding(result, { sourceNodeIds: [h.source.id], renderWidth: 1040, renderHeight: 1212 });
    h.page.selection = [result];
    const definition = await h.api.importShaderById(renderer.id);
    let finish!: (shader: typeof definition) => void;
    h.api.importShaderById.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.advanceTimersByTimeAsync(0);
    h.api.ui.onmessage?.({ type: "apply", payload: {
      generation: 1, sourceNodeId: h.source.id, targetNodeId: result.id, spec, bytes: new Uint8Array([4]),
      renderWidth: 1040, renderHeight: 1212, placement: { x: 800, y: 0, width: 520, height: 606 },
    } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({ type: "apply-complete", operation: "replace", targetNodeId: result.id });
    finish(definition); await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({ type: "source-renderer", generation: 1, sourceNodeId: h.source.id,
      targetNodeId: result.id, renderer: { id: definition.id } });
    expect(h.source.exportAsync).toHaveBeenCalledTimes(1);
  });

  it.each(["CENTER", "SCALE"])("preserves native content with %s constraints during creation, replacement and failed replacement", async (constraint) => {
    const h = host();
    h.source.constraints = { horizontal: constraint, vertical: constraint };
    const input = { source: h.source, renderer, spec,
      inverse: [1 / 800, 0, 0, 0, 1 / 700, 0, 0, 0, 1] as [number, number, number, number, number, number, number, number, number],
      placement: { x: 800, y: 0, width: 800, height: 700 }, renderWidth: 800, renderHeight: 700 };
    const result = await publishNativeResult(input);
    const content = result.children[0]!.type === "FRAME" ? result.children[0].children[0]! : undefined;
    expect(content).toMatchObject({ width: 520, height: 606, x: 0, y: 0 });
    await expect(nativeDocumentParts(result)).resolves.toMatchObject({ content: { id: content!.id } });
    await publishNativeResult({ ...input, source: content as FrameNode, existing: result,
      placement: { x: 800, y: 0, width: 900, height: 750 } });
    expect(content).toMatchObject({ width: 520, height: 606, x: 0, y: 0 });
    const before = JSON.stringify((await nativeDocumentParts(result)).record);
    vi.mocked(result.setSharedPluginData).mockImplementationOnce(() => { throw new Error("write failed"); });
    await expect(publishNativeResult({ ...input, source: content as FrameNode, existing: result })).rejects.toThrow("write failed");
    expect(content).toMatchObject({ width: 520, height: 606, x: 0, y: 0 });
    expect(JSON.stringify((await nativeDocumentParts(result)).record)).toBe(before);
    expect(h.source).toMatchObject({ width: 520, height: 606 });
  });

  it.each(["native", "raster", "canvas", "mesh"] as const)("rejects a %s publication when its source changes during asynchronous preflight, then permits a fresh retry", async (kind) => {
    vi.useFakeTimers();
    const h = host();
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.advanceTimersByTimeAsync(0);
    let release!: (node: any) => void;
    h.api.getNodeByIdAsync.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const common = { generation: 1, sourceNodeId: h.source.id, spec, bytes: new Uint8Array([4]), renderWidth: 520, renderHeight: 606,
      placement: { x: 0, y: 0, width: 520, height: 606 } };
    const message = kind === "native" ? { type: "apply-native", payload: {
      ...common, inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1] } }
      : kind === "raster" ? { type: "apply", payload: common }
      : kind === "canvas" ? { type: "apply-canvas", payload: {
        generation: 1, sourceNodeId: h.source.id,
        setSpec: { schema: "worldbend.canvas-set", version: "0.1", variants: [{ id: "one", operation: { kind: "stretch", output: { width: 520, height: 606 } } }] },
        outputs: [{ id: "one", bytes: common.bytes, renderWidth: 520, renderHeight: 606, placement: common.placement }],
      } } : { type: "apply-designer", payload: { generation: 1, sourceNodeIds: [h.source.id],
        task: { kind: "mesh", spec: createMeshSpec(520, 606, 2) }, bytes: common.bytes,
        renderWidth: 520, renderHeight: 606, placement: common.placement } };
    if (kind === "native") delete (message.payload as any).bytes;
    h.api.ui.onmessage?.(message);
    await vi.advanceTimersByTimeAsync(0);
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: h.source.id, node: h.source }] });
    release(h.source);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.filter(p => /apply.*-complete/.test(p.type))).toHaveLength(0);
    expect(h.posts).toContainEqual(expect.objectContaining({ message: { key: "selectionChanged" } }));
    expect(h.page.children).toEqual([h.source]);
    await vi.advanceTimersByTimeAsync(120);
    message.payload.generation = h.posts.findLast(p => p.type === "source").generation;
    h.api.ui.onmessage?.(message);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.filter(p => /apply.*-complete/.test(p.type))).toHaveLength(1);
  });

  it.each(["native", "raster", "canvas", "mesh"] as const)("publishes twice from the same %s source snapshot, then rejects a changed source", async (kind) => {
    vi.useFakeTimers();
    const h = host();
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.advanceTimersByTimeAsync(0);
    const placement = { x: 0, y: 0, width: 520, height: 606 };
    const common = { generation: 1, sourceNodeId: h.source.id, spec, bytes: new Uint8Array([4]), renderWidth: 520, renderHeight: 606, placement };
    const operation = { kind: "stretch", output: { width: 520, height: 606 } };
    const message = kind === "native"
      ? { type: "apply-native", payload: { ...common, inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1] } }
      : kind === "raster" ? { type: "apply", payload: common }
      : kind === "canvas" ? { type: "apply-canvas", payload: {
          generation: 1, sourceNodeId: h.source.id,
          setSpec: { schema: "worldbend.canvas-set", version: "0.1", variants: [{ id: "one", operation }] },
          outputs: [{ id: "one", bytes: common.bytes, renderWidth: 520, renderHeight: 606, placement }],
        } }
      : { type: "apply-designer", payload: {
          generation: 1, sourceNodeIds: [h.source.id], task: { kind: "mesh", spec: createMeshSpec(520, 606, 2) },
          bytes: common.bytes, renderWidth: 520, renderHeight: 606, placement,
        } };
    // The closed native message has no raster bytes.
    if (kind === "native") delete (message.payload as any).bytes;
    for (let i = 0; i < 2; i++) {
      h.api.ui.onmessage?.(message);
      await vi.advanceTimersByTimeAsync(0);
      expect(h.posts.filter(p => /apply.*-complete/.test(p.type))).toHaveLength(i + 1);
    }
    const results = h.page.children.filter((n: any) => n.id !== h.source.id);
    expect(results).toHaveLength(2);
    expect(results[0].id).not.toBe(results[1].id);
    expect(h.page.selection).toEqual([h.source]);
    expect(h.source.exportAsync).toHaveBeenCalledTimes(1);
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: h.source.id, node: h.source }] });
    h.api.ui.onmessage?.(message);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.at(-1)).toMatchObject({ message: { key: "selectionChanged" } });
    expect(h.page.children.filter((n: any) => n.id !== h.source.id)).toHaveLength(2);
  });

  it.each(["native", "raster"] as const)("keeps a %s replacement usable across successive output sizes", async (kind) => {
    vi.useFakeTimers();
    const h = host();
    const result = kind === "native" ? await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    }) : h.api.createRectangle();
    if (kind === "raster") {
      writeStoredOperation(result, { kind: "transform", spec });
      writeStoredBinding(result, { sourceNodeIds: [h.source.id], renderWidth: 520, renderHeight: 606 });
    }
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.advanceTimersByTimeAsync(0);
    const ready = h.posts.findLast(p => p.type === "source");
    for (const width of [600, 700]) {
      h.api.ui.onmessage?.({ type: kind === "native" ? "apply-native" : "apply", payload: {
        generation: 1, sourceNodeId: ready.payload.sourceNodeId, targetNodeId: result.id, spec,
        ...(kind === "native" ? { inverse: [1 / width, 0, 0, 0, 1 / 606, 0, 0, 0, 1] } : { bytes: new Uint8Array([5]) }),
        renderWidth: width, renderHeight: 606, placement: { x: 800, y: 0, width, height: 606 },
      } });
      await vi.advanceTimersByTimeAsync(0);
      expect(h.posts.at(-1)).toMatchObject({ type: "apply-complete", operation: "replace" });
      expect(result.width).toBe(width);
    }
    expect(readStoredBinding(result)?.revision).toBe(3);
    expect(h.page.selection).toEqual([result]);
  });

  it("keeps an in-flight and prepared preview when only the text caret or range changes", async () => {
    vi.useFakeTimers();
    const h = host();
    let finishExport!: (bytes: Uint8Array) => void;
    h.source.exportAsync.mockImplementationOnce(() => new Promise<Uint8Array>((resolve) => { finishExport = resolve; }));
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 4; i++) {
      h.page.selectedTextRange = { node: h.source, start: i, end: i + 1 };
      h.handlers.get("selectionchange")?.();
      await vi.advanceTimersByTimeAsync(150);
    }
    finishExport(new Uint8Array([7]));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.source.exportAsync).toHaveBeenCalledTimes(1);
    expect(h.posts.filter((p) => p.type === "source")).toEqual([
      expect.objectContaining({ generation: 1, payload: expect.objectContaining({ bytes: new Uint8Array([7]) }) }),
    ]);
    const delivered = h.posts.length;
    h.page.selectedTextRange = null;
    h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(150);
    expect(h.posts).toHaveLength(delivered);
    expect(h.source.exportAsync).toHaveBeenCalledTimes(1);
  });

  it("refreshes actual content edits on time while caret events continue", async () => {
    vi.useFakeTimers();
    const h = host();
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.advanceTimersByTimeAsync(0);
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: h.source.id, node: h.source }] });
    expect(h.posts.at(-1)).toMatchObject({ type: "selection-loading", generation: 2 });
    await vi.advanceTimersByTimeAsync(80);
    h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(40);
    expect(h.source.exportAsync).toHaveBeenCalledTimes(2);
    expect(h.posts.at(-1)).toMatchObject({ type: "source", generation: 2 });
  });

  it("invalidates an away-and-back selection and an empty selection on another page", async () => {
    vi.useFakeTimers();
    const h = host();
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.advanceTimersByTimeAsync(0);
    h.page.selection = []; h.handlers.get("selectionchange")?.();
    h.page.selection = [h.source]; h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(120);
    expect(h.source.exportAsync).toHaveBeenCalledTimes(2);
    expect(h.posts.at(-1)).toMatchObject({ type: "source", generation: 2 });
    h.page.selection = []; h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(120);
    const nextPage = { ...h.page, id: "other-page", selection: [] };
    h.api.currentPage = nextPage;
    h.handlers.get("currentpagechange")?.();
    await vi.advanceTimersByTimeAsync(120);
    expect(h.posts.at(-1)).toMatchObject({ type: "selection-error", generation: 4 });
    const delivered = h.posts.length;
    h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(120);
    expect(h.posts).toHaveLength(delivered);
  });

  it("coalesces selection changes during a slow host export and only delivers the latest source", async () => {
    vi.useFakeTimers();
    const h = host();
    let finishExport!: (bytes: Uint8Array) => void;
    h.source.exportAsync.mockImplementationOnce(() => new Promise<Uint8Array>((resolve) => { finishExport = resolve; }));
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.source.exportAsync).toHaveBeenCalledTimes(1);
    const skipped = h.frame();
    h.page.selection = [skipped]; h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(250);
    expect(skipped.exportAsync).not.toHaveBeenCalled();
    const latest = h.frame();
    h.page.selection = [latest]; h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(250);
    expect(latest.exportAsync).not.toHaveBeenCalled();
    finishExport(new Uint8Array([1, 2, 3]));
    await vi.advanceTimersByTimeAsync(0);
    expect(skipped.exportAsync).not.toHaveBeenCalled();
    expect(latest.exportAsync).toHaveBeenCalledTimes(1);
    expect(h.posts.filter((p) => p.type === "source").map((p) => p.payload.sourceNodeId)).toEqual([latest.id]);
  });

  it("releases the selection export queue after an obsolete export fails", async () => {
    vi.useFakeTimers();
    const h = host();
    let failExport!: (reason: Error) => void;
    h.source.exportAsync.mockImplementationOnce(() => new Promise<Uint8Array>((_, reject) => { failExport = reject; }));
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.advanceTimersByTimeAsync(0);
    const latest = h.frame();
    h.page.selection = [latest]; h.handlers.get("selectionchange")?.();
    await vi.advanceTimersByTimeAsync(250);
    failExport(new Error("Host export failed"));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.posts.filter((p) => p.type === "source").map((p) => p.payload.sourceNodeId)).toEqual([latest.id]);
    expect(h.posts.filter((p) => p.type === "selection-error")).toEqual([]);
  });

  it("invalidates an edited linked source during the first export before a prepared selection exists", async () => {
    vi.useFakeTimers();
    const h = host();
    const result = h.api.createRectangle();
    writeStoredOperation(result, { kind: "transform", spec });
    writeStoredBinding(result, { sourceNodeIds: [h.source.id], renderWidth: 520, renderHeight: 606 });
    h.page.selection = [result];
    let finishExport!: (bytes: Uint8Array) => void;
    h.source.exportAsync.mockImplementationOnce(() => new Promise<Uint8Array>((resolve) => { finishExport = resolve; }));
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.advanceTimersByTimeAsync(0);
    const child = h.frame(); h.source.appendChild(child);
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: child.id, node: child }] });
    await vi.advanceTimersByTimeAsync(250);
    expect(h.source.exportAsync).toHaveBeenCalledTimes(1);
    finishExport(new Uint8Array([9]));
    await vi.advanceTimersByTimeAsync(0);
    const delivered = h.posts.filter((p) => p.type === "source");
    expect(h.source.exportAsync).toHaveBeenCalledTimes(2);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].payload.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(delivered[0].generation).toBe(2);
  });

  it("updates a nested native result in parent coordinates and rejects stale reparenting", async () => {
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 40, y: 50, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606 });
    const parent = h.frame(); parent.absoluteTransform = [[1, 0, 1000], [0, 1, 2000]];
    parent.appendChild(result);
    Object.defineProperty(result, "absoluteBoundingBox", { get: () => ({
      x: result.x + 1000, y: result.y + 2000, width: result.width, height: result.height,
    }) });
    const { inspect, apply } = await import("./agent-handoff");
    expect((await inspect(result.id, "granted-file", h.page.id)).placement).toMatchObject({ x: 40, y: 50 });
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source" })));
    const ready = h.posts.findLast((p) => p.type === "source");
    expect(ready.payload.placement).toMatchObject({ x: 1040, y: 2050 });
    h.api.ui.onmessage?.({ type: "apply-native", payload: {
      generation: ready.generation, sourceNodeId: ready.payload.sourceNodeId, targetNodeId: result.id,
      spec, inverse: [1 / 600, 0, 0, 0, 1 / 650, 0, 0, 0, 1],
      placement: { x: 1050, y: 2060, width: 600, height: 650 }, renderWidth: 600, renderHeight: 650,
    } });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "apply-complete" })));
    expect(result.parent).toBe(parent);
    expect(result).toMatchObject({ x: 50, y: 60, width: 600, height: 650 });
    expect((await nativeDocumentParts(result)).record.placement).toMatchObject({ x: 1050, y: 2060 });
    const snapshot = await inspect(result.id, "granted-file", h.page.id);
    const otherParent = h.frame(); otherParent.appendChild(result);
    await expect(apply({ fileKey: "granted-file", pageId: h.page.id, nodeId: result.id,
      expected: snapshot.expected, spec, inverse: [1 / 600, 0, 0, 0, 1 / 650, 0, 0, 0, 1],
      width: 600, height: 650 })).rejects.toThrow("E_FIGMA_CONFLICT");
    otherParent.absoluteTransform = [[1, 0, 3000], [0, 1, 4000]];
    await restoreNativeProjection(result, () => {});
    expect(result).toMatchObject({ x: -1950, y: -1940, width: 600, height: 650 });
    otherParent.parent = { type: "PAGE", id: "other-page", parent: null };
    await expect(inspect(result.id, "granted-file", h.page.id)).rejects.toThrow("E_FIGMA_SCOPE");
  });
  it("reopens and independently updates a duplicated native design without touching its original", async () => {
    const h = host();
    const original = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606 });
    const originalParts = await nativeDocumentParts(original);
    const before = JSON.stringify(originalParts.record);
    const copy = original.clone(); copy.x = 1500;
    const parts = await nativeDocumentParts(copy);
    expect(parts.copied).toBe(true);
    expect(parts.content.id).not.toBe(originalParts.content.id);
    const { inspect, apply } = await import("./agent-handoff");
    const snapshot = await inspect(copy.id, "granted-file", h.page.id);
    expect(snapshot.revision).toBe(0);
    expect(snapshot.source.nodeId).toBe(parts.content.id);
    h.page.selection = [copy];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", payload: expect.objectContaining({ nativeTarget: true, targetNodeId: copy.id, sourceNodeId: parts.content.id }) })));
    await apply({ fileKey: "granted-file", pageId: h.page.id, nodeId: copy.id, expected: snapshot.expected,
      spec, inverse: [1 / 720, 0, 0, 0, 1 / 400, 0, 0, 0, 1], width: 720, height: 400 });
    expect((await nativeDocumentParts(copy)).copied).toBe(false);
    expect(readStoredBinding(copy)).toMatchObject({ revision: 1, sourceNodeIds: [parts.content.id] });
    expect(JSON.stringify((await nativeDocumentParts(original)).record)).toBe(before);
    expect(original).toMatchObject({ width: 520, height: 606, x: 800 });
    await expect(apply({ fileKey: "granted-file", pageId: h.page.id, nodeId: copy.id, expected: snapshot.expected,
      spec, inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1], width: 520, height: 606 })).rejects.toThrow("E_FIGMA_CONFLICT");
    const broken = original.clone(); (await nativeDocumentParts(broken)).content.remove();
    await expect(nativeDocumentParts(broken)).rejects.toThrow("structure changed");
  });
  it("reopens a raster result alone, refreshes on source changes, and publishes its next revision", async () => {
    const h = host(); const target = h.api.createRectangle();
    writeStoredOperation(target, { kind: "transform", spec });
    writeStoredBinding(target, { sourceNodeIds: [h.source.id], renderWidth: 520, renderHeight: 606 });
    h.page.selection = [target];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", payload: expect.objectContaining({ sourceNodeId: h.source.id, targetNodeId: target.id, spec }) })));
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: h.source.id, node: h.source }] });
    expect(h.posts.at(-1)).toMatchObject({ type: "selection-loading", generation: 2 });
    h.api.ui.onmessage?.({ type: "apply", payload: { generation: 1, sourceNodeId: h.source.id, targetNodeId: target.id, spec, bytes: new Uint8Array([4]), renderWidth: 520, renderHeight: 606, placement: { x: 10, y: 20, width: 520, height: 606 } } });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "apply-error", message: { key: "selectionChanged" } })));
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 2 })));
    h.api.ui.onmessage?.({ type: "apply", payload: { generation: 2, sourceNodeId: h.source.id, targetNodeId: target.id, spec, bytes: new Uint8Array([4]), renderWidth: 520, renderHeight: 606, placement: { x: 10, y: 20, width: 520, height: 606 } } });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "apply-complete", operation: "replace" })));
    expect(readStoredBinding(target)).toMatchObject({ revision: 2, sourceNodeIds: [h.source.id] });
    expect(target.setRelaunchData).toHaveBeenCalledWith({ edit: "" });
    expect(h.page.selection).toEqual([target]);
  });

  it("undoes a duplicate's first publication back to its own placement and retained copy record", async () => {
    const h = host();
    const native = await import("./native-document");
    const original = await native.publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606 });
    const copy = original.clone(); copy.x = 1500; copy.y = 200;
    const copiedParts = await native.nativeDocumentParts(copy);
    const saved = ["transform", "binding", "native"].map(key => [key, copy.getSharedPluginData("worldbend", key)]);
    await native.publishNativeResult({ source: copiedParts.content, existing: copy, renderer, spec,
      inverse: [1 / 720, 0, 0, 0, 1 / 400, 0, 0, 0, 1],
      placement: { x: 1510, y: 220, width: 720, height: 400 }, renderWidth: 720, renderHeight: 400 });
    h.page.selection = [copy];
    h.api.triggerUndo.mockImplementation(() => {
      for (const [key, value] of saved) copy.setSharedPluginData("worldbend", key!, value!);
      h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: copy.id, node: copy }] });
    });
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 1 })));
    h.api.ui.onmessage?.({ type: "trigger-undo" });
    await vi.waitFor(() => expect(copy).toMatchObject({ x: 1500, y: 200, width: 520, height: 606 }));
    expect((await native.nativeDocumentParts(copy)).copied).toBe(true);
    expect(copiedParts.content.id).toBe(copy.children[0]?.type === "FRAME" ? copy.children[0].children[0]?.id : undefined);
    expect(original).toMatchObject({ x: 800, y: 0, width: 520, height: 606 });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 2 })));
    expect(h.posts).not.toContainEqual(expect.objectContaining({ type: "selection-error" }));
  });

  it("requires an explicit repair when a copied binding or a deleted source is encountered", async () => {
    const h = host(); const target = h.api.createRectangle();
    writeStoredOperation(target, { kind: "transform", spec });
    writeStoredBinding(target, { sourceNodeIds: [h.source.id], renderWidth: 520, renderHeight: 606 });
    const copy = { id: "copied-node", getSharedPluginData: target.getSharedPluginData };
    expect(readStoredBinding(copy)).toBeUndefined();
    h.source.remove(); h.page.selection = [target];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "selection-error", message: { key: "linkedSourceUnavailable" } })));
    expect(h.api.createImage).not.toHaveBeenCalled();
  });

  it("preserves native content dimensions across output sizes, reopens it, and rejects effect drift", async () => {
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 720, 0, 0, 0, 1 / 400, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 720, height: 400 }, renderWidth: 720, renderHeight: 400,
    });
    const parts = await nativeDocumentParts(result);
    expect(parts.content).toMatchObject({ width: 520, height: 606 });
    expect(parts.surface).toMatchObject({ width: 720, height: 606 });
    expect(readStoredOperation(result)).toEqual({ status: "valid", operation: { kind: "transform", spec } });
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", payload: expect.objectContaining({ nativeTarget: true, sourceNodeId: parts.content.id, renderWidth: 720, renderHeight: 400 }) })));
    expect(parts.content.exportAsync).toHaveBeenCalledWith(expect.objectContaining({ useAbsoluteBounds: true }));
    const next = await publishNativeResult({ source: parts.content, existing: result, renderer, spec,
      inverse: [1 / 240, 0, 0, 0, 1 / 800, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 240, height: 800 }, renderWidth: 240, renderHeight: 800,
    });
    expect(next.id).toBe(result.id);
    expect((await nativeDocumentParts(next)).content.id).toBe(parts.content.id);
    expect(parts.content).toMatchObject({ width: 520, height: 606 });
    expect(h.api.createImage).not.toHaveBeenCalled();
    (parts.surface.effects[0] as any).properties["0"] += .2;
    await expect(nativeDocumentParts(result)).rejects.toThrow("effect changed");
  });

  it("rolls back native pixels, geometry and both records when publication fails", async () => {
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    });
    const parts = await nativeDocumentParts(result);
    const before = JSON.stringify(parts.record);
    const binding = readStoredBinding(result);
    const set = result.setSharedPluginData.bind(result);
    vi.spyOn(result, "setSharedPluginData").mockImplementationOnce(() => { throw new Error("Storage unavailable"); });
    await expect(publishNativeResult({ source: parts.content, existing: result, renderer, spec,
      inverse: [1 / 720, 0, 0, 0, 1 / 400, 0, 0, 0, 1],
      placement: { x: 900, y: 10, width: 720, height: 400 }, renderWidth: 720, renderHeight: 400,
    })).rejects.toThrow("Storage unavailable");
    expect(result).toMatchObject({ x: 800, y: 0, width: 520, height: 606 });
    expect(JSON.stringify((await nativeDocumentParts(result)).record)).toBe(before);
    expect(readStoredBinding(result)).toEqual(binding);
    result.setSharedPluginData = set;
  });

  it.each(["resize", "scale"])("reopens a native %s with current dimensions and can fit changed content in place", async (kind) => {
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606 });
    const { content, surface } = await nativeDocumentParts(result);
    result.resize(780, 909);
    if (kind === "scale") { surface.resize(780, 909); content.resize(780, 909); content.y = -0.00000762939453125; }
    const { inspect, apply } = await import("./agent-handoff");
    const snapshot = await inspect(result.id, "granted-file", h.page.id);
    expect(snapshot.spec.destination.quad.br.x).toBeCloseTo(kind === "scale" ? 1 : 520 / 780);
    expect(snapshot.spec.destination.quad.br.y).toBeCloseTo(kind === "scale" ? 1 : 606 / 909);
    if (kind === "resize") {
      // Both surface extents are structurally valid after a host resize, but
      // switching between them changes the visible mapping and must conflict.
      surface.resize(780, 909);
      await expect(apply({ fileKey: "granted-file", pageId: h.page.id, nodeId: result.id,
        expected: snapshot.expected, spec, inverse: [1 / 780, 0, 0, 0, 1 / 909, 0, 0, 0, 1], width: 780, height: 909 }))
        .rejects.toThrow("E_FIGMA_CONFLICT");
      surface.resize(520, 606);
    }
    // Auto layout may reflow by a few pixels rather than multiply its height.
    content.resize(content.width, content.height + 64);
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source",
      payload: expect.objectContaining({ nativeTarget: true, renderWidth: 780, renderHeight: 909 }) })));
    await publishNativeResult({ source: content, existing: result, renderer, spec,
      inverse: [1 / 780, 0, 0, 0, 1 / 909, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 780, height: 909 }, renderWidth: 780, renderHeight: 909 });
    expect((await nativeDocumentParts(result)).content.id).toBe(content.id);
    expect((await nativeDocumentParts(result)).record.sourceSize.height).toBe(content.height);
    surface.resize(surface.width + 17, surface.height);
    await expect(nativeDocumentParts(result)).rejects.toThrow("structure changed");
  });

  it("lets an external Agent retain native edits, then rejects reuse of an obsolete handoff", async () => {
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    });
    const { inspect, apply } = await import("./agent-handoff");
    const before = await inspect(result.id, "granted-file", h.page.id);
    const { content } = await nativeDocumentParts(result);
    content.name = "Human edited this content";
    const request = { fileKey: before.fileKey, pageId: before.pageId, nodeId: before.nodeId,
      expected: before.expected, spec, width: 720, height: 400,
      inverse: [1 / 720, 0, 0, 0, 1 / 400, 0, 0, 0, 1] as [number, number, number, number, number, number, number, number, number],
    };
    const after = await apply(request);
    expect(after.revision).toBe(before.revision + 1);
    expect(after.source.nodeId).toBe(content.id);
    expect(content.name).toBe("Human edited this content");
    await expect(apply(request)).rejects.toThrow("E_FIGMA_CONFLICT");
    expect((await inspect(result.id, before.fileKey, before.pageId)).expected).toBe(after.expected);
    await expect(inspect(result.id, before.fileKey, "other-page")).rejects.toThrow("E_FIGMA_SCOPE");
    await expect(inspect(result.id, "other-file", before.pageId)).rejects.toThrow("E_FIGMA_SCOPE");
    await expect(apply({ ...request, expected: after.expected, fileKey: "other-file" })).rejects.toThrow("E_FIGMA_SCOPE");
    expect((await inspect(result.id, before.fileKey, before.pageId)).expected).toBe(after.expected);
  });

  it("reports a native preview export failure without offering geometry repair, then retries cleanly", async () => {
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    });
    const { content } = await nativeDocumentParts(result);
    vi.spyOn(content, "exportAsync").mockRejectedValueOnce(new Error("Temporary export failure"));
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "selection-error" })));
    const error = h.posts.find((p: any) => p.type === "selection-error");
    expect(error.message).toEqual({ key: "previewFailed" });
    expect(error).not.toHaveProperty("nativeRecovery");
    h.page.selection = [];
    h.handlers.get("selectionchange")?.();
    h.page.selection = [result];
    h.handlers.get("selectionchange")?.();
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 2 })));
    expect(readStoredBinding(result)?.revision).toBe(1);
  });

  it("checks the last publication boundary before creating or changing any native node", async () => {
    const h = host();
    const before = h.page.children.map((n: any) => n.id);
    await expect(publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
      beforeWrite: () => { throw new Error("E_FIGMA_CONFLICT"); },
    })).rejects.toThrow("E_FIGMA_CONFLICT");
    expect(h.page.children.map((n: any) => n.id)).toEqual(before);
    expect(h.api.createFrame).not.toHaveBeenCalled();
  });

  it.each([[0, false], [250, false], [0, true], [250, true]] as const)(
    "completes a host Undo delivered after %i ms with descendant selection %s, preserving current native content", async (delay, descendant) => {
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 20, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    });
    const { content } = await nativeDocumentParts(result);
    const saved = ["transform", "binding", "native"].map(key => [key, result.getSharedPluginData("worldbend", key)]);
    await publishNativeResult({ source: content, existing: result, renderer, spec,
      inverse: [1 / 720, 0, 0, 0, 1 / 400, 0, 0, 0, 1],
      placement: { x: 900, y: 30, width: 720, height: 400 }, renderWidth: 720, renderHeight: 400,
    });
    content.name = "Current human content";
    h.page.selection = [result];
    h.api.triggerUndo.mockImplementation(() => {
      const deliver = () => {
        for (const [key, value] of saved) result.setSharedPluginData("worldbend", key!, value!);
        h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: result.id, node: result }] });
      };
      if (delay) setTimeout(deliver, delay); else deliver();
    });
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 1 })));
    if (descendant) {
      h.page.selection = [content]; h.handlers.get("selectionchange")?.();
    }
    h.api.ui.onmessage?.({ type: "trigger-undo" });
    await vi.waitFor(() => expect(result).toMatchObject({ x: 800, y: 20, width: 520, height: 606 }));
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 2 })));
    expect((await nativeDocumentParts(result)).content.id).toBe(content.id);
    expect(content.name).toBe("Current human content");
    expect(readStoredBinding(result)?.revision).toBe(1);
    expect(h.page.selection).toEqual([descendant ? content : result]);
  });

  it("releases the plugin after the Undo deadline when no rollback arrives", async () => {
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 20, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    });
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 1 })));
    vi.useFakeTimers();
    h.api.ui.onmessage?.({ type: "trigger-undo" });
    await vi.advanceTimersByTimeAsync(1120);
    expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 2 }));
    h.api.ui.onmessage?.({ type: "trigger-undo" });
    expect(h.api.triggerUndo).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1120);
    expect(result).toMatchObject({ x: 800, y: 20, width: 520, height: 606 });
    expect(readStoredBinding(result)?.revision).toBe(1);
    expect(h.posts).not.toContainEqual(expect.objectContaining({ type: "apply-error" }));
  });

  it("cancels pending Undo repair when the designer selects another object", async () => {
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 20, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    });
    const { content } = await nativeDocumentParts(result);
    const saved = ["transform", "binding", "native"].map(key => [key, result.getSharedPluginData("worldbend", key)]);
    await publishNativeResult({ source: content, existing: result, renderer, spec,
      inverse: [1 / 720, 0, 0, 0, 1 / 400, 0, 0, 0, 1],
      placement: { x: 900, y: 30, width: 720, height: 400 }, renderWidth: 720, renderHeight: 400,
    });
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 1 })));
    h.api.ui.onmessage?.({ type: "trigger-undo" });
    h.page.selection = [h.source]; h.handlers.get("selectionchange")?.();
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "apply-error", message: { key: "selectionChanged" } })));
    for (const [key, value] of saved) result.setSharedPluginData("worldbend", key!, value!);
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: result.id, node: result }] });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 2 })));
    expect(result).toMatchObject({ x: 900, y: 30, width: 720, height: 400 });
    h.page.selection = [result]; h.handlers.get("selectionchange")?.();
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "selection-error", nativeRecovery: expect.objectContaining({ nodeId: result.id }) })));
  });

  it.each([false, true])("offers explicit repair for changed effects with descendant selection %s and refuses to overwrite changed source dimensions", async (descendant) => {
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    });
    const { content, surface } = await nativeDocumentParts(result);
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 1 })));
    if (descendant) {
      h.page.selection = [content]; h.handlers.get("selectionchange")?.();
    }
    surface.effects = [];
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: surface.id, node: surface }] });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "selection-error", nativeRecovery: expect.objectContaining({ nodeId: result.id }) })));
    const error = h.posts.findLast((p: any) => p.nativeRecovery);
    h.api.ui.onmessage?.({ type: "restore-native", generation: error.generation, ...error.nativeRecovery });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 3,
      payload: expect.objectContaining({ targetNodeId: result.id, sourceNodeId: content.id }),
    })));
    expect((await nativeDocumentParts(result)).surface.effects.length).toBe(1);
    expect(h.page.selection).toEqual([descendant ? content : result]);
    content.resize(521, 606);
    await expect(restoreNativeProjection(result, vi.fn())).rejects.toThrow("Native content changed");
    expect(content.width).toBe(521);
  });

  it.each(["outside", "mixed", "stale-record"] as const)("cancels descendant recovery at the write boundary after %s changes", async (change) => {
    const h = host();
    const result = await publishNativeResult({ source: h.source, renderer, spec,
      inverse: [1 / 520, 0, 0, 0, 1 / 606, 0, 0, 0, 1],
      placement: { x: 800, y: 0, width: 520, height: 606 }, renderWidth: 520, renderHeight: 606,
    });
    const { content, surface } = await nativeDocumentParts(result);
    h.page.selection = [result];
    await import("./main"); h.api.ui.onmessage?.({ type: "ready", systemLocales: ["en"] });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "source", generation: 1 })));
    h.page.selection = [content]; h.handlers.get("selectionchange")?.();
    surface.effects = [];
    h.pageHandlers.get("nodechange")?.({ nodeChanges: [{ type: "PROPERTY_CHANGE", id: surface.id, node: surface }] });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "selection-error", nativeRecovery: expect.anything() })));
    const error = h.posts.findLast((post: any) => post.nativeRecovery);
    h.api.ui.onmessage?.({ type: "restore-native", generation: error.generation, ...error.nativeRecovery });
    // The node lookup yields before writing. No selection event is needed to
    // exercise the final safety check rather than generation invalidation.
    if (change === "stale-record") result.setSharedPluginData("worldbend", "native", "");
    else h.page.selection = change === "mixed" ? [content, h.source] : [h.source];
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "apply-error" })));
    expect(surface.effects).toEqual([]);
    expect(readStoredBinding(result)?.revision).toBe(1);
  });
});
