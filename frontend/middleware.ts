import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "polyweather_entitlement";

function isStaticAsset(pathname: string) {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/robots.txt") ||
    pathname.startsWith("/sitemap.xml") ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/images/") ||
    pathname.startsWith("/static/")
  );
}

function isPublicPage(pathname: string) {
  return pathname === "/entitlement-required";
}

export function middleware(request: NextRequest) {
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

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
