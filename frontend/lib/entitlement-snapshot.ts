import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

export const ENTITLEMENT_SNAPSHOT_COOKIE = "polyweather_entitlement_snapshot";
const DEFAULT_MAX_AGE_SECONDS = 15 * 60;

export type EntitlementSnapshotPayload = {
  v: 1;
  user_id: string;
  email?: string | null;
  status: "active";
  subscription_plan_code?: string | null;
  subscription_expires_at?: string | null;
  subscription_total_expires_at?: string | null;
  subscription_queued_days?: number | null;
  points?: number | null;
  issued_at: string;
};

export type EntitlementSnapshotDecodeOptions = {
  expectedUserId?: string | null;
  maxAgeSeconds?: number;
  nowMs?: number;
};

export type SnapshotAuthPayload = {
  authenticated: true;
  user_id: string;
  email: string | null;
  subscription_active: true;
  subscription_plan_code: string | null;
  subscription_expires_at: string | null;
  subscription_total_expires_at: string | null;
  subscription_queued_days: number;
  subscription_queued_count: 0;
  points: number;
  entitlement_snapshot: true;
};

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function hmac(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  try {
    const leftBytes = Buffer.from(left);
    const rightBytes = Buffer.from(right);
    return (
      leftBytes.length === rightBytes.length &&
      timingSafeEqual(leftBytes, rightBytes)
    );
  } catch {
    return false;
  }
}

function parseDateMs(value: string | null | undefined) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function snapshotMaxAgeSeconds() {
  const raw = Number(
    process.env.POLYWEATHER_ENTITLEMENT_SNAPSHOT_MAX_AGE_SEC || "",
  );
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MAX_AGE_SECONDS;
  return Math.max(60, Math.min(Math.floor(raw), 6 * 60 * 60));
}

