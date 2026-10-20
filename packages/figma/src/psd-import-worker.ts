/// <reference lib="webworker" />
import generatedInit, { psd_smart_objects_json } from "@worldbend/psd-import-bindings";
import { decompressGzipBase64 } from "./wasm-compression";

export interface PsdImportWorkerInit {
  kind: "psd-import-init";
  /** The compressed import WASM payload from the single-file carrier. */
  compressed: string;
}

export interface PsdImportWorkerRequest {
  kind: "psd-smart-object-request";
  requestId: number;
  bytes: ArrayBuffer;
  requestJson: string;
}

export type PsdImportWorkerMessage = PsdImportWorkerInit | PsdImportWorkerRequest;

export type PsdImportWorkerReply =
  | { kind: "psd-smart-object-reply"; requestId: number; ok: true; responseJson: string }
  | { kind: "psd-smart-object-reply"; requestId: number; ok: false; message: string }
  | { kind: "psd-import-ready" };

let ready: Promise<void> | undefined;

/** One bounded PSD request inside the import worker. Every call runs to
 * completion; cancellation is the caller terminating the worker, which is
 * why each request carries its own bytes instead of shared state. */
self.addEventListener("message", (event: MessageEvent<PsdImportWorkerMessage>) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  if (message.kind === "psd-import-init") {
    ready = (async () => {
      await generatedInit({ module_or_path: await decompressGzipBase64(message.compressed) });
      const reply: PsdImportWorkerReply = { kind: "psd-import-ready" };
      self.postMessage(reply);
    })();
    return;
  }
  if (message.kind !== "psd-smart-object-request" || !ready) return;
  const requestId = message.requestId;
  void ready
    .then(() => {
      const responseJson = psd_smart_objects_json(new Uint8Array(message.bytes), message.requestJson);
      const reply: PsdImportWorkerReply = { kind: "psd-smart-object-reply", requestId, ok: true, responseJson };
      self.postMessage(reply);
    })
    .catch((error: unknown) => {
      const reply: PsdImportWorkerReply = {
        kind: "psd-smart-object-reply",
        requestId,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
      self.postMessage(reply);
    });
});
