export const EXPECTED_PAYMENT_RECEIVER_ADDRESS =
  "0x351a1bca5f49dd0046a7cf0bafa7e12fa6441c3a";

export function normalizePaymentReceiver(address: string | null | undefined) {
  return String(address || "").trim().toLowerCase();
}

export function assertExpectedPaymentReceiver(
  address: string | null | undefined,
  label = "payment receiver",
) {
  const normalized = normalizePaymentReceiver(address);
  if (normalized !== EXPECTED_PAYMENT_RECEIVER_ADDRESS) {
    throw new Error(
      `${label} mismatch: expected ${EXPECTED_PAYMENT_RECEIVER_ADDRESS}, got ${normalized || "empty"}`,
    );
  }
  return normalized;
}
