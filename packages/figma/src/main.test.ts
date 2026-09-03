import { afterEach, describe, expect, it, vi } from "vitest";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function sourceNode(id: string, pending: Deferred<Uint8Array>, page: object) {
  return {
    id,
    name: id,
    type: "RECTANGLE",
    visible: true,
    parent: page,
    width: 100,
    height: 80,
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 80 },
    getSharedPluginData: () => "",
    getPluginData: () => "",
    exportAsync: vi.fn(() => pending.promise),
  };
}

function identitySpec() {
  return {
    schema: "worldbend.transform" as const,
    version: "0.1" as const,
    destination: {
      space: "normalized" as const,
      quad: {
        tl: { x: 0, y: 0 },
        tr: { x: 1, y: 0 },
        br: { x: 1, y: 1 },
        bl: { x: 0, y: 1 },
      },
    },
    content: { fit: "stretch" as const },
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Figma selection generations", () => {
  it("resolves the first-run language from the system locale", async () => {
    const posts: unknown[] = [];
    const page = {
      type: "PAGE",
      selection: [] as unknown[],
      on: vi.fn(),
      off: vi.fn(),
    };
    const getAsync = vi.fn(async () => undefined);
    const figmaMock = {
      currentPage: page,
      clientStorage: { getAsync, setAsync: vi.fn() },
      showUI: vi.fn(),
      on: vi.fn(),
      ui: {
        onmessage: undefined as ((message: unknown) => void) | undefined,
        postMessage: vi.fn((message: unknown) => posts.push(message)),
      },
    };
    vi.stubGlobal("figma", figmaMock);
    vi.stubGlobal("__html__", "");

    await import("./main");
    expect(figmaMock.showUI).toHaveBeenCalledWith("", {
      width: 600,
      height: 720,
      themeColors: true,
    });
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["zh-Hans-CN", "en-US"] });

    await vi.waitFor(() => {
      expect(posts).toContainEqual({ type: "locale", preference: "system", locale: "zh-CN" });
    });
    expect(getAsync).toHaveBeenCalledWith("perspective.preferences.v1");
  });

  it("keeps an explicit language ahead of the system locale", async () => {
    const posts: unknown[] = [];
    const page = {
      type: "PAGE",
      selection: [] as unknown[],
      on: vi.fn(),
      off: vi.fn(),
    };
    const figmaMock = {
      currentPage: page,
      clientStorage: {
        getAsync: vi.fn(async () => ({ version: 1, locale: "en" })),
        setAsync: vi.fn(),
      },
      showUI: vi.fn(),
      on: vi.fn(),
      ui: {
        onmessage: undefined as ((message: unknown) => void) | undefined,
        postMessage: vi.fn((message: unknown) => posts.push(message)),
      },
    };
    vi.stubGlobal("figma", figmaMock);
    vi.stubGlobal("__html__", "");

    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["zh-CN"] });

    await vi.waitFor(() => {
      expect(posts).toContainEqual({ type: "locale", preference: "en", locale: "en" });
    });
  });

  it("persists a manual language change without reloading the selected source", async () => {
    const posts: unknown[] = [];
    const pending = deferred<Uint8Array>();
    const page = {
      type: "PAGE",
      selection: [] as unknown[],
      on: vi.fn(),
      off: vi.fn(),
    };
    const source = sourceNode("source", pending, page);
    page.selection = [source];
    const setAsync = vi.fn(async () => undefined);
    const figmaMock = {
      currentPage: page,
      clientStorage: {
        getAsync: vi.fn(async () => ({ version: 1, locale: "system" })),
        setAsync,
      },
      showUI: vi.fn(),
      on: vi.fn(),
      ui: {
        onmessage: undefined as ((message: unknown) => void) | undefined,
        postMessage: vi.fn((message: unknown) => posts.push(message)),
      },
    };
    vi.stubGlobal("figma", figmaMock);
    vi.stubGlobal("__html__", "");

    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["zh-CN"] });
    pending.resolve(new Uint8Array([1]));
    await vi.waitFor(() => expect(source.exportAsync).toHaveBeenCalledTimes(1));

    figmaMock.ui.onmessage?.({ type: "set-locale", preference: "en" });

    await vi.waitFor(() => {
      expect(setAsync).toHaveBeenCalledWith("perspective.preferences.v1", {
        version: 1,
        locale: "en",
      });
    });
    expect(posts).toContainEqual({ type: "locale", preference: "en", locale: "en" });
    expect(source.exportAsync).toHaveBeenCalledTimes(1);
    expect(page.selection).toEqual([source]);
  });

  it("invalidates an in-flight export as soon as a new selection is scheduled", async () => {
    vi.useFakeTimers();
    const handlers = new Map<string, () => void>();
    const posts: unknown[] = [];
    const pageHandlers = new Map<string, (event: unknown) => void>();
    const page = {
      type: "PAGE",
      selection: [] as unknown[],
      on: vi.fn((type: string, handler: (event: unknown) => void) => {
        pageHandlers.set(type, handler);
      }),
      off: vi.fn((type: string) => {
        pageHandlers.delete(type);
      }),
    };
    const firstBytes = deferred<Uint8Array>();
    const secondBytes = deferred<Uint8Array>();
    const first = sourceNode("first", firstBytes, page);
    const second = sourceNode("second", secondBytes, page);
    page.selection = [first];

    const figmaMock = {
      currentPage: page,
      showUI: vi.fn(),
      on: vi.fn((type: string, handler: () => void) => handlers.set(type, handler)),
      ui: {
        onmessage: undefined as ((message: unknown) => void) | undefined,
        postMessage: vi.fn((message: unknown) => posts.push(message)),
      },
    };
    vi.stubGlobal("figma", figmaMock);
    vi.stubGlobal("__html__", "");

    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"] });
    await flushMicrotasks();
    expect(first.exportAsync).toHaveBeenCalledTimes(1);
    expect(posts).toContainEqual({
      type: "selection-loading",
      generation: 1,
      nodeIds: ["first"],
    });

    page.selection = [second];
    handlers.get("selectionchange")?.();
    expect(posts).toContainEqual({
      type: "selection-loading",
      generation: 2,
      nodeIds: ["second"],
    });

    firstBytes.resolve(new Uint8Array([1]));
    await flushMicrotasks();
    expect(posts).not.toContainEqual(
      expect.objectContaining({ type: "source", generation: 1 }),
    );

    await vi.advanceTimersByTimeAsync(120);
    expect(second.exportAsync).toHaveBeenCalledTimes(1);
    secondBytes.resolve(new Uint8Array([2]));
    await flushMicrotasks();
    expect(posts).toContainEqual(
      expect.objectContaining({
        type: "source",
        generation: 2,
        payload: expect.objectContaining({ sourceNodeId: "second" }),
      }),
    );
  });

  it("turns a stalled native source export into a recoverable selection error", async () => {
    vi.useFakeTimers();
    const posts: unknown[] = [];
    const pending = deferred<Uint8Array>();
    const page = {
      type: "PAGE",
      selection: [] as unknown[],
      on: vi.fn(),
      off: vi.fn(),
    };
    const source = sourceNode("stalled", pending, page);
    page.selection = [source];
    const figmaMock = {
      currentPage: page,
      clientStorage: { getAsync: vi.fn(async () => undefined), setAsync: vi.fn() },
      showUI: vi.fn(),
      on: vi.fn(),
      ui: {
        onmessage: undefined as ((message: unknown) => void) | undefined,
        postMessage: vi.fn((message: unknown) => posts.push(message)),
      },
    };
    vi.stubGlobal("figma", figmaMock);
    vi.stubGlobal("__html__", "");

    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"] });
    await flushMicrotasks();
    expect(source.exportAsync).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    await flushMicrotasks();

    expect(posts).toContainEqual({
      type: "selection-error",
      generation: 1,
      message: { key: "sourceExportTimedOut" },
    });
    expect(posts).not.toContainEqual(expect.objectContaining({ type: "source" }));
  });

  it("re-exports the selected source at the requested final raster density", async () => {
    const posts: unknown[] = [];
    const initialBytes = deferred<Uint8Array>();
    const refreshedBytes = deferred<Uint8Array>();
    const page = {
      type: "PAGE",
      selection: [] as unknown[],
      on: vi.fn(),
      off: vi.fn(),
    };
    const source = sourceNode("source", initialBytes, page);
    page.selection = [source];
    const figmaMock = {
      currentPage: page,
      clientStorage: { getAsync: vi.fn(async () => undefined), setAsync: vi.fn() },
      showUI: vi.fn(),
      on: vi.fn(),
      getNodeByIdAsync: vi.fn(async (id: string) => (id === source.id ? source : null)),
      ui: {
        onmessage: undefined as ((message: unknown) => void) | undefined,
        postMessage: vi.fn((message: unknown) => posts.push(message)),
      },
    };
    vi.stubGlobal("figma", figmaMock);
    vi.stubGlobal("__html__", "");

    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"] });
    initialBytes.resolve(new Uint8Array([1]));
    await vi.waitFor(() => {
      expect(posts).toContainEqual(expect.objectContaining({ type: "source", generation: 1 }));
    });
    source.exportAsync.mockImplementationOnce(() => refreshedBytes.promise);

    figmaMock.ui.onmessage?.({
      type: "request-source-raster",
      generation: 1,
      requestId: 17,
      sourceNodeId: source.id,
      desiredWidth: 400,
      desiredHeight: 320,
    });
    await vi.waitFor(() => expect(source.exportAsync).toHaveBeenCalledTimes(2));
    expect(source.exportAsync).toHaveBeenLastCalledWith({
      format: "PNG",
      constraint: { type: "SCALE", value: 4 },
    });
    refreshedBytes.resolve(new Uint8Array([9, 8, 7]));

    await vi.waitFor(() => {
      expect(posts).toContainEqual({
        type: "source-raster",
        generation: 1,
        requestId: 17,
        bytes: new Uint8Array([9, 8, 7]),
      });
    });
  });

  it("rejects a refreshed raster if selection changes before native export finishes", async () => {
    const posts: unknown[] = [];
    const initialBytes = deferred<Uint8Array>();
    const refreshedBytes = deferred<Uint8Array>();
    const page = {
      type: "PAGE",
      selection: [] as unknown[],
      on: vi.fn(),
      off: vi.fn(),
    };
    const source = sourceNode("source", initialBytes, page);
    page.selection = [source];
    const figmaMock = {
      currentPage: page,
      clientStorage: { getAsync: vi.fn(async () => undefined), setAsync: vi.fn() },
      showUI: vi.fn(),
      on: vi.fn(),
      getNodeByIdAsync: vi.fn(async (id: string) => (id === source.id ? source : null)),
      ui: {
        onmessage: undefined as ((message: unknown) => void) | undefined,
        postMessage: vi.fn((message: unknown) => posts.push(message)),
      },
    };
    vi.stubGlobal("figma", figmaMock);
    vi.stubGlobal("__html__", "");

    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"] });
    initialBytes.resolve(new Uint8Array([1]));
    await vi.waitFor(() => {
      expect(posts).toContainEqual(expect.objectContaining({ type: "source", generation: 1 }));
    });
    source.exportAsync.mockImplementationOnce(() => refreshedBytes.promise);
    figmaMock.ui.onmessage?.({
      type: "request-source-raster",
      generation: 1,
      requestId: 18,
      sourceNodeId: source.id,
      desiredWidth: 400,
      desiredHeight: 320,
    });
    await vi.waitFor(() => expect(source.exportAsync).toHaveBeenCalledTimes(2));
    page.selection = [];
    refreshedBytes.resolve(new Uint8Array([9]));

    await vi.waitFor(() => {
      expect(posts).toContainEqual({
        type: "source-raster-error",
        generation: 1,
        requestId: 18,
        message: { key: "selectionChanged" },
      });
    });
    expect(posts).not.toContainEqual(
      expect.objectContaining({ type: "source-raster", requestId: 18 }),
    );
  });

  it("applies for free without a Payments API while preserving source selection", async () => {
    const operations: string[] = [];
    const pageHandlers = new Map<string, (event: unknown) => void>();
    const pending = deferred<Uint8Array>();
    const page = {
      type: "PAGE",
      selection: [] as unknown[],
      on: vi.fn((type: string, handler: (event: unknown) => void) => {
        pageHandlers.set(type, handler);
      }),
      off: vi.fn(),
    };
    const source = sourceNode("source", pending, page);
    page.selection = [source];
    // A hidden layer inside the result band must not push the result around.
    const hidden = {
      id: "hidden",
      type: "RECTANGLE",
      visible: false,
      absoluteBoundingBox: { x: 150, y: 0, width: 100, height: 80 },
    };
    Object.assign(page, { children: [source, hidden] });
    const result = {
      id: "result",
      name: "",
      type: "RECTANGLE",
      fills: [] as unknown[],
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      resize: vi.fn(function (this: { width: number; height: number }, width: number, height: number) {
        this.width = width;
        this.height = height;
      }),
      setSharedPluginData: vi.fn(),
      setPluginData: vi.fn(),
      getSharedPluginData: vi.fn(() => ""),
      getPluginData: vi.fn(() => ""),
      remove: vi.fn(),
    };
    const posts: unknown[] = [];
    const figmaMock = {
      currentPage: page,
      mixed: Symbol("mixed"),
      showUI: vi.fn(),
      on: vi.fn(),
      getNodeByIdAsync: vi.fn(async (id: string) => (id === source.id ? source : null)),
      createImage: vi.fn(() => {
        operations.push("create-image");
        return { hash: "image-hash" };
      }),
      createRectangle: vi.fn(() => result),
      commitUndo: vi.fn(() => operations.push("commit-undo")),
      viewport: { scrollAndZoomIntoView: vi.fn(() => operations.push("scroll")) },
      notify: vi.fn(() => operations.push("notify")),
      ui: {
        onmessage: undefined as ((message: unknown) => void) | undefined,
        postMessage: vi.fn((message: unknown) => posts.push(message)),
      },
    };
    vi.stubGlobal("figma", figmaMock);
    vi.stubGlobal("__html__", "");

    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"] });
    pending.resolve(new Uint8Array([1]));
    await vi.waitFor(() => {
      expect(posts).toContainEqual(expect.objectContaining({ type: "source", generation: 1 }));
    });
    figmaMock.ui.onmessage?.({
      type: "apply",
      payload: {
        generation: 1,
        bytes: new Uint8Array([1]),
        spec: identitySpec(),
        sourceNodeId: source.id,
        renderWidth: 100,
        renderHeight: 80,
        placement: { x: 25, y: -10, width: 120, height: 96 },
      },
    });
    await vi.waitFor(() => expect(operations, JSON.stringify(posts)).toHaveLength(5));

    expect(operations).toEqual([
      "commit-undo",
      "create-image",
      "scroll",
      "notify",
      "commit-undo",
    ]);
    expect(posts).toContainEqual(
      expect.objectContaining({ type: "apply-complete", operation: "apply" }),
    );
    expect(result.resize).toHaveBeenCalledWith(120, 96);
    expect(result).toMatchObject({ x: 148, y: 0, width: 120, height: 96 });
    expect(figmaMock.viewport.scrollAndZoomIntoView).toHaveBeenCalledWith([result, source]);
    expect(page.selection).toEqual([source]);
  });

  it("applies a duplicate beside a selected pair without mutating the existing result", async () => {
    const pending = deferred<Uint8Array>();
    const posts: unknown[] = [];
    const page = {
      type: "PAGE",
      selection: [] as unknown[],
      on: vi.fn(),
      off: vi.fn(),
    };
    const source = sourceNode("source", pending, page);
    const target = {
      id: "target",
      name: "source · Worldbend",
      type: "RECTANGLE",
      visible: true,
      parent: page,
      fills: [{ type: "IMAGE", imageHash: "old", scaleMode: "FILL" }],
      width: 100,
      height: 80,
      x: 10,
      y: 20,
      absoluteBoundingBox: { x: 10, y: 20, width: 100, height: 80 },
      resize: vi.fn(),
      getSharedPluginData: vi.fn((_namespace: string, key: string) =>
        key === "transform" ? JSON.stringify(identitySpec()) : "",
      ),
      setSharedPluginData: vi.fn(),
      getPluginData: vi.fn(() => ""),
      setPluginData: vi.fn(),
    };
    const duplicate = {
      id: "duplicate",
      name: "",
      type: "RECTANGLE",
      fills: [] as unknown[],
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      resize: vi.fn(function (
        this: { width: number; height: number },
        width: number,
        height: number,
      ) {
        this.width = width;
        this.height = height;
      }),
      setSharedPluginData: vi.fn(),
      setPluginData: vi.fn(),
      getSharedPluginData: vi.fn(() => ""),
      getPluginData: vi.fn(() => ""),
      remove: vi.fn(),
    };
    page.selection = [source, target];
    Object.assign(page, { children: [source, target] });
    const figmaMock = {
      currentPage: page,
      mixed: Symbol("mixed"),
      clientStorage: { getAsync: vi.fn(async () => undefined), setAsync: vi.fn() },
      showUI: vi.fn(),
      on: vi.fn(),
      getNodeByIdAsync: vi.fn(async (id: string) =>
        id === source.id ? source : id === target.id ? target : null,
      ),
      createImage: vi.fn(() => ({ hash: "new-image" })),
      createRectangle: vi.fn(() => duplicate),
      commitUndo: vi.fn(),
      viewport: { scrollAndZoomIntoView: vi.fn() },
      notify: vi.fn(),
      ui: {
        onmessage: undefined as ((message: unknown) => void) | undefined,
        postMessage: vi.fn((message: unknown) => posts.push(message)),
      },
    };
    vi.stubGlobal("figma", figmaMock);
    vi.stubGlobal("__html__", "");

    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"] });
    pending.resolve(new Uint8Array([1]));
    await vi.waitFor(() => {
      expect(posts).toContainEqual(expect.objectContaining({ type: "source", generation: 1 }));
    });
    figmaMock.ui.onmessage?.({
      type: "apply",
      payload: {
        generation: 1,
        bytes: new Uint8Array([2]),
        spec: identitySpec(),
        sourceNodeId: source.id,
        targetNodeId: target.id,
        duplicate: true,
        renderWidth: 100,
        renderHeight: 80,
        placement: { x: -30, y: 5, width: 120, height: 96 },
      },
    });

    await vi.waitFor(() => {
      expect(posts).toContainEqual(
        expect.objectContaining({ type: "apply-complete", operation: "apply" }),
      );
    });
    expect(target.resize).not.toHaveBeenCalled();
    expect(target.fills).toEqual([{ type: "IMAGE", imageHash: "old", scaleMode: "FILL" }]);
    expect(figmaMock.createRectangle).toHaveBeenCalledTimes(1);
    expect(duplicate).toMatchObject({ x: 158, y: 0, width: 120, height: 96 });
    expect(figmaMock.viewport.scrollAndZoomIntoView).toHaveBeenCalledWith([duplicate, source, target]);
  });

  it("replaces a large result without conflating document placement and raster density", async () => {
    const pending = deferred<Uint8Array>();
    const posts: unknown[] = [];
    const page = {
      type: "PAGE",
      selection: [] as unknown[],
      on: vi.fn(),
      off: vi.fn(),
    };
    const source = sourceNode("source", pending, page);
    const sharedData = new Map<string, string>();
    sharedData.set("worldbend:transform", JSON.stringify(identitySpec()));
    const privateData = new Map<string, string>();
    privateData.set("worldbend.renderWidth", "4096");
    privateData.set("worldbend.renderHeight", "3277");
    const target = {
      id: "target",
      name: "source · Worldbend",
      type: "RECTANGLE",
      visible: true,
      parent: page,
      fills: [{ type: "IMAGE", imageHash: "old", scaleMode: "FILL" }],
      width: 5000,
      height: 4000,
      x: 10,
      y: 20,
      absoluteBoundingBox: { x: 10, y: 20, width: 5000, height: 4000 },
      resize: vi.fn(function (
        this: { width: number; height: number },
        width: number,
        height: number,
      ) {
        this.width = width;
        this.height = height;
      }),
      getSharedPluginData: vi.fn(
        (namespace: string, key: string) => sharedData.get(`${namespace}:${key}`) ?? "",
      ),
      setSharedPluginData: vi.fn((namespace: string, key: string, value: string) => {
        sharedData.set(`${namespace}:${key}`, value);
      }),
      getPluginData: vi.fn((key: string) => privateData.get(key) ?? ""),
      setPluginData: vi.fn((key: string, value: string) => privateData.set(key, value)),
    };
    page.selection = [source, target];
    const figmaMock = {
      currentPage: page,
      mixed: Symbol("mixed"),
      clientStorage: { getAsync: vi.fn(async () => undefined), setAsync: vi.fn() },
      showUI: vi.fn(),
      on: vi.fn(),
      getNodeByIdAsync: vi.fn(async (id: string) =>
        id === source.id ? source : id === target.id ? target : null,
      ),
      createImage: vi.fn(() => ({ hash: "new-image" })),
      createRectangle: vi.fn(),
      commitUndo: vi.fn(),
      viewport: { scrollAndZoomIntoView: vi.fn() },
      notify: vi.fn(),
      ui: {
        onmessage: undefined as ((message: unknown) => void) | undefined,
        postMessage: vi.fn((message: unknown) => posts.push(message)),
      },
    };
    vi.stubGlobal("figma", figmaMock);
    vi.stubGlobal("__html__", "");

    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"] });
    pending.resolve(new Uint8Array([1]));
    await vi.waitFor(() => {
      expect(posts).toContainEqual(expect.objectContaining({ type: "source", generation: 1 }));
    });
    figmaMock.ui.onmessage?.({
      type: "apply",
      payload: {
        generation: 1,
        bytes: new Uint8Array([2]),
        spec: identitySpec(),
        sourceNodeId: source.id,
        targetNodeId: target.id,
        renderWidth: 4000,
        renderHeight: 3200,
        placement: { x: -30, y: 5, width: 5200, height: 4160 },
      },
    });

    await vi.waitFor(() => {
      expect(posts).toContainEqual(
        expect.objectContaining({ type: "apply-complete", operation: "replace" }),
      );
    });
    expect(target.resize).toHaveBeenCalledWith(5200, 4160);
    expect(target).toMatchObject({ x: -30, y: 5, width: 5200, height: 4160 });
    expect(privateData.get("worldbend.renderWidth")).toBe("4000");
    expect(privateData.get("worldbend.renderHeight")).toBe("3200");
  });

  it("maps a replacement's absolute placement into its frame coordinates", async () => {
    const pending = deferred<Uint8Array>();
    const posts: unknown[] = [];
    const page = {
      type: "PAGE",
      selection: [] as unknown[],
      on: vi.fn(),
      off: vi.fn(),
    };
    const source = sourceNode("source", pending, page);
    const frame = {
      id: "frame",
      type: "FRAME",
      absoluteTransform: [
        [1, 0, 100],
        [0, 1, 200],
      ],
    };
    const sharedData = new Map<string, string>();
    sharedData.set("worldbend:transform", JSON.stringify(identitySpec()));
    const privateData = new Map<string, string>();
    const target = {
      id: "target",
      name: "source · Worldbend",
      type: "RECTANGLE",
      visible: true,
      parent: frame,
      fills: [{ type: "IMAGE", imageHash: "old", scaleMode: "FILL" }],
      width: 100,
      height: 80,
      // Parent-relative coordinates inside a frame offset from the origin.
      x: 10,
      y: 20,
      absoluteBoundingBox: { x: 110, y: 220, width: 100, height: 80 },
      resize: vi.fn(),
      getSharedPluginData: vi.fn(
        (namespace: string, key: string) => sharedData.get(`${namespace}:${key}`) ?? "",
      ),
      setSharedPluginData: vi.fn((namespace: string, key: string, value: string) => {
        sharedData.set(`${namespace}:${key}`, value);
      }),
      getPluginData: vi.fn((key: string) => privateData.get(key) ?? ""),
      setPluginData: vi.fn((key: string, value: string) => privateData.set(key, value)),
    };
    page.selection = [source, target];
    const figmaMock = {
      currentPage: page,
      mixed: Symbol("mixed"),
      clientStorage: { getAsync: vi.fn(async () => undefined), setAsync: vi.fn() },
      showUI: vi.fn(),
      on: vi.fn(),
      getNodeByIdAsync: vi.fn(async (id: string) =>
        id === source.id ? source : id === target.id ? target : null,
      ),
      createImage: vi.fn(() => ({ hash: "new-image" })),
      createRectangle: vi.fn(),
      commitUndo: vi.fn(),
      viewport: { scrollAndZoomIntoView: vi.fn() },
      notify: vi.fn(),
      ui: {
        onmessage: undefined as ((message: unknown) => void) | undefined,
        postMessage: vi.fn((message: unknown) => posts.push(message)),
      },
    };
    vi.stubGlobal("figma", figmaMock);
    vi.stubGlobal("__html__", "");

    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"] });
    pending.resolve(new Uint8Array([1]));
    await vi.waitFor(() => {
      expect(posts).toContainEqual(expect.objectContaining({ type: "source", generation: 1 }));
    });
    figmaMock.ui.onmessage?.({
      type: "apply",
      payload: {
        generation: 1,
        bytes: new Uint8Array([2]),
        spec: identitySpec(),
        sourceNodeId: source.id,
        targetNodeId: target.id,
        renderWidth: 100,
        renderHeight: 80,
        // Absolute placement of the tight frame; writing this into x/y would
        // teleport the node by the frame's (100, 200) origin offset.
        placement: { x: 130, y: 250, width: 100, height: 80 },
      },
    });

    await vi.waitFor(() => {
      expect(posts).toContainEqual(
        expect.objectContaining({ type: "apply-complete", operation: "replace" }),
      );
    });
    expect(target).toMatchObject({ x: 30, y: 50, width: 100, height: 80 });
    expect(target.fills).toEqual([{ type: "IMAGE", imageHash: "new-image", scaleMode: "FILL" }]);
    expect(privateData.get("worldbend.renderWidth")).toBe("100");
  });

  it("routes an applied-state undo shortcut to the Figma document", async () => {
    const page = {
      type: "PAGE",
      selection: [] as unknown[],
      on: vi.fn(),
      off: vi.fn(),
    };
    const figmaMock = {
      currentPage: page,
      clientStorage: { getAsync: vi.fn(async () => undefined), setAsync: vi.fn() },
      showUI: vi.fn(),
      on: vi.fn(),
      triggerUndo: vi.fn(),
      ui: {
        onmessage: undefined as ((message: unknown) => void) | undefined,
        postMessage: vi.fn(),
      },
    };
    vi.stubGlobal("figma", figmaMock);
    vi.stubGlobal("__html__", "");

    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"] });
    await vi.waitFor(() => expect(figmaMock.ui.postMessage).toHaveBeenCalled());

    figmaMock.ui.onmessage?.({ type: "trigger-undo" });

    expect(figmaMock.triggerUndo).toHaveBeenCalledTimes(1);
  });
});
