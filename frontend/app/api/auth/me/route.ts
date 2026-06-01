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

type AuthMeTimingStage = {
  durationMs: number;
  name: string;
};

type AuthMeTimer = {
  hasAuthorization: boolean;
  hasSupabaseCookie: boolean;
  measure<T>(name: string, action: () => Promise<T>): Promise<T>;
  measureSync<T>(name: string, action: () => T): T;
  preferSnapshot: boolean;
  stages: AuthMeTimingStage[];
  totalMs(): number;
};

function authMeNowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function createAuthMeTimer(req: NextRequest): AuthMeTimer {
  const startedAt = authMeNowMs();
  const stages: AuthMeTimingStage[] = [];
  const recordStage = (name: string, stageStartedAt: number) => {
    stages.push({
      durationMs: Math.round((authMeNowMs() - stageStartedAt) * 10) / 10,
      name,
    });
  };

  return {
    hasAuthorization: Boolean(req.headers.get("authorization")),
    hasSupabaseCookie: hasRequestSupabaseSessionCookie(req),
    async measure<T>(name: string, action: () => Promise<T>) {
      const stageStartedAt = authMeNowMs();
      try {
        return await action();
      } finally {
        recordStage(name, stageStartedAt);
      }
    },
    measureSync<T>(name: string, action: () => T) {
      const stageStartedAt = authMeNowMs();
      try {
        return action();
      } finally {
        recordStage(name, stageStartedAt);
      }
    },
    preferSnapshot: req.nextUrl.searchParams.get("prefer_snapshot") === "1",
    stages,
    totalMs() {
      return Math.round((authMeNowMs() - startedAt) * 10) / 10;
    },
  };
}

function formatServerTiming(stages: AuthMeTimingStage[], totalMs: number) {
  return [...stages, { durationMs: totalMs, name: "total" }]
    .map(({ durationMs, name }) => {
      const safeName = name.replace(/[^A-Za-z0-9_-]/g, "_");
      return `${safeName};dur=${Math.max(0, durationMs).toFixed(1)}`;
    })
    .join(", ");
}

function buildBackendAuthMeUrl(req: NextRequest) {
  const url = new URL(`${API_BASE!.replace(/\/+$/, "")}/api/auth/me`);
  if (req.nextUrl.searchParams.get("scope") === "entitlement") {
    url.searchParams.set("scope", "entitlement");
  }
  return url.toString();
}

function finishAuthMeResponse(
  response: NextResponse,
  timer: AuthMeTimer,
  outcome: string,
  extra?: { backendServerTiming?: string },
) {
  const total = timer.totalMs();
  const ownServerTiming = formatServerTiming(timer.stages, total);
  const backendServerTiming = String(extra?.backendServerTiming || "").trim();
  response.headers.set(
    "Server-Timing",
    backendServerTiming
      ? `${ownServerTiming}, ${backendServerTiming}`
      : ownServerTiming,
  );
  console.info(
    "[auth-me-timing]",
    JSON.stringify({
      backendServerTiming: backendServerTiming || undefined,
      hasAuthorization: timer.hasAuthorization,
      hasSupabaseCookie: timer.hasSupabaseCookie,
      outcome,
      preferSnapshot: timer.preferSnapshot,
      stagesMs: Object.fromEntries(
        timer.stages.map((stage) => [stage.name, stage.durationMs]),
      ),
      status: response.status,
      totalMs: total,
    }),
  );
  return response;
}

