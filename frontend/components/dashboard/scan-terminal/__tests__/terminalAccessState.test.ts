import {
  createAccessStateFromAuthPayload,
  mergeAccessStateWithAuthPayload,
} from "@/components/dashboard/scan-terminal/terminal-access-state";
import type { ProAccessState } from "@/lib/dashboard-types";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const activeAccess: ProAccessState = {
  loading: false,
  authenticated: true,
  userId: "user-1",
  subscriptionActive: true,
  subscriptionPlanCode: "pro_monthly",
  subscriptionExpiresAt: "2026-06-30T00:00:00Z",
  subscriptionTotalExpiresAt: "2026-06-30T00:00:00Z",
  subscriptionQueuedDays: 0,
  points: 120,
  error: null,
};

export function runTests() {
  const degraded = mergeAccessStateWithAuthPayload(activeAccess, {
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
    degraded.subscriptionActive === true,
    "terminal gate must preserve a previously active subscription when auth profile is degraded/unknown",
  );
  assert(
    degraded.subscriptionPlanCode === "pro_monthly",
    "terminal gate must keep the previous plan metadata while subscription sync is unknown",
  );

  const confirmedInactive = mergeAccessStateWithAuthPayload(activeAccess, {
    authenticated: true,
    user_id: "user-1",
    subscription_active: false,
    subscription_plan_code: null,
    subscription_expires_at: null,
    subscription_total_expires_at: null,
    subscription_queued_days: 0,
    points: 0,
  });
  assert(
    confirmedInactive.subscriptionActive === false,
    "terminal gate must still respect a confirmed inactive subscription response",
  );

  const coldUnknown = createAccessStateFromAuthPayload({
    authenticated: true,
    user_id: "user-1",
    subscription_active: null,
    degraded_auth_profile: true,
  });
  assert(
    coldUnknown.subscriptionActive === false && coldUnknown.authenticated === true,
    "cold-start unknown subscription state must not fabricate Pro access",
  );
}
