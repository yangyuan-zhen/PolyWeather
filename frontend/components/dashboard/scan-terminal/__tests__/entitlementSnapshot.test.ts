import {
  authPayloadToEntitlementSnapshot,
  decodeEntitlementSnapshot,
  encodeEntitlementSnapshot,
  entitlementSnapshotToAuthPayload,
  type EntitlementSnapshotPayload,
} from "@/lib/entitlement-snapshot";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const now = Date.parse("2026-05-30T10:00:00.000Z");
  const payload: EntitlementSnapshotPayload = {
    v: 1,
    user_id: "user-1",
    email: "user@example.com",
    status: "active",
    subscription_plan_code: "pro_monthly",
    subscription_expires_at: "2026-06-30T00:00:00.000Z",
    subscription_total_expires_at: "2026-06-30T00:00:00.000Z",
    subscription_queued_days: 0,
    points: 3500,
    issued_at: "2026-05-30T10:00:00.000Z",
  };

  const token = encodeEntitlementSnapshot(payload, "snapshot-secret");
  const decoded = decodeEntitlementSnapshot(token, "snapshot-secret", {
    maxAgeSeconds: 15 * 60,
    nowMs: now + 60_000,
    expectedUserId: "user-1",
  });

  assert(
    decoded?.user_id === "user-1",
    "signed entitlement snapshot should decode for the matching user",
  );
  assert(
    decoded?.subscription_plan_code === "pro_monthly",
    "snapshot should preserve subscription metadata",
  );

  const authPayload = entitlementSnapshotToAuthPayload(decoded);
  if (!authPayload) {
    throw new Error("valid snapshot should convert to auth payload");
  }
  assert(
    authPayload.subscription_active === true &&
      authPayload.entitlement_snapshot === true &&
      !("degraded_auth_profile" in authPayload),
    "snapshot auth payload should grant only a snapshot-backed active terminal state",
  );

  const [body, signature] = token.split(".");
  const tamperedBody =
    `${body.slice(0, -1)}${body.endsWith("A") ? "B" : "A"}`;
  const tampered = `${tamperedBody}.${signature}`;
  assert(
    decodeEntitlementSnapshot(tampered, "snapshot-secret", {
      maxAgeSeconds: 15 * 60,
      nowMs: now + 60_000,
      expectedUserId: "user-1",
    }) === null,
    "tampered entitlement snapshots must be rejected",
  );

  assert(
    decodeEntitlementSnapshot(token, "wrong-secret", {
      maxAgeSeconds: 15 * 60,
      nowMs: now + 60_000,
      expectedUserId: "user-1",
    }) === null,
    "snapshots signed with another secret must be rejected",
  );

  assert(
    decodeEntitlementSnapshot(token, "snapshot-secret", {
      maxAgeSeconds: 15 * 60,
      nowMs: now + 20 * 60_000,
      expectedUserId: "user-1",
    }) === null,
    "old entitlement snapshots must expire quickly",
  );

  assert(
    decodeEntitlementSnapshot(token, "snapshot-secret", {
      maxAgeSeconds: 15 * 60,
      nowMs: now + 60_000,
      expectedUserId: "other-user",
    }) === null,
    "snapshots must be bound to the current Supabase user id",
  );

  assert(
    authPayloadToEntitlementSnapshot({
      authenticated: true,
      user_id: "expired-user",
      subscription_active: true,
      subscription_total_expires_at: "2020-01-01T00:00:00.000Z",
    }) === null,
    "expired subscription payloads must not be cached as entitlement snapshots",
  );
}
