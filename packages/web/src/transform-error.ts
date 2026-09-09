import type { ErrorCode, TransformErrorData } from "./types";

export class TransformError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(data: TransformErrorData) {
    super(data.message);
    this.name = "TransformError";
    this.code = data.code;
    this.details = data.details;
  }
}

export function throwBridgeError(error: unknown): never {
    // A Rust panic crosses the bridge as a bare RuntimeError; unexpected
    // internal failures still belong inside the stable error contract.
    if (error instanceof WebAssembly.RuntimeError) {
      throw new TransformError({
        code: "E_INTERNAL",
        message: `Unexpected internal failure: ${error.message}`,
      });
    }
    if (typeof error === "string") {
      try {
        throw new TransformError(JSON.parse(error) as TransformErrorData);
      } catch (parsed) {
        if (parsed instanceof TransformError) throw parsed;
      }
    }
  throw error;
}
