import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";
import {
  buildUpstreamErrorResponse,
} from "@/lib/api-proxy";
import {
  getLocalDevAuthPayload,
  isLocalFullAccessHost,
} from "@/lib/local-dev-access";
import {
  applyEntitlementSnapshotCookie,
  clearEntitlementSnapshotCookie,
  entitlementSnapshotToAuthPayload,
  readEntitlementSnapshot,
} from "@/lib/entitlement-snapshot";
import {
  buildSubscriptionRequiredAuthProfile,
  isSubscriptionRequiredBackendResponse,
} from "@/lib/auth-profile-proxy";
import {
  hasSupabaseServerEnv,
  hasSupabaseSessionCookieValues,
} from "@/lib/supabase/server";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

type VerifiedBearerIdentity = {
  email: string | null;
  userId: string;
};

function extractBearerToken(headerValue: string | null) {
  if (!headerValue) return "";
  const parts = headerValue.trim().split(/\s+/);
  if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
    return parts[1];
  }
  return "";
}

async function getVerifiedBearerIdentity(
  req: NextRequest,
): Promise<VerifiedBearerIdentity | null> {
  const token = extractBearerToken(req.headers.get("authorization"));
  if (!token) return null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !anonKey) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`, {
      cache: "no-store",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const user = await res.json();
    const userId = String(user?.id || "").trim();
    if (!userId) return null;
    return {
      email: String(user?.email || "").trim() || null,
      userId,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function degradedAuthProfileResponse({
  email,
  reason,
  req,
  response,
  userId,
}: {
  email: string | null;
  reason: string;
  req: NextRequest;
  response: NextResponse | null;
  userId: string;
}) {
  const snapshotPayload = entitlementSnapshotToAuthPayload(
    readEntitlementSnapshot(req, userId),
  );
  if (snapshotPayload) {
    const snapshotResponse = NextResponse.json({
      ...snapshotPayload,
      email: snapshotPayload.email || email,
      entitlement_snapshot_reason: reason,
    });
    return applyAuthResponseCookies(snapshotResponse, response);
  }

  const degraded = NextResponse.json({
    authenticated: true,
    user_id: userId,
    email,
    subscription_active: null,
    subscription_plan_code: null,
    subscription_expires_at: null,
    subscription_total_expires_at: null,
    subscription_queued_days: 0,
    subscription_queued_count: 0,
    points: 0,
    degraded_auth_profile: true,
    degraded_reason: reason,
  });
  return applyAuthResponseCookies(degraded, response);
}

function subscriptionRequiredAuthProfileResponse({
  email,
  response,
  userId,
}: {
  email: string | null;
  response: NextResponse | null;
  userId: string;
}) {
  const inactive = NextResponse.json(
    buildSubscriptionRequiredAuthProfile({ email, userId }),
  );
  clearEntitlementSnapshotCookie(inactive);
  return applyAuthResponseCookies(inactive, response);
}

function unauthenticatedAuthProfileResponse({
  reason,
  response,
}: {
  reason: string;
  response: NextResponse | null;
}) {
  const anonymous = NextResponse.json(
    {
      authenticated: false,
      subscription_active: false,
      points: 0,
      degraded_auth_profile: true,
      degraded_reason: reason,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
  clearEntitlementSnapshotCookie(anonymous);
  return applyAuthResponseCookies(anonymous, response);
}

function snapshotAuthProfileResponse({
  email,
  reason,
  req,
  response,
  userId,
}: {
  email: string | null;
  reason: string;
  req: NextRequest;
  response: NextResponse | null;
  userId: string;
}) {
  const snapshotPayload = entitlementSnapshotToAuthPayload(
    readEntitlementSnapshot(req, userId),
  );
  if (!snapshotPayload) return null;
  const snapshotResponse = NextResponse.json({
    ...snapshotPayload,
    email: snapshotPayload.email || email,
    entitlement_snapshot_reason: reason,
  });
  return applyAuthResponseCookies(snapshotResponse, response);
}

function applyEntitlementSnapshotFromAuthPayload(
  response: NextResponse,
  data: Record<string, unknown>,
) {
  if (data.authenticated === true && data.subscription_active === true) {
    return applyEntitlementSnapshotCookie(response, data);
  }
  if (data.authenticated === false || data.subscription_active === false) {
    return clearEntitlementSnapshotCookie(response);
  }
  return response;
}

function hasRequestSupabaseSessionCookie(req: NextRequest) {
  return hasSupabaseSessionCookieValues(
    req.cookies.getAll().map((item) => ({
      name: item.name,
      value: item.value,
    })),
  );
}

export async function GET(req: NextRequest) {
  const requestHost =
    req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host;
  if (
    isLocalFullAccessHost(requestHost) ||
    isLocalFullAccessHost(req.nextUrl.hostname)
  ) {
    return NextResponse.json(getLocalDevAuthPayload(), {
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }

  const preferSnapshot = req.nextUrl.searchParams.get("prefer_snapshot") === "1";
  if (
    preferSnapshot &&
    !req.headers.get("authorization") &&
    hasRequestSupabaseSessionCookie(req)
  ) {
    const snapshotPayload = entitlementSnapshotToAuthPayload(
      readEntitlementSnapshot(req),
    );
    if (snapshotPayload) {
      return NextResponse.json(
        {
          ...snapshotPayload,
          entitlement_snapshot_reason: "prefer_snapshot_fast_path",
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  let auth: Awaited<ReturnType<typeof buildBackendRequestHeaders>> | null = null;
  let bearerIdentity: VerifiedBearerIdentity | null | undefined;
  const getBearerIdentityOnce = async () => {
    if (bearerIdentity !== undefined) return bearerIdentity;
    bearerIdentity = await getVerifiedBearerIdentity(req);
    return bearerIdentity;
  };
  try {
    auth = await buildBackendRequestHeaders(req);
    if (
      hasSupabaseServerEnv() &&
      !auth.authUserId &&
      !req.headers.get("authorization")
    ) {
      const response = NextResponse.json({
        authenticated: false,
        subscription_active: false,
        points: 0,
      });
      if (!preferSnapshot) clearEntitlementSnapshotCookie(response);
      return applyAuthResponseCookies(response, auth.response);
    }

    if (preferSnapshot) {
      const identity =
        auth.authUserId
          ? { email: auth.authEmail || null, userId: auth.authUserId }
          : await getBearerIdentityOnce();
      if (identity?.userId) {
        const snapshotResponse = snapshotAuthProfileResponse({
          email: identity.email,
          reason: "prefer_snapshot",
          req,
          response: auth.response,
          userId: identity.userId,
        });
        if (snapshotResponse) return snapshotResponse;
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: auth.headers,
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (res.status === 401 || res.status === 403) {
      const raw = await res.text();
      const authIdentity = auth.authUserId
        ? { email: auth.authEmail || null, userId: auth.authUserId }
        : await getBearerIdentityOnce();
      if (
        authIdentity?.userId &&
        isSubscriptionRequiredBackendResponse(res.status, raw)
      ) {
        return subscriptionRequiredAuthProfileResponse({
          email: authIdentity.email,
          response: auth.response,
          userId: authIdentity.userId,
        });
      }
      if (auth.authUserId) {
        return degradedAuthProfileResponse({
          email: auth.authEmail || null,
          reason: `backend_${res.status}`,
          req,
          response: auth.response,
          userId: auth.authUserId,
        });
      }
      const identity = await getBearerIdentityOnce();
      if (identity) {
        return degradedAuthProfileResponse({
          email: identity.email,
          reason: `backend_${res.status}`,
          req,
          response: auth.response,
          userId: identity.userId,
        });
      }
      const response = NextResponse.json({
        authenticated: false,
        subscription_active: false,
        points: 0,
      });
      clearEntitlementSnapshotCookie(response);
      return applyAuthResponseCookies(response, auth.response);
    }
    if (!res.ok) {
      const raw = await res.text();
      if (auth.authUserId) {
        return degradedAuthProfileResponse({
          email: auth.authEmail || null,
          reason: `backend_${res.status}`,
          req,
          response: auth.response,
          userId: auth.authUserId,
        });
      }
      const identity = await getBearerIdentityOnce();
      if (identity) {
        return degradedAuthProfileResponse({
          email: identity.email,
          reason: `backend_${res.status}`,
          req,
          response: auth.response,
          userId: identity.userId,
        });
      }
      const response = buildUpstreamErrorResponse(res.status, raw);
      return applyAuthResponseCookies(response, auth.response);
    }
    const data = await res.json();
    if (data?.authenticated === true && data?.subscription_active == null) {
      const userId = String(data.user_id || auth.authUserId || "").trim();
      if (userId) {
        const snapshotResponse = snapshotAuthProfileResponse({
          email: String(data.email || auth.authEmail || "").trim() || null,
          reason: "subscription_unknown",
          req,
          response: auth.response,
          userId,
        });
        if (snapshotResponse) return snapshotResponse;
      }
    }
    const response = NextResponse.json(data);
    applyEntitlementSnapshotFromAuthPayload(response, data);
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    if (auth?.authUserId) {
      return degradedAuthProfileResponse({
        email: auth.authEmail || null,
        reason: String(error),
        req,
        response: auth.response,
        userId: auth.authUserId,
      });
    }
    const identity = await getBearerIdentityOnce();
    if (identity) {
      return degradedAuthProfileResponse({
        email: identity.email,
        reason: String(error),
        req,
        response: auth?.response || null,
        userId: identity.userId,
      });
    }
    const snapshotPayload = entitlementSnapshotToAuthPayload(
      readEntitlementSnapshot(req),
    );
    if (snapshotPayload) {
      const snapshotResponse = NextResponse.json({
        ...snapshotPayload,
        entitlement_snapshot_reason: "exception_snapshot",
      });
      return applyAuthResponseCookies(snapshotResponse, auth?.response || null);
    }
    return unauthenticatedAuthProfileResponse({
      reason: String(error),
      response: auth?.response || null,
    });
  }
}

