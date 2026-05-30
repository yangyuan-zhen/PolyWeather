import type { ProAccessState } from "@/lib/dashboard-types";

export type AuthProfilePayload = {
  authenticated?: boolean;
  user_id?: string | null;
  subscription_active?: boolean | null;
  subscription_plan_code?: string | null;
  subscription_expires_at?: string | null;
  subscription_total_expires_at?: string | null;
  subscription_queued_days?: number | null;
  points?: number | null;
  degraded_auth_profile?: boolean | null;
};

function queuedDays(value: unknown) {
  return Math.max(0, Number(value ?? 0));
}

export function isSubscriptionStatusUnknown(payload: AuthProfilePayload) {
  return (
    payload.subscription_active === null ||
    payload.subscription_active === undefined ||
    payload.degraded_auth_profile === true
  );
}

export function createAccessStateFromAuthPayload(
  payload: AuthProfilePayload,
): ProAccessState {
  const subscriptionUnknown =
    Boolean(payload.authenticated) && isSubscriptionStatusUnknown(payload);
  return {
    loading: subscriptionUnknown,
    authenticated: Boolean(payload.authenticated),
    userId: payload.user_id ?? null,
    subscriptionActive: payload.subscription_active === true,
    subscriptionPlanCode: payload.subscription_plan_code ?? null,
    subscriptionExpiresAt: payload.subscription_expires_at ?? null,
    subscriptionTotalExpiresAt:
      payload.subscription_total_expires_at ??
      payload.subscription_expires_at ??
      null,
    subscriptionQueuedDays: queuedDays(payload.subscription_queued_days),
    points: Number(payload.points ?? 0),
    error: null,
  };
}

export function mergeAccessStateWithAuthPayload(
  previous: ProAccessState,
  payload: AuthProfilePayload,
): ProAccessState {
  const next = createAccessStateFromAuthPayload(payload);
  const subscriptionUnknown = isSubscriptionStatusUnknown(payload);

  if (!subscriptionUnknown || !previous.subscriptionActive || !next.authenticated) {
    return next;
  }

  return {
    ...next,
    loading: false,
    subscriptionActive: true,
    subscriptionPlanCode: previous.subscriptionPlanCode,
    subscriptionExpiresAt: previous.subscriptionExpiresAt,
    subscriptionTotalExpiresAt: previous.subscriptionTotalExpiresAt,
    subscriptionQueuedDays: previous.subscriptionQueuedDays,
    points: Number.isFinite(next.points) && next.points > 0 ? next.points : previous.points,
  };
}
