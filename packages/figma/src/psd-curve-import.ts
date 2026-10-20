import PsdImportWorker from "./psd-import-worker?worker&inline";
import type { PsdImportWorkerReply, PsdImportWorkerRequest } from "./psd-import-worker";
import compressedPsdImportWasm from "virtual:worldbend-psd-import-wasm-gzip";
import type { FigmaPsdAdoption } from "./stored-designer-task";
import { PSD_IMPORT_SOURCE_LIMIT_BYTES } from "./psd-limits";

export { PSD_IMPORT_SOURCE_LIMIT_BYTES } from "./psd-limits";

/** Wire shapes of `worldbend.psd-smart-object-*`; the owning grammar stays in
 * the interop crate and its generated schema. */
export interface PsdCurveFactsWire {
  uOrder: number;
  vOrder: number;
  envelope: { left: number; top: number; right: number; bottom: number };
  controls: { x: number; y: number }[];
}

export interface PsdSmartObjectRecordWire {
  id: string;
  layerPath: string[];
  name: string;
  photoshopLayerId?: number;
  linkedAssetId?: string;
  curve?: PsdCurveFactsWire;
  importability:
    | { status: "eligible" }
    | { status: "curveEligible" }
    | { status: "unsupported"; reasons: { reason: string }[] };
}

export interface PsdInspectionWire {
  schema: string;
  version: string;
  source: { format: string; bytes: number; sha256: string; document: { width: number; height: number } };
  visitedLayerCount: number;
  smartObjects: PsdSmartObjectRecordWire[];
}

export interface PsdCurveWorkPlanWire {
  schema: string;
  version: string;
  smartObjectId: string;
  name: string;
  source: {
    format: string;
    bytes: number;
    sha256: string;
    document: { width: number; height: number };
  };
  layerPath?: string[];
  photoshopLayerId?: number;
  linkedAssetId?: string;
  curve: PsdCurveFactsWire;
  work: Record<string, unknown>;
  provenance: {
    controlBbox: { left: number; top: number; right: number; bottom: number };
    bboxMatchesEnvelope: boolean;
    boundary: "fixed" | "free";
    snappedCoordinates: number;
  };
  losses: string[];
}

/** Adapter-level adoption record for one planned curve: PSD source identity,
 * the adopted object, and the core's adoption decisions. Persisted with the
 * deformation task so later edits and reopens keep the origin; never carries
 * PSD bytes or local paths. */
export function psdAdoptionFromPlan(plan: PsdCurveWorkPlanWire): FigmaPsdAdoption {
  return {
    kind: "psd-adoption",
    source: {
      format: plan.source.format === "psb" ? "psb" : "psd",
      bytes: plan.source.bytes,
      sha256: plan.source.sha256,
      document: { ...plan.source.document },
    },
    smartObjectId: plan.smartObjectId,
    layerPath: plan.layerPath?.slice(0, 32) ?? [plan.name],
    name: plan.name,
    ...(plan.photoshopLayerId !== undefined ? { photoshopLayerId: plan.photoshopLayerId } : {}),
    ...(plan.linkedAssetId ? { linkedAssetId: plan.linkedAssetId } : {}),
    curve: {
      uOrder: plan.curve.uOrder,
      vOrder: plan.curve.vOrder,
      envelope: { ...plan.curve.envelope },
    },
    provenance: {
      controlBbox: { ...plan.provenance.controlBbox },
      bboxMatchesEnvelope: plan.provenance.bboxMatchesEnvelope,
      boundary: plan.provenance.boundary,
      snappedCoordinates: plan.provenance.snappedCoordinates,
    },
    losses: plan.losses.slice(0, 16),
  };
}

export interface PsdImportEngine {
  inspect(bytes: Uint8Array): Promise<PsdInspectionWire>;
  planCurveWork(bytes: Uint8Array, smartObjectId: string): Promise<PsdCurveWorkPlanWire>;
  /** Drop the running worker; the next request starts a fresh one. */
  cancel(): void;
  dispose(): void;
}

function psdRequestJson(action: Record<string, unknown>): string {
  return JSON.stringify({
    schema: "worldbend.psd-smart-object-request",
    version: "0.1",
    action,
  });
}

function parseReplyJson(responseJson: string): { result: string } & Record<string, unknown> {
  const parsed = JSON.parse(responseJson) as { result?: string };
  if (typeof parsed.result !== "string") throw Error("PSD import reply carries no result tag");
  return parsed as { result: string } & Record<string, unknown>;
}

