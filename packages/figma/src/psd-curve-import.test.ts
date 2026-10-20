import { afterEach, describe, expect, it, vi } from "vitest";
import initPsdImportWasm, { psd_smart_objects_json } from "./psd-import-wasm-runtime";
import {
  PSD_IMPORT_SOURCE_LIMIT_BYTES,
  PSD_UNSUPPORTED_REASON_LABELS,
  createPsdCurveImport,
  createWorkerPsdImportEngine,
  psdUnsupportedDetail,
  type PsdCurveWorkPlanWire,
  type PsdImportEngine,
  type PsdInspectionWire,
} from "./psd-curve-import";

vi.mock("./psd-import-wasm-runtime", () => ({
  default: vi.fn(),
  psd_smart_objects_json: vi.fn(),
}));

/** Minimal element stub covering the operations the import panel uses. */
class FakeElement {
  children: FakeElement[] = [];
  listeners = new Map<string, Array<() => void>>();
  dataset: Record<string, string> = {};
  hidden = false;
  disabled = false;
  textContent = "";
  className = "";
  type = "";
  value = "";
  role = "";
  files: { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }[] = [];
  accept = "";
  parent: FakeElement | undefined;
  append(...nodes: (FakeElement | string)[]) {
    for (const node of nodes) {
      if (typeof node === "string") continue;
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes: FakeElement[]) {
    for (const child of this.children) child.parent = undefined;
    this.children = [...nodes];
    for (const node of nodes) node.parent = this;
  }
  remove() {
    this.parent?.replaceChildren(...(this.parent?.children.filter(child => child !== this) ?? []));
  }
  addEventListener(name: string, handler: () => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), handler]);
  }
  dispatch(name: string) {
    for (const handler of this.listeners.get(name) ?? []) handler();
  }
  click() {
    this.dispatch("click");
  }
  setAttribute(name: string, value: string) {
    this.dataset[name] = value;
  }
  query(): FakeElement[] {
    return [...this.children.flatMap(child => [child, ...child.query()])];
  }
  buttons(): FakeElement[] {
    return this.query().filter(node => node.type === "button");
  }
  byText(text: string): FakeElement | undefined {
    return this.buttons().find(node => node.textContent === text);
  }
}

function inspection(objects: { id: string; status: string }[]): PsdInspectionWire {
  return {
    schema: "worldbend.psd-smart-object-inspection",
    version: "0.1",
    source: { format: "psd", bytes: 3, sha256: "0".repeat(64), document: { width: 100, height: 100 } },
    visitedLayerCount: 1,
    smartObjects: objects.map(object => ({
      id: object.id,
      layerPath: [object.id],
      name: object.id,
      importability: object.status === "curveEligible"
        ? { status: "curveEligible" }
        : object.status === "eligible"
          ? { status: "eligible" }
          : { status: "unsupported", reasons: [{ reason: "nonNeutralWarp" }] },
    })),
  };
}

function plan(objectId: string): PsdCurveWorkPlanWire {
  return {
    schema: "worldbend.psd-curve-work-plan",
    version: "0.1",
    smartObjectId: objectId,
    name: objectId,
    source: { format: "psd", bytes: 4648, sha256: "0".repeat(64), document: { width: 100, height: 100 } },
    layerPath: [objectId],
    curve: {
      uOrder: 4, vOrder: 4,
      envelope: { left: 0, top: 0, right: 96, bottom: 64 },
      controls: Array.from({ length: 16 }, (_, index) => ({ x: (index % 4) / 3, y: Math.floor(index / 4) / 3 })),
    },
    work: { schema: "worldbend.deformation-work", version: "0.1" },
    provenance: {
      controlBbox: { left: 0, top: 0, right: 96, bottom: 64 },
      bboxMatchesEnvelope: true,
      boundary: "fixed",
      snappedCoordinates: 4,
    },
    losses: [],
  };
}

function stubDocument() {
  const host = new FakeElement();
  vi.stubGlobal("document", {
    createElement: () => new FakeElement(),
    activeElement: undefined,
  });
  return host;
}

function fakeEngine(objects: { id: string; status: string }[]) {
  return {
    inspect: vi.fn(async () => inspection(objects)),
    planCurveWork: vi.fn(async (_bytes: Uint8Array, id: string) => plan(id)),
    cancel: vi.fn(),
    dispose: vi.fn(),
  };
}

const copy = () => ({
  trigger: "Use curve from PSD", hint: "hint", pick: "Choose PSD or PSB", reading: "Reading",
  objectsIn: "Smart objects in {name}", eligible: "Curve", unsupported: "Not importable",
  adopt: "Use this curve", adopting: "Preparing…", cancel: "Cancel", empty: "No smart objects.",
  tooLarge: "too large",
});

