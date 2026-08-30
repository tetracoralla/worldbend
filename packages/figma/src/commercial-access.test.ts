import { describe, expect, it, vi } from "vitest";

import {
  FULL_TRIAL_SECONDS,
  requestCommercialAccess,
  type PaymentStatusType,
} from "./commercial-access";

function payments(status: PaymentStatusType, elapsed: number) {
  let current = status;
  return {
    get status() {
      return { type: current };
    },
    getUserFirstRanSecondsAgo: vi.fn(() => elapsed),
    initiateCheckoutAsync: vi.fn(async (): Promise<void> => undefined),
    markPaid() {
      current = "PAID";
    },
  };
}

describe("commercial access", () => {
  it("allows a paid customer without opening checkout", async () => {
    const port = payments("PAID", FULL_TRIAL_SECONDS + 1);
    await expect(requestCommercialAccess(port)).resolves.toBe("allowed");
    expect(port.initiateCheckoutAsync).not.toHaveBeenCalled();
  });

  it("allows the complete product throughout the seven-day trial", async () => {
    const port = payments("UNPAID", FULL_TRIAL_SECONDS - 1);
    await expect(requestCommercialAccess(port)).resolves.toBe("allowed");
    expect(port.initiateCheckoutAsync).not.toHaveBeenCalled();
  });

  it("opens checkout after the trial and accepts a completed purchase", async () => {
    const port = payments("UNPAID", FULL_TRIAL_SECONDS);
    port.initiateCheckoutAsync.mockImplementation(async () => port.markPaid());
    await expect(requestCommercialAccess(port)).resolves.toBe("allowed");
    expect(port.initiateCheckoutAsync).toHaveBeenCalledWith({ interstitial: "TRIAL_ENDED" });
  });

  it("keeps the edit recoverable when checkout is dismissed", async () => {
    const port = payments("UNPAID", FULL_TRIAL_SECONDS);
    await expect(requestCommercialAccess(port)).resolves.toBe("purchase-required");
  });

  it("closes on missing, unsupported, invalid, or failed payment state", async () => {
    await expect(requestCommercialAccess(undefined)).resolves.toBe("status-unavailable");
    await expect(requestCommercialAccess(payments("NOT_SUPPORTED", 0))).resolves.toBe(
      "status-unavailable",
    );
    await expect(requestCommercialAccess(payments("UNPAID", Number.NaN))).resolves.toBe(
      "status-unavailable",
    );
    const failed = payments("UNPAID", FULL_TRIAL_SECONDS);
    failed.initiateCheckoutAsync.mockRejectedValue(new Error("checkout unavailable"));
    await expect(requestCommercialAccess(failed)).resolves.toBe("status-unavailable");
  });
});
