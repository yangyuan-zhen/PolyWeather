export type AuthProfileIdentity = {
  email: string | null;
  userId: string;
};

function extractErrorDetail(raw: string) {
  const text = String(raw || "").trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.detail === "string") return parsed.detail;
    if (typeof parsed?.error === "string") return parsed.error;
  } catch {}
  return text;
}

export function isSubscriptionRequiredBackendResponse(
  status: number,
  raw: string,
) {
  return (
    status === 403 &&
    extractErrorDetail(raw).trim().toLowerCase() === "subscription required"
  );
}

export function buildSubscriptionRequiredAuthProfile(
  identity: AuthProfileIdentity,
) {
  return {
    authenticated: true,
    user_id: identity.userId,
    email: identity.email,
    subscription_active: false,
    subscription_plan_code: null,
    subscription_expires_at: null,
    subscription_total_expires_at: null,
    subscription_queued_days: 0,
    subscription_queued_count: 0,
    points: 0,
    subscription_required: true,
  };
}