/** Set when a worker was refused (constructor throw or a script-load error
 * such as a host CSP that blocks blob workers); the request then reruns on
 * the UI thread through the same interface. */
const WORKER_UNAVAILABLE = "psd-import-worker-unavailable";

/** The import engine: one cancellable worker request at a time. Hosts that
 * refuse worker creation — synchronously or through an async script-load
 * error — still import through the UI thread. */
export function createWorkerPsdImportEngine(workerFactory?: () => Worker): PsdImportEngine {
  const createWorker = workerFactory ?? (() => new PsdImportWorker());
  let worker: Worker | undefined;
  let workerUsable = true;
  let workerReady = false;
  let requestId = 0;
  let active: { id: number; resolve: (value: string) => void; reject: (error: Error) => void } | undefined;

  const ensureWorker = (): Worker | undefined => {
    if (worker) return worker;
    if (!workerUsable) return undefined;
    let created: Worker;
    try {
      created = createWorker();
    } catch {
      workerUsable = false;
      return undefined;
    }
    worker = created;
    workerReady = false;
    created.addEventListener("error", () => {
      if (worker !== created) return;
      // Only startup refusal may fall back. Repeating a parser/runtime fault
      // on the UI thread would run the failing input twice and block editing.
      const startupFailure = !workerReady;
      if (startupFailure) workerUsable = false;
      worker = undefined;
      created.terminate();
      const pending = active;
      active = undefined;
      pending?.reject(Error(startupFailure ? WORKER_UNAVAILABLE : "psd-import-worker-failed"));
    });
    created.postMessage({ kind: "psd-import-init", compressed: compressedPsdImportWasm });
    created.addEventListener("message", (event: MessageEvent<PsdImportWorkerReply>) => {
      const reply = event.data;
      if (worker !== created) return;
      if (reply?.kind === "psd-import-ready") { workerReady = true; return; }
      if (!reply || reply.kind !== "psd-smart-object-reply" || reply.requestId !== active?.id) return;
      const pending = active;
      active = undefined;
      if (reply.ok) pending.resolve(reply.responseJson);
      else pending.reject(Error(reply.message));
    });
    return worker;
  };

  const runOnUiThread = async (bytes: Uint8Array, requestJson: string, id: number): Promise<string> => {
    // UI-thread fallback: the same module, loaded lazily here.
    const runtime = await import("./psd-import-wasm-runtime");
    await runtime.default();
    if (id !== requestId) throw Error("psd-import-cancelled");
    return runtime.psd_smart_objects_json(bytes, requestJson);
  };

  const cancel = (): void => {
    requestId += 1;
    active?.reject(Error("psd-import-cancelled"));
    active = undefined;
    worker?.terminate();
    worker = undefined;
  };

  const run = async (bytes: Uint8Array, action: Record<string, unknown>): Promise<string> => {
    cancel();
    const id = ++requestId;
    const requestJson = psdRequestJson(action);
    const host = ensureWorker();
    if (!host) return runOnUiThread(bytes, requestJson, id);
    try {
      const transferred = bytes.slice().buffer;
      return await new Promise<string>((resolve, reject) => {
        active = { id, resolve, reject };
        host.postMessage({
          kind: "psd-smart-object-request",
          requestId: id,
          bytes: transferred,
          requestJson,
        } satisfies PsdImportWorkerRequest, [transferred]);
      });
    } catch (error) {
      if (error instanceof Error && error.message === WORKER_UNAVAILABLE) {
        if (id !== requestId) throw Error("psd-import-cancelled");
        return runOnUiThread(bytes, requestJson, id);
      }
      throw error;
    }
  };

  return {
    async inspect(bytes) {
      const reply = parseReplyJson(await run(bytes, { operation: "inspect" }));
      if (reply.result !== "inspection") throw Error("PSD inspection returned an unexpected result");
      return reply.inspection as unknown as PsdInspectionWire;
    },
    async planCurveWork(bytes, smartObjectId) {
      const reply = parseReplyJson(await run(bytes, { operation: "planCurveWork", smartObjectId }));
      if (reply.result !== "curveWorkPlan") throw Error("PSD curve planning returned an unexpected result");
      return reply.plan as unknown as PsdCurveWorkPlanWire;
    },
    cancel,
    dispose() {
      this.cancel();
    },
  };
}

