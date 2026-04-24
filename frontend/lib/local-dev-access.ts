import type { ProAccessState } from "@/lib/dashboard-types";

const LOCAL_DEV_EXPIRY = "2099-12-31T23:59:59Z";
const LOCAL_DEV_POINTS = 999_999;

function readLocalAccessFlag() {
  const raw =
    process.env.NEXT_PUBLIC_POLYWEATHER_LOCAL_FULL_ACCESS ??
    process.env.POLYWEATHER_LOCAL_FULL_ACCESS;
  if (raw == null) return true;
  return !/^(0|false|off|no)$/i.test(String(raw).trim());
}

export function isLocalHostname(value?: string | null) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "");
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

export function extractHostname(value?: string | null) {
  const firstHost = String(value || "")
    .split(",")[0]
    .trim();
  if (!firstHost) return "";
  try {
    return new URL(
      firstHost.includes("://") ? firstHost : `http://${firstHost}`,
    ).hostname;
  } catch {
    if (firstHost.startsWith("[")) {
      const endIndex = firstHost.indexOf("]");
      return endIndex > 0 ? firstHost.slice(1, endIndex) : firstHost;
    }
    return firstHost.split(":")[0] || firstHost;
  }
}

export function isLocalFullAccessHost(value?: string | null) {
  return readLocalAccessFlag() && isLocalHostname(extractHostname(value));
}

export function isBrowserLocalFullAccess() {
  if (typeof window === "undefined") return false;
  return readLocalAccessFlag() && isLocalHostname(window.location.hostname);
}

export function getLocalDevAuthPayload() {
  return {
    authenticated: true,
    user_id: "local-dev",
    email: "local-dev@polyweather.local",
    subscription_active: true,
    subscription_plan_code: "local-full-access",
    subscription_expires_at: LOCAL_DEV_EXPIRY,
    subscription_total_expires_at: LOCAL_DEV_EXPIRY,
    subscription_queued_days: 0,
    subscription_queued_count: 0,
    points: LOCAL_DEV_POINTS,
    local_dev_full_access: true,
  };
}

export function getLocalDevProAccessState(): ProAccessState {
  return {
    loading: false,
    authenticated: true,
    userId: "local-dev",
    subscriptionActive: true,
    subscriptionPlanCode: "local-full-access",
    subscriptionExpiresAt: LOCAL_DEV_EXPIRY,
    subscriptionTotalExpiresAt: LOCAL_DEV_EXPIRY,
    subscriptionQueuedDays: 0,
    points: LOCAL_DEV_POINTS,
    error: null,
  };
}
