"use client";

const ANALYTICS_ENABLED =
  process.env.NEXT_PUBLIC_POLYWEATHER_APP_ANALYTICS === "true";

type TrackableAnalyticsEvent =
  | "signup_completed"
  | "dashboard_active"
  | "paywall_feature_clicked"
  | "paywall_viewed"
  | "checkout_started"
  | "checkout_succeeded";

const CLIENT_ID_KEY = "polyweather:analytics:client-id";
const SESSION_ID_KEY = "polyweather:analytics:session-id";

function isClient() {
  return typeof window !== "undefined";
}

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getStoredId(storage: Storage, key: string) {
  let value = storage.getItem(key);
  if (!value) {
    value = randomId();
    storage.setItem(key, value);
  }
  return value;
}

export function getAnalyticsClientId() {
  if (!isClient()) return "";
  try {
    return getStoredId(window.localStorage, CLIENT_ID_KEY);
  } catch {
    return "";
  }
}

export function getAnalyticsSessionId() {
  if (!isClient()) return "";
  try {
    return getStoredId(window.sessionStorage, SESSION_ID_KEY);
  } catch {
    return "";
  }
}

export function markAnalyticsOnce(key: string, scope: "local" | "session" = "session") {
  if (!isClient()) return false;
  const storage = scope === "local" ? window.localStorage : window.sessionStorage;
  const normalizedKey = `polyweather:analytics:once:${key}`;
  try {
    if (storage.getItem(normalizedKey) === "1") {
      return false;
    }
    storage.setItem(normalizedKey, "1");
    return true;
  } catch {
    return true;
  }
}

export function trackAppEvent(
  eventType: TrackableAnalyticsEvent,
  payload: Record<string, unknown> = {},
) {
  if (!isClient() || !ANALYTICS_ENABLED) return;
  const body = {
    event_type: eventType,
    client_id: getAnalyticsClientId() || undefined,
    session_id: getAnalyticsSessionId() || undefined,
    payload: {
      ...payload,
      path: window.location.pathname,
      href: window.location.href,
      captured_at: new Date().toISOString(),
    },
  };
  void fetch("/api/analytics/events", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}