export const PSD_UNSUPPORTED_REASON_LABELS: Record<"en" | "zh", Record<string, string>> = {
  en: {
    missingTransform: "missing placement",
    nonFiniteTransform: "non-finite placement",
    missingSourceSize: "missing source size",
    invalidSourceSize: "invalid source size",
    alternateTransform: "alternate transform",
    invalidQuad: "invalid placement quad",
    nonNeutralWarp: "warp outside the adoptable curve family",
    quiltWarp: "quilt warp",
    conflictingWarpBlocks: "conflicting warp sources",
  },
  zh: {
    missingTransform: "缺少放置",
    nonFiniteTransform: "放置含非有限值",
    missingSourceSize: "缺少源尺寸",
    invalidSourceSize: "源尺寸无效",
    alternateTransform: "存在替代变换",
    invalidQuad: "放置四边形无效",
    nonNeutralWarp: "曲线超出可采用的族",
    quiltWarp: "拼片弯曲",
    conflictingWarpBlocks: "弯曲来源冲突",
  },
};

/** Human reasons for one unsupported smart object, keyed by the rejection
 * kind the interop reports. Omitted kinds fall back to the generic label. */
export function psdUnsupportedDetail(
  reasons: { reason: string }[] | undefined,
  copy: PsdCurveImportCopy,
): string {
  if (!reasons || reasons.length === 0) return copy.unsupported;
  const labels = reasons
    .map(reason => copy.unsupportedReasons?.[reason.reason])
    .filter((label): label is string => Boolean(label));
  return labels.length > 0 ? labels.join(" · ") : copy.unsupported;
}

export interface PsdCurveImportCopy {
  trigger: string;
  hint: string;
  pick: string;
  reading: string;
  objectsIn: string;
  eligible: string;
  unsupported: string;
  unsupportedReasons?: Record<string, string>;
  adopt: string;
  adopting: string;
  cancel: string;
  empty: string;
  tooLarge: string;
}

interface PsdCurveImportCallbacks {
  host: HTMLElement;
  copy(): PsdCurveImportCopy;
  engine: PsdImportEngine;
  onStateChange?(): void;
  /** The planned work was accepted into the editing flow. */
  onAdopt(plan: PsdCurveWorkPlanWire, bytes: Uint8Array, current: () => boolean): void | Promise<void>;
  formatError(error: unknown): string;
}

type ImportPhase =
  | { kind: "idle" }
  | { kind: "reading"; fileName: string }
  | { kind: "objects"; fileName: string; bytes: Uint8Array; objects: PsdSmartObjectRecordWire[]; selected: string }
  | { kind: "adopting"; fileName: string; bytes: Uint8Array; objectId: string }
  | { kind: "error"; fileName?: string; message: string };

/** One PSD curve-import session inside the Templates workspace: pick a local
 * file, see its smart objects with their importability, adopt one curve onto
 * the current artwork. Reading a new file, changing the selection, or
 * leaving the workspace resets the session; stale replies never adopt. */
