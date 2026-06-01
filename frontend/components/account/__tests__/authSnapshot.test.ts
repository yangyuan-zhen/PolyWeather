import {
  buildAuthMePath,
  mergeAccountAuthSnapshot,
} from "@/lib/auth-snapshot";
import type { AuthSnapshotLike } from "@/lib/auth-snapshot";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  assert(
    buildAuthMePath({ scope: "entitlement" }) ===
      "/api/auth/me?scope=entitlement",
    "account entitlement probe must use the lightweight auth/me scope",
  );
  assert(
    buildAuthMePath({ preferSnapshot: true, scope: "entitlement" }) ===
      "/api/auth/me?prefer_snapshot=1&scope=entitlement",
    "terminal auth probe must combine snapshot preference with lightweight entitlement scope",
  );

  const active: AuthSnapshotLike & { referral?: { code?: string } } = {
    authenticated: true,
    user_id: "user-1",
    subscription_active: true,
    subscription_plan_code: "pro_monthly",
    subscription_expires_at: "2026-07-01T00:00:00Z",
    subscription_total_expires_at: "2026-07-01T00:00:00Z",
    subscription_queued_days: 0,
    points: 120,
    referral: { code: "PW-ABC" },
  };

  const degraded = mergeAccountAuthSnapshot(active, {
    authenticated: true,
    user_id: "user-1",
    subscription_active: null,
    subscription_plan_code: null,
    subscription_expires_at: null,
    subscription_total_expires_at: null,
    subscription_queued_days: 0,
    points: 0,
    degraded_auth_profile: true,
  });

  assert(
    degraded.subscription_active === true &&
      degraded.subscription_plan_code === "pro_monthly" &&
      degraded.points === 120 &&
      degraded.referral?.code === "PW-ABC",
    "account snapshot merge must preserve confirmed Pro status when a later auth/me response is degraded",
  );

  const inactive = mergeAccountAuthSnapshot(active, {
    authenticated: true,
    user_id: "user-1",
    subscription_active: false,
    subscription_plan_code: null,
    points: 0,
  });

  assert(
    inactive.subscription_active === false,
    "account snapshot merge must still accept a confirmed inactive subscription response",
  );
}
