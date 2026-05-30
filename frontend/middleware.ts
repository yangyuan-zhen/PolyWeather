import { NextRequest, NextResponse } from "next/server";
import {
  hasSupabaseSessionCookieValues,
  hasSupabaseServerEnv,
  refreshMiddlewareSession,
} from "@/lib/supabase/server";
import { isLocalFullAccessHost } from "@/lib/local-dev-access";

function readEnvBool(name: string, fallback: boolean) {
  const raw = process.env[name];
  if (raw == null) return fallback;
  return String(raw).trim().toLowerCase() === "true";
}

const SUPABASE_AUTH_ENABLED =
  readEnvBool("POLYWEATHER_AUTH_ENABLED", false);
const SUPABASE_AUTH_REQUIRED = readEnvBool(
  "POLYWEATHER_AUTH_REQUIRED",
  SUPABASE_AUTH_ENABLED,
);

function isPublicPage(pathname: string) {
  return (
    pathname === "/" ||
    pathname.startsWith("/docs") ||
    pathname.startsWith("/subscription-help") ||
    pathname.startsWith("/auth/login") ||
    pathname.startsWith("/auth/callback")
  );
}

function isPublicApi(pathname: string) {
  return (
    pathname === "/api/auth/me" ||
    pathname === "/api/analytics/events" ||
    pathname === "/api/cities" ||
    pathname === "/api/payments/config" ||
    pathname === "/api/scan/terminal" ||
    pathname === "/api/system/status" ||
    pathname === "/api/vitals" ||
    /^\/api\/city\/[^/]+$/i.test(pathname) ||
    /^\/api\/city\/[^/]+\/summary$/i.test(pathname) ||
    /^\/api\/city\/[^/]+\/detail$/i.test(pathname) ||
    /^\/api\/city\/[^/]+\/market-scan$/i.test(pathname)
  );
}

function shouldRefreshOptionalSupabaseSession(pathname: string) {
  return (
    pathname.startsWith("/account") ||
    pathname.startsWith("/ops")
  );
}

function hasSupabaseSessionCookie(request: NextRequest) {
  return hasSupabaseSessionCookieValues(
    request.cookies.getAll().map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
    })),
  );
}

function redirectToLogin(request: NextRequest, pathname: string) {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/auth/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

function unauthorizedSupabaseSessionResponse() {
  return NextResponse.json(
    { error: "Unauthorized", detail: "Supabase session required" },
    { status: 401 },
  );
}

// ─── Layer 1: Unauthenticated redirect for /terminal ─────────────────────────
// Runs for every /terminal request when Supabase is configured.
// Does NOT check subscription — that's handled client-side (Layer 2).
// This mirrors Koyfin: unauthenticated visitors are sent to /auth/login first.
async function handleTerminalGate(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Only gate /terminal routes
  if (!pathname.startsWith("/terminal")) {
    return NextResponse.next();
  }

  // No Supabase env → fall through to legacy token gate
  if (!hasSupabaseServerEnv()) {
    return NextResponse.next();
  }

  if (!hasSupabaseSessionCookie(request)) {
    return redirectToLogin(request, pathname);
  }

  const { response, user } = await refreshMiddlewareSession(request);

  if (user) {
    // Authenticated — pass through. Terminal client handles subscription gate.
    return response;
  }

  // A session cookie exists, but the edge/server refresh can occasionally fail
  // during a long-lived terminal tab. Do not navigate an active dashboard away
  // on a transient claims failure; the client can still verify via bearer auth
  // and render the in-product access gate if the session is truly gone.
  return response;
}

async function handleSupabaseAuthGate(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPage(pathname) || isPublicApi(pathname)) {
    return NextResponse.next();
  }

  if (!hasSupabaseSessionCookie(request)) {
    if (pathname.startsWith("/api/")) {
      return unauthorizedSupabaseSessionResponse();
    }
    return redirectToLogin(request, pathname);
  }

  const { response, user } = await refreshMiddlewareSession(request);

  if (user) {
    return response;
  }

  if (pathname.startsWith("/api/")) {
    return unauthorizedSupabaseSessionResponse();
  }

  return redirectToLogin(request, pathname);
}

async function handleSupabaseOptionalSession(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    isPublicPage(pathname) ||
    isPublicApi(pathname) ||
    !shouldRefreshOptionalSupabaseSession(pathname)
  ) {
    return NextResponse.next();
  }

  if (!hasSupabaseSessionCookie(request)) {
    return NextResponse.next();
  }

  const { response } = await refreshMiddlewareSession(request);
  return response;
}

export async function middleware(request: NextRequest) {
  const requestHost =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    request.nextUrl.host;

  // Local development: bypass all gates
  if (
    isLocalFullAccessHost(requestHost) ||
    isLocalFullAccessHost(request.nextUrl.hostname)
  ) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  // ── Terminal gate runs first, independently of global auth mode ──────────
  // This is the Koyfin-style Layer 1: send unauthenticated users to /auth/login
  // before they ever reach the terminal, eliminating the jarring "enter product
  // then see a paywall" experience.
  if (pathname.startsWith("/terminal") && hasSupabaseServerEnv()) {
    return handleTerminalGate(request);
  }

  // ── Global auth modes ─────────────────────────────────────────────────────
  if (SUPABASE_AUTH_ENABLED && hasSupabaseServerEnv()) {
    if (SUPABASE_AUTH_REQUIRED) {
      return handleSupabaseAuthGate(request);
    }
    return handleSupabaseOptionalSession(request);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/account/:path*",
    "/terminal/:path*",
    "/terminal",
    "/ops/:path*",
    "/api/auth/:path*",
    "/api/ops/:path*",
    "/api/payments/:path*",
    "/api/system/:path*",
    "/api/city/:path*/detail:path*",
  ],
};