export function createPsdCurveImport(input: PsdCurveImportCallbacks) {
  let phase: ImportPhase = { kind: "idle" };
  let generation = 0;
  let mounted = false;
  const root = document.createElement("div");
  root.className = "psd-curve-import";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".psd,.psb";
  fileInput.className = "psd-curve-import-file";
  fileInput.hidden = true;
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (file) void readFile(file);
  });

  const active = (): boolean => phase.kind !== "idle";

  function leave(): void {
    generation += 1;
    phase = { kind: "idle" };
    input.engine.cancel();
    render();
  }

  async function readFile(file: File): Promise<void> {
    const run = ++generation;
    input.engine.cancel();
    if (file.size > PSD_IMPORT_SOURCE_LIMIT_BYTES) {
      phase = { kind: "error", fileName: file.name, message: input.copy().tooLarge };
      render();
      return;
    }
    phase = { kind: "reading", fileName: file.name };
    render();
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (run !== generation) return;
      const inspection = await input.engine.inspect(bytes);
      if (run !== generation) return;
      const firstCurve = inspection.smartObjects.find(object => object.importability.status === "curveEligible");
      phase = {
        kind: "objects",
        fileName: file.name,
        bytes,
        objects: inspection.smartObjects,
        selected: firstCurve?.id ?? "",
      };
    } catch (error) {
      if (run !== generation || String(error) === "Error: psd-import-cancelled") return;
      phase = { kind: "error", fileName: file.name, message: input.formatError(error) };
    }
    if (run === generation) render();
  }

  async function adopt(): Promise<void> {
    if (phase.kind !== "objects") return;
    const objectId = phase.selected;
    const bytes = phase.bytes;
    const fileName = phase.fileName;
    const run = ++generation;
    phase = { kind: "adopting", fileName, bytes, objectId };
    render();
    try {
      const plan = await input.engine.planCurveWork(bytes, objectId);
      if (run !== generation) return;
      await input.onAdopt(plan, bytes, () => run === generation);
      if (run !== generation) return;
      phase = { kind: "idle" };
      render();
    } catch (error) {
      if (run !== generation || String(error) === "Error: psd-import-cancelled") return;
      phase = { kind: "error", fileName, message: input.formatError(error) };
      render();
    }
  }

  function render(): void {
    const copy = input.copy();
    root.replaceChildren(fileInput);
    root.hidden = !active();
    if (mounted) input.onStateChange?.();
    if (!active()) return;
    const heading = document.createElement("h4");
    heading.textContent = copy.hint;
    root.append(heading);
    if (phase.kind === "reading") {
      const status = document.createElement("p");
      status.className = "psd-curve-import-status";
      status.textContent = `${copy.reading} ${phase.fileName}`;
      root.append(status);
    } else if (phase.kind === "objects") {
      const objects = phase.objects;
      if (objects.length === 0) {
        const empty = document.createElement("p");
        empty.className = "psd-curve-import-status";
        empty.textContent = copy.empty;
        root.append(empty);
      } else {
        const list = document.createElement("div");
        list.className = "psd-curve-import-objects";
        list.role = "listbox";
        for (const object of objects) {
          const item = document.createElement("button");
          item.type = "button";
          item.role = "option";
          item.className = "psd-curve-import-object";
          item.dataset.objectId = object.id;
          const eligible = object.importability.status === "curveEligible";
          item.setAttribute("aria-selected", String(object.id === phase.selected));
          item.disabled = !eligible;
          const name = document.createElement("span");
          name.textContent = object.layerPath.length > 1
            ? `${object.layerPath.slice(0, -1).join(" / ")} / ${object.name}`
            : object.name;
          const detail = document.createElement("span");
          detail.className = "psd-curve-import-object-detail";
          detail.textContent = eligible
            ? copy.eligible
            : psdUnsupportedDetail(object.importability.status === "unsupported" ? object.importability.reasons : undefined, copy);
          item.append(name, detail);
          item.addEventListener("click", () => {
            if (phase.kind !== "objects" || !eligible) return;
            phase.selected = object.id;
            render();
          });
          list.append(item);
        }
        const caption = document.createElement("p");
        caption.className = "psd-curve-import-status";
        caption.textContent = copy.objectsIn.replace("{name}", phase.fileName);
        root.append(caption, list);
      }
    } else if (phase.kind === "adopting") {
      const status = document.createElement("p");
      status.className = "psd-curve-import-status";
      status.textContent = copy.adopting;
      root.append(status);
    } else if (phase.kind === "error") {
      const error = document.createElement("p");
      error.className = "psd-curve-import-error";
      error.textContent = phase.message;
      root.append(error);
    }
    {
      if (phase.kind === "idle") {
        const pick = document.createElement("button");
        pick.type = "button";
        pick.textContent = copy.pick;
        pick.addEventListener("click", () => fileInput.click());
        root.append(pick);
      } else {
        if (phase.kind === "objects" && phase.selected) {
          const adoptButton = document.createElement("button");
          adoptButton.type = "button";
          adoptButton.className = "primary";
          adoptButton.textContent = copy.adopt;
          adoptButton.addEventListener("click", () => void adopt());
          root.append(adoptButton);
        }
        if (phase.kind === "error" || (phase.kind === "objects" && phase.objects.length === 0)) {
          const pick = document.createElement("button");
          pick.type = "button";
          pick.textContent = copy.pick;
          pick.addEventListener("click", () => fileInput.click());
          root.append(pick);
        }
      }
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = copy.cancel;
      cancel.addEventListener("click", leave);
      root.append(cancel);
    }
  }

  input.host.append(root);
  render();
  mounted = true;

  return {
    /** Open the file picker for a new import session. */
    begin() {
      generation += 1;
      input.engine.cancel();
      phase = { kind: "idle" };
      render();
      fileInput.click();
    },
    /** The import panel replaces the ordinary list while a session runs. */
    active,
    leave,
    dispose() {
      generation += 1;
      phase = { kind: "idle" };
      input.engine.cancel();
      root.remove();
    },
  };
}

export type PsdCurveImportController = ReturnType<typeof createPsdCurveImport>;
