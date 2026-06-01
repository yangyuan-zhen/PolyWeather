export type AuthSnapshotLike = {
  authenticated?: boolean;
  user_id?: string | null;
  subscription_active?: boolean | null;
  subscription_plan_code?: string | null;
  subscription_source?: string | null;
  subscription_is_trial?: boolean | null;
  subscription_starts_at?: string | null;
  subscription_expires_at?: string | null;
  subscription_total_expires_at?: string | null;
  subscription_queued_days?: number | null;
  subscription_queued_count?: number | null;
  points?: number | null;
  referral?: unknown;
  telegram_pricing?: unknown;
  degraded_auth_profile?: boolean | null;
  entitlement_snapshot?: boolean | null;
};

type AuthMePathOptions = {
  preferSnapshot?: boolean;
  scope?: "entitlement";
};

export function buildAuthMePath(options: AuthMePathOptions = {}) {
  const params = new URLSearchParams();
  if (options.preferSnapshot) params.set("prefer_snapshot", "1");
  if (options.scope === "entitlement") params.set("scope", "entitlement");
  const query = params.toString();
  return query ? `/api/auth/me?${query}` : "/api/auth/me";
}

export function isUnknownSubscriptionSnapshot(
  snapshot: AuthSnapshotLike | null | undefined,
) {
  return (
    snapshot?.subscription_active === null ||
    snapshot?.subscription_active === undefined ||
    snapshot?.degraded_auth_profile === true
  );
}

export function mergeAccountAuthSnapshot<T extends AuthSnapshotLike>(
  previous: T | null | undefined,
  next: T,
): T {
  if (
    !previous?.subscription_active ||
    !next?.authenticated ||
    !isUnknownSubscriptionSnapshot(next)
  ) {
    return next;
  }

  return {
    ...next,
    subscription_active: true,
    subscription_plan_code:
      next.subscription_plan_code ?? previous.subscription_plan_code ?? null,
    subscription_source: next.subscription_source ?? previous.subscription_source ?? null,
    subscription_is_trial:
      next.subscription_is_trial ?? previous.subscription_is_trial ?? null,
    subscription_starts_at:
      next.subscription_starts_at ?? previous.subscription_starts_at ?? null,
    subscription_expires_at:
      next.subscription_expires_at ?? previous.subscription_expires_at ?? null,
    subscription_total_expires_at:
      next.subscription_total_expires_at ??
      previous.subscription_total_expires_at ??
      previous.subscription_expires_at ??
      null,
    subscription_queued_days:
      next.subscription_queued_days ?? previous.subscription_queued_days ?? 0,
    subscription_queued_count:
      next.subscription_queued_count ?? previous.subscription_queued_count ?? 0,
    points:
      Number.isFinite(Number(next.points)) && Number(next.points) > 0
        ? next.points
        : previous.points,
    referral: next.referral ?? previous.referral,
    telegram_pricing: next.telegram_pricing ?? previous.telegram_pricing,
  };
}