afterEach(() => vi.unstubAllGlobals());

describe("PSD curve import panel", () => {
  it("lists objects with their importability and adopts the selected curve", async () => {
    const host = stubDocument();
    const engine = fakeEngine([{ id: "curve", status: "curveEligible" }, { id: "plain", status: "unsupported" }]);
    const adopted: string[] = [];
    const controller = createPsdCurveImport({
      host: host as unknown as HTMLElement, copy, engine,
      onAdopt: adoptedPlan => { adopted.push(adoptedPlan.smartObjectId); },
      formatError: error => String(error),
    });
    controller.begin();
    // begin() opens the hidden file input; simulate a chosen file.
    const input = host.query().find(node => node.type === "file")!;
    input.files = [{ name: "poster.psd", size: 3, arrayBuffer: async () => new ArrayBuffer(3) }];
    input.dispatch("change");
    await vi.waitFor(() => expect(host.byText("Use this curve")).toBeTruthy());
    const row = host.query().find(node => node.dataset.objectId === "plain")!;
    expect(row.disabled).toBe(true);
    host.byText("Use this curve")!.dispatch("click");
    await vi.waitFor(() => expect(adopted).toEqual(["curve"]));
    expect(engine.planCurveWork).toHaveBeenCalledWith(expect.any(Uint8Array), "curve");
    expect(controller.active()).toBe(false);
  });

  it("reports oversized files without calling the engine", async () => {
    const host = stubDocument();
    const engine = fakeEngine([]);
    const controller = createPsdCurveImport({
      host: host as unknown as HTMLElement, copy, engine, onAdopt: () => {}, formatError: error => String(error),
    });
    controller.begin();
    const input = host.query().find(node => node.type === "file")!;
    input.files = [{ name: "huge.psd", size: PSD_IMPORT_SOURCE_LIMIT_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(0) }];
    input.dispatch("change");
    await vi.waitFor(() => expect(host.query().some(node => node.textContent === "too large")).toBe(true));
    expect(engine.inspect).not.toHaveBeenCalled();
  });

  it("shows inspection failures with a retry and never adopts", async () => {
    const host = stubDocument();
    const engine = fakeEngine([]);
    engine.inspect.mockRejectedValueOnce(Error("bad document"));
    createPsdCurveImport({
      host: host as unknown as HTMLElement, copy, engine, onAdopt: () => {}, formatError: error => String(error),
    }).begin();
    const input = host.query().find(node => node.type === "file")!;
    input.files = [{ name: "x.psd", size: 2, arrayBuffer: async () => new ArrayBuffer(2) }];
    input.dispatch("change");
    await vi.waitFor(() => expect(host.query().some(node => node.textContent.includes("bad document"))).toBe(true));
    expect(host.byText("Choose PSD or PSB")).toBeTruthy();
  });

  it("resets on leave: pending reads never adopt and the engine is cancelled", async () => {
    const host = stubDocument();
    let resolveInspect: (value: PsdInspectionWire) => void = () => {};
    const engine: PsdImportEngine = {
      inspect: () => new Promise(resolve => { resolveInspect = resolve; }),
      planCurveWork: vi.fn(async () => plan("curve")),
      cancel: vi.fn(),
      dispose: vi.fn(),
    };
    const adopted: string[] = [];
    const controller = createPsdCurveImport({
      host: host as unknown as HTMLElement, copy, engine, onAdopt: value => { adopted.push(value.smartObjectId); }, formatError: error => String(error),
    });
    controller.begin();
    const input = host.query().find(node => node.type === "file")!;
    input.files = [{ name: "x.psd", size: 2, arrayBuffer: async () => new ArrayBuffer(2) }];
    input.dispatch("change");
    controller.leave();
    resolveInspect(inspection([{ id: "curve", status: "curveEligible" }]));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(adopted).toEqual([]);
    expect(engine.cancel).toHaveBeenCalled();
    expect(controller.active()).toBe(false);
  });

  it("does not start parsing after a cancelled file read completes", async () => {
    const host = stubDocument();
    const engine = fakeEngine([]);
    let finishRead!: (bytes: ArrayBuffer) => void;
    const controller = createPsdCurveImport({
      host: host as unknown as HTMLElement, copy, engine, onAdopt() {}, formatError: String,
    });
    controller.begin();
    const input = host.query().find(node => node.type === "file")!;
    input.files = [{ name: "x.psd", size: 2, arrayBuffer: () => new Promise(resolve => { finishRead = resolve; }) }];
    input.dispatch("change");
    controller.leave();
    finishRead(new ArrayBuffer(2));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(engine.inspect).not.toHaveBeenCalled();
  });

  it("keeps cancel available during planning and discards the cancelled plan", async () => {
    const host = stubDocument();
    const engine = fakeEngine([{ id: "curve", status: "curveEligible" }]);
    let finishPlan!: (value: PsdCurveWorkPlanWire) => void;
    engine.planCurveWork.mockImplementationOnce(() => new Promise(resolve => { finishPlan = resolve; }));
    const onAdopt = vi.fn();
    const controller = createPsdCurveImport({
      host: host as unknown as HTMLElement, copy, engine, onAdopt, formatError: String,
    });
    controller.begin();
    const input = host.query().find(node => node.type === "file")!;
    input.files = [{ name: "x.psd", size: 2, arrayBuffer: async () => new ArrayBuffer(2) }];
    input.dispatch("change");
    await vi.waitFor(() => expect(host.byText("Use this curve")).toBeTruthy());
    host.byText("Use this curve")!.click();
    expect(host.byText("Cancel")).toBeTruthy();
    host.byText("Cancel")!.click();
    finishPlan(plan("curve"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(onAdopt).not.toHaveBeenCalled();
    expect(controller.active()).toBe(false);
  });

  it("reports asynchronous editor failures instead of closing with false success", async () => {
    const host = stubDocument();
    const engine = fakeEngine([{ id: "curve", status: "curveEligible" }]);
    createPsdCurveImport({
      host: host as unknown as HTMLElement, copy, engine,
      onAdopt: async () => { throw Error("invalid curve"); }, formatError: String,
    }).begin();
    const input = host.query().find(node => node.type === "file")!;
    input.files = [{ name: "x.psd", size: 2, arrayBuffer: async () => new ArrayBuffer(2) }];
    input.dispatch("change");
    await vi.waitFor(() => expect(host.byText("Use this curve")).toBeTruthy());
    host.byText("Use this curve")!.click();
    await vi.waitFor(() => expect(host.query().some(node => node.textContent.includes("invalid curve"))).toBe(true));
    expect(host.byText("Choose PSD or PSB")).toBeTruthy();
  });
});

describe("PSD import worker engine", () => {
  function fakeWorkerFactory() {
    const workers: FakeWorker[] = [];
    class FakeWorker {
      listeners = new Map<string, Array<(event: { data: unknown }) => void>>();
      posted: unknown[] = [];
      terminated = false;
      constructor() { workers.push(this); }
      addEventListener(name: string, handler: (event: { data: unknown }) => void) {
        this.listeners.set(name, [...(this.listeners.get(name) ?? []), handler]);
      }
      postMessage(message: unknown) { this.posted.push(message); }
      terminate() { this.terminated = true; }
      reply(data: unknown) {
        for (const handler of this.listeners.get("message") ?? []) handler({ data });
      }
      /** Simulates an async script-load refusal, e.g. a host CSP that blocks
       * blob workers: no constructor throw, no reply, just an error event. */
      fail() {
        for (const handler of this.listeners.get("error") ?? []) handler({ data: undefined });
      }
    }
    return { workers, factory: () => new FakeWorker() as unknown as Worker };
  }

  it("initializes the worker with the compressed payload and correlates replies by request", async () => {
    const { workers, factory } = fakeWorkerFactory();
    const engine = createWorkerPsdImportEngine(factory);
    const pending = engine.inspect(new Uint8Array([1, 2, 3]));
    const worker = workers[0]!;
    expect(worker.posted[0]).toEqual({ kind: "psd-import-init", compressed: expect.any(String) });
    const request = worker.posted[1] as { kind: string; requestId: number; bytes: ArrayBuffer };
    expect(request.kind).toBe("psd-smart-object-request");
    expect(new Uint8Array(request.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    worker.reply({ kind: "psd-import-ready" });
    // A reply with the wrong id never resolves the request.
    worker.reply({ kind: "psd-smart-object-reply", requestId: request.requestId + 5, ok: true, responseJson: "{}" });
    worker.reply({
      kind: "psd-smart-object-reply", requestId: request.requestId, ok: true,
      responseJson: JSON.stringify({ result: "inspection", inspection: inspection([{ id: "a", status: "eligible" }]) }),
    });
    const resolved = await pending;
    expect(resolved.smartObjects[0]!.id).toBe("a");
  });

  it("cancel rejects pending work and the next request uses a fresh worker", async () => {
    const { workers, factory } = fakeWorkerFactory();
    const engine = createWorkerPsdImportEngine(factory);
    const pending = engine.inspect(new Uint8Array([1]));
    const first = workers[0]!;
    engine.cancel();
    await expect(pending).rejects.toThrow("psd-import-cancelled");
    expect(first.terminated).toBe(true);
    void engine.inspect(new Uint8Array([2]));
    expect(workers[1]!.posted[0]).toEqual({ kind: "psd-import-init", compressed: expect.any(String) });
  });

  it("surfaces worker failures as errors", async () => {
    const { workers, factory } = fakeWorkerFactory();
    const engine = createWorkerPsdImportEngine(factory);
    const pending = engine.inspect(new Uint8Array([1]));
    const worker = workers[0]!;
    const request = worker.posted[1] as { requestId: number };
    worker.reply({ kind: "psd-smart-object-reply", requestId: request.requestId, ok: false, message: "boom" });
    await expect(pending).rejects.toThrow("boom");
  });

  it("falls back to the UI thread when the worker fails to load and never retries a worker", async () => {
    const { workers, factory } = fakeWorkerFactory();
    vi.mocked(psd_smart_objects_json)
      .mockClear()
      .mockResolvedValue(JSON.stringify({ result: "inspection", inspection: inspection([{ id: "main", status: "curveEligible" }]) }));
    const engine = createWorkerPsdImportEngine(factory);
    const pending = engine.inspect(new Uint8Array([1, 2, 3]));
    const worker = workers[0]!;
    worker.fail();
    const resolved = await pending;
    expect(resolved.smartObjects[0]!.id).toBe("main");
    expect(worker.terminated).toBe(true);
    expect(psd_smart_objects_json).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), expect.any(String));
    expect(initPsdImportWasm).toHaveBeenCalled();
    // The refused host stays refused: later requests never build another worker.
    await engine.inspect(new Uint8Array([4]));
    expect(workers.length).toBe(1);
  });

  it("does not replay a running worker's failure on the UI thread", async () => {
    const { workers, factory } = fakeWorkerFactory();
    vi.mocked(psd_smart_objects_json).mockClear();
    const engine = createWorkerPsdImportEngine(factory);
    const pending = engine.inspect(new Uint8Array([1]));
    workers[0]!.reply({ kind: "psd-import-ready" });
    workers[0]!.fail();
    await expect(pending).rejects.toThrow("psd-import-worker-failed");
    expect(psd_smart_objects_json).not.toHaveBeenCalled();
  });

  it("rejects a superseded request and ignores its worker's late reply", async () => {
    const { workers, factory } = fakeWorkerFactory();
    const engine = createWorkerPsdImportEngine(factory);
    const first = engine.inspect(new Uint8Array([1]));
    const second = engine.inspect(new Uint8Array([2]));
    await expect(first).rejects.toThrow("psd-import-cancelled");
    const stale = workers[0]!.posted[1] as { requestId: number };
    workers[0]!.reply({ kind: "psd-smart-object-reply", requestId: stale.requestId, ok: true, responseJson: "{}" });
    const current = workers[1]!.posted[1] as { requestId: number };
    workers[1]!.reply({ kind: "psd-smart-object-reply", requestId: current.requestId, ok: true,
      responseJson: JSON.stringify({ result: "inspection", inspection: inspection([{ id: "new", status: "curveEligible" }]) }) });
    expect((await second).smartObjects[0]!.id).toBe("new");
  });
});

describe("unsupported smart-object reasons", () => {
  const copy = {
    unsupported: "Not importable",
    unsupportedReasons: PSD_UNSUPPORTED_REASON_LABELS.en,
  } as unknown as Parameters<typeof psdUnsupportedDetail>[1];

  it("lists the interop rejection reasons instead of one generic label", () => {
    expect(psdUnsupportedDetail([{ reason: "quiltWarp" }], copy)).toBe("quilt warp");
    expect(
      psdUnsupportedDetail([{ reason: "missingSourceSize" }, { reason: "invalidQuad" }], copy),
    ).toBe("missing source size · invalid placement quad");
    expect(psdUnsupportedDetail([{ reason: "conflictingWarpBlocks" }], copy)).toBe(
      "conflicting warp sources",
    );
  });

  it("falls back to the generic label for unknown or absent reasons", () => {
    expect(psdUnsupportedDetail([{ reason: "somethingNew" }], copy)).toBe("Not importable");
    expect(psdUnsupportedDetail(undefined, copy)).toBe("Not importable");
    expect(psdUnsupportedDetail([], copy)).toBe("Not importable");
  });
});