function expireSnapshotCookie(response: NextResponse) {
  response.cookies.set(ENTITLEMENT_SNAPSHOT_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export function getEntitlementSnapshotSecret() {
  return (
    process.env.POLYWEATHER_ENTITLEMENT_SNAPSHOT_SECRET?.trim() ||
    process.env.POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    ""
  );
}

export function encodeEntitlementSnapshot(
  payload: EntitlementSnapshotPayload,
  secret = getEntitlementSnapshotSecret(),
) {
  if (!secret) return "";
  const body = encodeBase64Url(JSON.stringify(payload));
  return `${body}.${hmac(body, secret)}`;
}

export function decodeEntitlementSnapshot(
  token: string | null | undefined,
  secret = getEntitlementSnapshotSecret(),
  options: EntitlementSnapshotDecodeOptions = {},
): EntitlementSnapshotPayload | null {
  if (!token || !secret) return null;
  const [body, signature, extra] = String(token).split(".");
  if (!body || !signature || extra != null) return null;
  if (!safeEqual(signature, hmac(body, secret))) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(decodeBase64Url(body));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const userId = String(record.user_id || "").trim();
  if (
    record.v !== 1 ||
    record.status !== "active" ||
    !userId ||
    (options.expectedUserId &&
      userId !== String(options.expectedUserId || "").trim())
  ) {
    return null;
  }

  const nowMs = options.nowMs ?? Date.now();
  const maxAgeSeconds = Math.max(
    1,
    options.maxAgeSeconds ?? snapshotMaxAgeSeconds(),
  );
  const issuedAtMs = parseDateMs(String(record.issued_at || ""));
  const expiresAtMs = parseDateMs(
    String(
      record.subscription_total_expires_at ||
        record.subscription_expires_at ||
        "",
    ),
  );
  if (issuedAtMs == null || nowMs - issuedAtMs > maxAgeSeconds * 1000) {
    return null;
  }
  if (expiresAtMs == null || expiresAtMs <= nowMs) {
    return null;
  }

  return {
    v: 1,
    user_id: userId,
    email: String(record.email || "").trim() || null,
    status: "active",
    subscription_plan_code:
      String(record.subscription_plan_code || "").trim() || null,
    subscription_expires_at:
      String(record.subscription_expires_at || "").trim() || null,
    subscription_total_expires_at:
      String(record.subscription_total_expires_at || "").trim() || null,
    subscription_queued_days: Math.max(
      0,
      Number(record.subscription_queued_days ?? 0) || 0,
    ),
    points: Math.max(0, Number(record.points ?? 0) || 0),
    issued_at: String(record.issued_at || "").trim(),
  };
}

export function entitlementSnapshotToAuthPayload(
  snapshot: EntitlementSnapshotPayload | null,
): SnapshotAuthPayload | null {
  if (!snapshot) return null;
  return {
    authenticated: true,
    user_id: snapshot.user_id,
    email: snapshot.email || null,
    points: Number(snapshot.points ?? 0),
    subscription_active: true,
    subscription_plan_code: snapshot.subscription_plan_code ?? null,
    subscription_expires_at: snapshot.subscription_expires_at ?? null,
    subscription_total_expires_at:
      snapshot.subscription_total_expires_at ??
      snapshot.subscription_expires_at ??
      null,
    subscription_queued_days: Math.max(
      0,
      Number(snapshot.subscription_queued_days ?? 0),
    ),
    subscription_queued_count: 0,
    entitlement_snapshot: true,
  };
}

export function authPayloadToEntitlementSnapshot(
  payload: Record<string, unknown>,
): EntitlementSnapshotPayload | null {
  const userId = String(payload.user_id || "").trim();
  if (
    payload.authenticated !== true ||
    payload.subscription_active !== true ||
    !userId
  ) {
    return null;
  }
  const expiresAt =
    String(payload.subscription_total_expires_at || "").trim() ||
    String(payload.subscription_expires_at || "").trim();
  const expiresAtMs = parseDateMs(expiresAt);
  if (expiresAtMs == null || expiresAtMs <= Date.now()) return null;
  return {
    v: 1,
    user_id: userId,
    email: String(payload.email || "").trim() || null,
    status: "active",
    subscription_plan_code:
      String(payload.subscription_plan_code || "").trim() || null,
    subscription_expires_at:
      String(payload.subscription_expires_at || "").trim() || null,
    subscription_total_expires_at:
      String(payload.subscription_total_expires_at || "").trim() ||
      String(payload.subscription_expires_at || "").trim() ||
      null,
    subscription_queued_days: Math.max(
      0,
      Number(payload.subscription_queued_days ?? 0) || 0,
    ),
    points: Math.max(0, Number(payload.points ?? 0) || 0),
    issued_at: new Date().toISOString(),
  };
}

export function readEntitlementSnapshot(
  req: NextRequest,
  expectedUserId?: string | null,
) {
  return decodeEntitlementSnapshot(
    req.cookies.get(ENTITLEMENT_SNAPSHOT_COOKIE)?.value || "",
    getEntitlementSnapshotSecret(),
    { expectedUserId },
  );
}

export function applyEntitlementSnapshotCookie(
  response: NextResponse,
  payload: Record<string, unknown>,
) {
  const snapshot = authPayloadToEntitlementSnapshot(payload);
  const token = snapshot ? encodeEntitlementSnapshot(snapshot) : "";
  if (!snapshot || !token) {
    expireSnapshotCookie(response);
    return response;
  }
  const totalExpiryMs = parseDateMs(snapshot.subscription_total_expires_at);
  const nowMs = Date.now();
  const maxAge = Math.max(
    1,
    Math.min(
      snapshotMaxAgeSeconds(),
      totalExpiryMs == null
        ? snapshotMaxAgeSeconds()
        : Math.floor((totalExpiryMs - nowMs) / 1000),
    ),
  );
  response.cookies.set(ENTITLEMENT_SNAPSHOT_COOKIE, token, {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

export function clearEntitlementSnapshotCookie(response: NextResponse) {
  expireSnapshotCookie(response);
  return response;
}
