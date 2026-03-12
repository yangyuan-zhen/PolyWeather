import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseMiddlewareClient,
  hasSupabaseServerEnv,
} from "@/lib/supabase/server";

const SESSION_COOKIE = "polyweather_entitlement";
const SUPABASE_AUTH_ENABLED =
  String(process.env.POLYWEATHER_AUTH_ENABLED || "")
    .trim()
    .toLowerCase() === "true";

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
    pathname.startsWith("/static/")
  );
}

function isPublicPage(pathname: string) {
  return (
    pathname === "/entitlement-required" ||
    pathname.startsWith("/auth/login") ||
    pathname.startsWith("/auth/callback")
  );
}

function handleLegacyTokenGate(request: NextRequest) {
  const requiredToken = process.env.POLYWEATHER_DASHBOARD_ACCESS_TOKEN?.trim();
  if (!requiredToken) {
    return NextResponse.next();
  }

  const { pathname, searchParams } = request.nextUrl;
  if (isStaticAsset(pathname) || isPublicPage(pathname)) {
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
  if (isPublicPage(pathname)) {
    return NextResponse.next();
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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isStaticAsset(pathname)) {
    return NextResponse.next();
  }

  if (SUPABASE_AUTH_ENABLED && hasSupabaseServerEnv()) {
    return handleSupabaseAuthGate(request);
  }
  return handleLegacyTokenGate(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
