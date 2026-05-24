import { NextRequest, NextResponse } from "next/server";
import { createSupabaseRouteClient, hasSupabaseServerEnv } from "@/lib/supabase/server";
import { getConfiguredSiteUrl } from "@/lib/site-url";

function normalizeNextPath(input: string | null) {
  const fallback = "/";
  const raw = String(input || "").trim();
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  return raw;
}

export async function GET(request: NextRequest) {
  const configuredSiteUrl = getConfiguredSiteUrl();
  if (configuredSiteUrl) {
    const canonicalOrigin = new URL(configuredSiteUrl).origin;
    if (request.nextUrl.origin !== canonicalOrigin) {
      const canonicalCallbackUrl = new URL(request.nextUrl.pathname, canonicalOrigin);
      canonicalCallbackUrl.search = request.nextUrl.search;
      return NextResponse.redirect(canonicalCallbackUrl);
    }
  }

  const nextPath = normalizeNextPath(request.nextUrl.searchParams.get("next"));
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = nextPath;
  redirectUrl.search = "";

  if (!hasSupabaseServerEnv()) {
    return NextResponse.redirect(redirectUrl);
  }

  const response = NextResponse.redirect(redirectUrl);
  const supabase = createSupabaseRouteClient(request, response);
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  }

  return response;
}