async function trackAuthDiagnosticEvent(
  req: NextRequest,
  {
    email,
    reason,
    responseMode,
    userId,
  }: {
    email: string | null;
    reason: string;
    responseMode: "snapshot" | "degraded" | "anonymous";
    userId?: string | null;
  },
) {
  if (!API_BASE) return;
  const normalizedUserId = String(userId || "").trim();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 1200);
  try {
    await fetch(`${API_BASE}/api/analytics/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "degraded_auth_profile",
        client_id: normalizedUserId ? `auth:${normalizedUserId}` : undefined,
        payload: {
          route: "/api/auth/me",
          reason: String(reason || "unknown").slice(0, 240),
          response_mode: responseMode,
          user_id: normalizedUserId || undefined,
          email_domain: email?.includes("@") ? email.split("@").pop() : undefined,
          cf_country:
            req.headers.get("cf-ipcountry") ||
            req.headers.get("x-vercel-ip-country") ||
            "",
          user_agent: req.headers.get("user-agent") || "",
          referer_header: req.headers.get("referer") || "",
          captured_at: new Date().toISOString(),
        },
      }),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    // Diagnostics must never block auth/profile fallback responses.
  } finally {
    clearTimeout(timeoutId);
  }
}

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

async function degradedAuthProfileResponse({
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
    await trackAuthDiagnosticEvent(req, {
      email: snapshotPayload.email || email,
      reason,
      responseMode: "snapshot",
      userId,
    });
    const snapshotResponse = NextResponse.json({
      ...snapshotPayload,
      email: snapshotPayload.email || email,
      entitlement_snapshot_reason: reason,
    });
    return applyAuthResponseCookies(snapshotResponse, response);
  }

  await trackAuthDiagnosticEvent(req, {
    email,
    reason,
    responseMode: "degraded",
    userId,
  });
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

async function unauthenticatedAuthProfileResponse({
  reason,
  req,
  response,
}: {
  reason: string;
  req: NextRequest;
  response: NextResponse | null;
}) {
  await trackAuthDiagnosticEvent(req, {
    email: null,
    reason,
    responseMode: "anonymous",
  });
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
  const timer = createAuthMeTimer(req);
  const requestHost =
    req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host;
  if (
    isLocalFullAccessHost(requestHost) ||
    isLocalFullAccessHost(req.nextUrl.hostname)
  ) {
    return finishAuthMeResponse(
      NextResponse.json(getLocalDevAuthPayload(), {
        headers: { "Cache-Control": "no-store" },
      }),
      timer,
      "local_full_access",
    );
  }

  if (!API_BASE) {
    return finishAuthMeResponse(
      NextResponse.json(
        { error: "POLYWEATHER_API_BASE_URL is not configured" },
        { status: 500 },
      ),
      timer,
      "missing_api_base",
    );
  }

  const preferSnapshot = req.nextUrl.searchParams.get("prefer_snapshot") === "1";
  if (
    preferSnapshot &&
    !req.headers.get("authorization") &&
    hasRequestSupabaseSessionCookie(req)
  ) {
    const snapshotPayload = timer.measureSync(
      "snapshot_cookie",
      () => entitlementSnapshotToAuthPayload(readEntitlementSnapshot(req)),
    );
    if (snapshotPayload) {
      return finishAuthMeResponse(
        NextResponse.json(
          {
            ...snapshotPayload,
            entitlement_snapshot_reason: "prefer_snapshot_fast_path",
          },
          { headers: { "Cache-Control": "no-store" } },
        ),
        timer,
        "prefer_snapshot_fast_path",
      );
    }
  }

  let auth: Awaited<ReturnType<typeof buildBackendRequestHeaders>> | null = null;
  let bearerIdentity: VerifiedBearerIdentity | null | undefined;
  const getBearerIdentityOnce = async () => {
    if (bearerIdentity !== undefined) return bearerIdentity;
    bearerIdentity = await timer.measure(
      "bearer_identity",
      () => getVerifiedBearerIdentity(req),
    );
    return bearerIdentity;
  };
  try {
    auth = await timer.measure(
      "auth_headers",
      () => buildBackendRequestHeaders(req),
    );
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
      return finishAuthMeResponse(
        applyAuthResponseCookies(response, auth.response),
        timer,
        "no_session",
      );
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
        if (snapshotResponse) {
          return finishAuthMeResponse(
            snapshotResponse,
            timer,
            "prefer_snapshot",
          );
        }
      }
    }

    if (!auth) throw new Error("auth headers unavailable");
    const backendAuth = auth;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    let res: Response;
    try {
      res = await timer.measure("backend_fetch", async () =>
        await fetch(buildBackendAuthMeUrl(req), {
          headers: backendAuth.headers,
          cache: "no-store",
          signal: controller.signal,
        }),
      );
    } finally {
      clearTimeout(timeoutId);
    }
    const backendServerTiming = res.headers.get("server-timing") || "";
    if (res.status === 401 || res.status === 403) {
      const raw = await timer.measure("backend_read", () => res.text());
      const authIdentity = auth.authUserId
        ? { email: auth.authEmail || null, userId: auth.authUserId }
        : await getBearerIdentityOnce();
      if (
        authIdentity?.userId &&
        isSubscriptionRequiredBackendResponse(res.status, raw)
      ) {
        return finishAuthMeResponse(
          subscriptionRequiredAuthProfileResponse({
            email: authIdentity.email,
            response: auth.response,
            userId: authIdentity.userId,
          }),
          timer,
          "subscription_required",
          { backendServerTiming },
        );
      }
      if (auth.authUserId) {
        return finishAuthMeResponse(
          await degradedAuthProfileResponse({
            email: auth.authEmail || null,
            reason: `backend_${res.status}`,
            req,
            response: auth.response,
            userId: auth.authUserId,
          }),
          timer,
          `degraded_backend_${res.status}`,
          { backendServerTiming },
        );
      }
      const identity = await getBearerIdentityOnce();
      if (identity) {
        return finishAuthMeResponse(
          await degradedAuthProfileResponse({
            email: identity.email,
            reason: `backend_${res.status}`,
            req,
            response: auth.response,
            userId: identity.userId,
          }),
          timer,
          `degraded_backend_${res.status}`,
          { backendServerTiming },
        );
      }
      const response = NextResponse.json({
        authenticated: false,
        subscription_active: false,
        points: 0,
      });
      clearEntitlementSnapshotCookie(response);
      return finishAuthMeResponse(
        applyAuthResponseCookies(response, auth.response),
        timer,
        `anonymous_backend_${res.status}`,
        { backendServerTiming },
      );
    }
    if (!res.ok) {
      const raw = await timer.measure("backend_read", () => res.text());
      if (auth.authUserId) {
        return finishAuthMeResponse(
          await degradedAuthProfileResponse({
            email: auth.authEmail || null,
            reason: `backend_${res.status}`,
            req,
            response: auth.response,
            userId: auth.authUserId,
          }),
          timer,
          `degraded_backend_${res.status}`,
          { backendServerTiming },
        );
      }
      const identity = await getBearerIdentityOnce();
      if (identity) {
        return finishAuthMeResponse(
          await degradedAuthProfileResponse({
            email: identity.email,
            reason: `backend_${res.status}`,
            req,
            response: auth.response,
            userId: identity.userId,
          }),
          timer,
          `degraded_backend_${res.status}`,
          { backendServerTiming },
        );
      }
      const response = buildUpstreamErrorResponse(res.status, raw);
      return finishAuthMeResponse(
        applyAuthResponseCookies(response, auth.response),
        timer,
        `upstream_${res.status}`,
        { backendServerTiming },
      );
    }
    const data = await timer.measure("backend_read", () => res.json());
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
        if (snapshotResponse) {
          return finishAuthMeResponse(
            snapshotResponse,
            timer,
            "subscription_unknown_snapshot",
            { backendServerTiming },
          );
        }
      }
    }
    const response = NextResponse.json(data);
    applyEntitlementSnapshotFromAuthPayload(response, data);
    return finishAuthMeResponse(
      applyAuthResponseCookies(response, auth.response),
      timer,
      "ok",
      { backendServerTiming },
    );
  } catch (error) {
    if (auth?.authUserId) {
      return finishAuthMeResponse(
        await degradedAuthProfileResponse({
          email: auth.authEmail || null,
          reason: String(error),
          req,
          response: auth.response,
          userId: auth.authUserId,
        }),
        timer,
        "exception_degraded",
      );
    }
    const identity = await getBearerIdentityOnce();
    if (identity) {
      return finishAuthMeResponse(
        await degradedAuthProfileResponse({
          email: identity.email,
          reason: String(error),
          req,
          response: auth?.response || null,
          userId: identity.userId,
        }),
        timer,
        "exception_degraded",
      );
    }
    const snapshotPayload = timer.measureSync(
      "snapshot_cookie",
      () => entitlementSnapshotToAuthPayload(readEntitlementSnapshot(req)),
    );
    if (snapshotPayload) {
      const snapshotResponse = NextResponse.json({
        ...snapshotPayload,
        entitlement_snapshot_reason: "exception_snapshot",
      });
      return finishAuthMeResponse(
        applyAuthResponseCookies(snapshotResponse, auth?.response || null),
        timer,
        "exception_snapshot",
      );
    }
    return finishAuthMeResponse(
      await unauthenticatedAuthProfileResponse({
        reason: String(error),
        req,
        response: auth?.response || null,
      }),
      timer,
      "exception_anonymous",
    );
  }
}

