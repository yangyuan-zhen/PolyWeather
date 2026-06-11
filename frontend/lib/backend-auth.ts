import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createSupabaseRouteClient, hasSupabaseServerEnv } from "@/lib/supabase/server";

export const BACKEND_ENTITLEMENT_HEADER = "x-polyweather-entitlement";
export const FORWARDED_SUPABASE_USER_ID_HEADER = "x-polyweather-auth-user-id";
export const FORWARDED_SUPABASE_EMAIL_HEADER = "x-polyweather-auth-email";

export type BackendHeaderBuildResult = {
  headers: HeadersInit;
  response: NextResponse | null;
  authUserId?: string | null;
  authEmail?: string | null;
  hasBearerAuth?: boolean;
};

type HeaderBuildOptions = {
  includeSupabaseIdentity?: boolean;
};

function extractBearerToken(headerValue: string | null) {
  if (!headerValue) return "";
  const parts = headerValue.trim().split(/\s+/);
  if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
    return parts[1];
  }
  return "";
}

function hasSupabaseSessionCookie(request: NextRequest) {
  return request.cookies.getAll().some((cookie) => {
    const name = cookie.name.toLowerCase();
    const value = String(cookie.value || "").trim();
    if (!value) return false;
    return (
      name === "supabase-auth-token" ||
      (name.startsWith("sb-") && name.includes("-auth-token"))
    );
  });
}

export async function buildBackendRequestHeaders(
  request: NextRequest,
  options?: HeaderBuildOptions,
): Promise<BackendHeaderBuildResult> {
  const headers = new Headers({
    Accept: "application/json",
  });
  const backendToken = process.env.POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN?.trim();
  if (backendToken) {
    headers.set(BACKEND_ENTITLEMENT_HEADER, backendToken);
  }

  const incomingAuth = extractBearerToken(request.headers.get("authorization"));
  if (incomingAuth) {
    headers.set("Authorization", `Bearer ${incomingAuth}`);
    return {
      headers,
      response: null,
      authUserId: null,
      authEmail: null,
      hasBearerAuth: true,
    };
  }

  const includeSupabaseIdentity = options?.includeSupabaseIdentity !== false;
  if (hasSupabaseServerEnv() && includeSupabaseIdentity) {
    if (!hasSupabaseSessionCookie(request)) {
      return {
        headers,
        response: null,
        authUserId: null,
        authEmail: null,
        hasBearerAuth: false,
      };
    }

    const passthroughResponse = new NextResponse(null, { status: 200 });
    const supabase = createSupabaseRouteClient(request, passthroughResponse);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const accessToken = session?.access_token || "";
    if (accessToken) {
      // Fallback to cookie-backed session when request does not carry bearer.
      headers.set("Authorization", `Bearer ${accessToken}`);
    }
    const sessionUser = session?.user;
    const forwardedUserId = String(sessionUser?.id || "").trim();
    const forwardedEmail = String(sessionUser?.email || "").trim();
    if (forwardedUserId) {
      headers.set(FORWARDED_SUPABASE_USER_ID_HEADER, forwardedUserId);
    }
    if (forwardedEmail) {
      headers.set(FORWARDED_SUPABASE_EMAIL_HEADER, forwardedEmail);
    }
    return {
      headers,
      response: passthroughResponse,
      authUserId: forwardedUserId || null,
      authEmail: forwardedEmail || null,
      hasBearerAuth: Boolean(accessToken),
    };
  }

  return {
    headers,
    response: null,
    authUserId: null,
    authEmail: null,
    hasBearerAuth: false,
  };
}

export function applyAuthResponseCookies(
  target: NextResponse,
  source: NextResponse | null,
) {
  if (!source) return target;
  for (const [name, value] of source.headers.entries()) {
    if (name.toLowerCase() === "set-cookie") {
      target.headers.append(name, value);
    }
  }
  return target;
}

export function buildJsonBackendRequestHeaders(headers: HeadersInit) {
  const result = new Headers(headers);
  result.set("Content-Type", "application/json");
  return result;
}

export function requireBackendAuthUser(auth: BackendHeaderBuildResult) {
  if (auth.authUserId) return null;
  return applyAuthResponseCookies(
    NextResponse.json(
      { error: "Authentication required", detail: "Supabase user required" },
      { status: 401 },
    ),
    auth.response,
  );
}

export function requireBackendPaymentAuth(auth: BackendHeaderBuildResult) {
  if (auth.authUserId || auth.hasBearerAuth) return null;
  return requireBackendAuthUser(auth);
}
