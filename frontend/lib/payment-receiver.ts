// Payment receiver address guards.
//
// Backend configuration (POLYWEATHER_PAYMENT_ACCEPTED_TOKENS_JSON /
// POLYWEATHER_PAYMENT_RECEIVER_CONTRACT / POLYWEATHER_PAYMENT_DIRECT_RECEIVER_ADDRESS)
// is the authoritative source of receiver addresses.  These constants pin the
// values the frontend will accept so a compromised/overridden backend response
// cannot redirect payments:
//  - contract checkout mode must pay the V2 checkout contract;
//  - manual direct-transfer mode must pay the configured direct receiver EOA.

export const EXPECTED_PAYMENT_RECEIVER_CONTRACT =
  "0x1fD90A26291B1f5e5217206B40cfADe444FC8Ac3";

export const EXPECTED_PAYMENT_DIRECT_RECEIVER_ADDRESS =
  "0x351a1bca5f49dd0046a7cf0bafa7e12fa6441c3a";

// Backward-compatible alias used by older guards (contract checkout).
export const EXPECTED_PAYMENT_RECEIVER_ADDRESS = EXPECTED_PAYMENT_RECEIVER_CONTRACT;

export function normalizePaymentReceiver(address: string | null | undefined) {
  return String(address || "").trim().toLowerCase();
}

export function assertExpectedPaymentReceiver(
  address: string | null | undefined,
  label = "payment receiver",
) {
  const normalized = normalizePaymentReceiver(address);
  if (normalized !== EXPECTED_PAYMENT_RECEIVER_CONTRACT) {
    throw new Error(
      `${label} mismatch: expected ${EXPECTED_PAYMENT_RECEIVER_CONTRACT}, got ${normalized || "empty"}`,
    );
  }
  return normalized;
}

export function assertExpectedDirectPaymentReceiver(
  address: string | null | undefined,
  label = "manual payment receiver",
) {
  const normalized = normalizePaymentReceiver(address);
  if (normalized !== EXPECTED_PAYMENT_DIRECT_RECEIVER_ADDRESS) {
    throw new Error(
      `${label} mismatch: expected ${EXPECTED_PAYMENT_DIRECT_RECEIVER_ADDRESS}, got ${normalized || "empty"}`,
    );
  }
  return normalized;
}
