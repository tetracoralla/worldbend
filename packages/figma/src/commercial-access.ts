export const FULL_TRIAL_SECONDS = 7 * 24 * 60 * 60;

export type PaymentStatusType = "UNPAID" | "PAID" | "NOT_SUPPORTED";

export interface PaymentsPort {
  readonly status: { readonly type: PaymentStatusType };
  getUserFirstRanSecondsAgo(): number;
  initiateCheckoutAsync(options: { interstitial: "TRIAL_ENDED" }): Promise<void>;
}

export type CommercialAccessResult =
  | "allowed"
  | "purchase-required"
  | "status-unavailable";

export async function requestCommercialAccess(
  payments: PaymentsPort | undefined,
): Promise<CommercialAccessResult> {
  if (!payments || currentStatus(payments) === "NOT_SUPPORTED") {
    return "status-unavailable";
  }
  if (currentStatus(payments) === "PAID") return "allowed";

  const elapsed = payments.getUserFirstRanSecondsAgo();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "status-unavailable";
  if (elapsed < FULL_TRIAL_SECONDS) return "allowed";

  try {
    await payments.initiateCheckoutAsync({ interstitial: "TRIAL_ENDED" });
  } catch {
    return "status-unavailable";
  }
  return currentStatus(payments) === "PAID" ? "allowed" : "purchase-required";
}

function currentStatus(payments: PaymentsPort): PaymentStatusType {
  // Checkout may replace the host-owned status object. Reading through a
  // function prevents a stale pre-check value from becoming the post-check
  // authority.
  return payments.status.type;
}
