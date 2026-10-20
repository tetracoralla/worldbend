import { userMessage, type UserMessage } from "./i18n";
import type { NativeVectorFidelity } from "./native-vector-guard";

function roundedError(fidelity: NativeVectorFidelity): number {
  return Math.round((fidelity.maxError ?? 0.25) * 100) / 100;
}

/** Human-visible completion status for a successfully published native Vector. */
export function nativeVectorStatusMessage(fidelity: NativeVectorFidelity): UserMessage {
  if (fidelity.class === "exact") {
    return userMessage("nativeVectorStatusExact");
  }
  // Whole-artwork results may convert text layers to outlines; that changes
  // what later editing means, so it leads the status over stroke outlining.
  if (fidelity.reasons.includes("textOutlined")) {
    return userMessage(typeof fidelity.maxError === "number"
      ? "nativeVectorStatusTextOutlinedApproximated"
      : "nativeVectorStatusTextOutlined", {
      error: roundedError(fidelity),
    });
  }
  if (fidelity.class === "approximated") {
    return userMessage("nativeVectorStatusApproximated", {
      error: roundedError(fidelity),
    });
  }
  if (typeof fidelity.maxError === "number") {
    return userMessage("nativeVectorStatusOutlinedApproximated", {
      error: roundedError(fidelity),
    });
  }
  return userMessage("nativeVectorStatusOutlined");
}
