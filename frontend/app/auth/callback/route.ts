import { NextRequest, NextResponse } from "next/server";
import { BACKEND_ENTITLEMENT_HEADER } from "@/lib/backend-auth";
import { createSupabaseRouteClient, hasSupabaseServerEnv } from "@/lib/supabase/server";
import { getConfiguredSiteUrl } from "@/lib/site-url";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

function normalizeNextPath(input: string | null) {
  const fallback = "/";
  const raw = String(input || "").trim();
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  return raw;
}

function normalizeAuthError(input: string | null) {
  const fallback = "Authentication failed. Please sign in again.";
  const raw = String(input || "")
    .replace(/[\r\n]+/g, " ")
    .trim();
  if (!raw) return fallback;
  return raw.slice(0, 240);
}

function redirectToLoginWithError({
  baseUrl,
  error,
  nextPath,
}: {
  baseUrl: string;
  error: string | null;
  nextPath: string;
}) {
  const loginUrl = new URL("/auth/login", baseUrl);
  loginUrl.searchParams.set("next", nextPath);
  loginUrl.searchParams.set("auth_error", "1");
  loginUrl.searchParams.set("error", normalizeAuthError(error));
  return NextResponse.redirect(loginUrl);
}

async function warmSignupTrial(accessToken: string) {
  const token = String(accessToken || "").trim();
  if (!API_BASE || !token) return;

  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  });
  const backendToken = process.env.POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN?.trim();
  if (backendToken) {
    headers.set(BACKEND_ENTITLEMENT_HEADER, backendToken);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);
  try {
    await fetch(`${API_BASE.replace(/\/+$/, "")}/api/auth/me?scope=entitlement`, {
      cache: "no-store",
      headers,
      signal: controller.signal,
    });
  } catch {
    // The account/terminal bootstrap will retry. Callback must not strand login.
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(request: NextRequest) {
  const siteUrl = getConfiguredSiteUrl();
  if (siteUrl) {
    const expectedHost = new URL(siteUrl).host;
    const requestHost =
      request.headers.get("x-forwarded-host") ||
      request.headers.get("host") ||
      "";
    if (requestHost !== expectedHost) {
      const canonicalCallbackUrl = new URL(request.nextUrl.pathname, siteUrl);
      canonicalCallbackUrl.search = request.nextUrl.search;
      return NextResponse.redirect(canonicalCallbackUrl);
    }
  }

  const nextPath = normalizeNextPath(request.nextUrl.searchParams.get("next"));
  const baseUrl = siteUrl || request.nextUrl.origin;
  const redirectUrl = new URL(nextPath, baseUrl);
  const callbackError =
    request.nextUrl.searchParams.get("error_description") ||
    request.nextUrl.searchParams.get("error");
  if (callbackError) {
    return redirectToLoginWithError({
      baseUrl,
      error: callbackError,
      nextPath,
    });
  }

  if (!hasSupabaseServerEnv()) {
    return NextResponse.redirect(redirectUrl);
  }

  const response = NextResponse.redirect(redirectUrl);
  const supabase = createSupabaseRouteClient(request, response);
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const {
      data: { session },
      error: exchangeError,
    } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      return redirectToLoginWithError({
        baseUrl,
        error: exchangeError.message,
        nextPath,
      });
    }
    if (!session?.access_token) {
      return redirectToLoginWithError({
        baseUrl,
        error: "Authentication session was not created. Please sign in again.",
        nextPath,
      });
    }
    await warmSignupTrial(session?.access_token || "");
  }

  return response;
}
