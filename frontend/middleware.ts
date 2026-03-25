import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseMiddlewareClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";

const SESSION_COOKIE = "polyweather_entitlement";

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

function isStaticAsset(pathname: string) {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname === "/apple-touch-icon.png" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/site.webmanifest" ||
    pathname.startsWith("/android-chrome-") ||
    pathname.startsWith("/robots.txt") ||
    pathname.startsWith("/sitemap.xml") ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/images/") ||
    pathname.startsWith("/scenery/") ||
    pathname.startsWith("/static/")
  );
}

function isPublicPage(pathname: string) {
  return (
    pathname === "/" ||
    pathname.startsWith("/docs") ||
    pathname.startsWith("/subscription-help") ||
    pathname === "/entitlement-required" ||
    pathname.startsWith("/auth/login") ||
    pathname.startsWith("/auth/callback")
  );
}

function isPublicApi(pathname: string) {
  return (
    pathname === "/api/auth/me" ||
    pathname === "/api/cities" ||
    pathname === "/api/vitals" ||
    /^\/api\/city\/[^/]+$/i.test(pathname) ||
    /^\/api\/city\/[^/]+\/summary$/i.test(pathname)
  );
}

function handleLegacyTokenGate(request: NextRequest) {
  const requiredToken = process.env.POLYWEATHER_DASHBOARD_ACCESS_TOKEN?.trim();
  if (!requiredToken) {
    return NextResponse.next();
  }

  const { pathname, searchParams } = request.nextUrl;
  if (isStaticAsset(pathname) || isPublicPage(pathname) || isPublicApi(pathname)) {
    return NextResponse.next();
  }

  const cookieToken = request.cookies.get(SESSION_COOKIE)?.value;
  if (cookieToken && cookieToken === requiredToken) {
    return NextResponse.next();
  }

  const queryToken = searchParams.get("access_token");
  if (queryToken && queryToken === requiredToken) {
    const cleanUrl = request.nextUrl.clone();
    cleanUrl.searchParams.delete("access_token");

    const response = NextResponse.redirect(cleanUrl);
    response.cookies.set(SESSION_COOKIE, requiredToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: cleanUrl.protocol === "https:",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    return response;
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Unauthorized", detail: "Entitlement token required" },
      { status: 401 },
    );
  }

  const deniedUrl = request.nextUrl.clone();
  deniedUrl.pathname = "/entitlement-required";
  deniedUrl.search = "";
  deniedUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(deniedUrl);
}

async function handleSupabaseAuthGate(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPage(pathname) || isPublicApi(pathname)) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) {
    const authHeader = String(request.headers.get("authorization") || "").trim();
    if (/^bearer\s+\S+/i.test(authHeader)) {
      return NextResponse.next();
    }
  }

  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });
  const supabase = createSupabaseMiddlewareClient(request, response);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    return response;
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Unauthorized", detail: "Supabase session required" },
      { status: 401 },
    );
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/auth/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

async function handleSupabaseOptionalSession(request: NextRequest) {
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });
  const supabase = createSupabaseMiddlewareClient(request, response);
  await supabase.auth.getUser();
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  if (SUPABASE_AUTH_ENABLED && hasSupabaseServerEnv()) {
    if (SUPABASE_AUTH_REQUIRED) {
      return handleSupabaseAuthGate(request);
    }
    return handleSupabaseOptionalSession(request);
  }
  return handleLegacyTokenGate(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
