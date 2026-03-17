import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createSupabaseRouteClient, hasSupabaseServerEnv } from "@/lib/supabase/server";

export const BACKEND_ENTITLEMENT_HEADER = "x-polyweather-entitlement";
export const FORWARDED_SUPABASE_USER_ID_HEADER = "x-polyweather-auth-user-id";
export const FORWARDED_SUPABASE_EMAIL_HEADER = "x-polyweather-auth-email";

type HeaderBuildResult = {
  headers: HeadersInit;
  response: NextResponse | null;
};

function extractBearerToken(headerValue: string | null) {
  if (!headerValue) return "";
  const parts = headerValue.trim().split(/\s+/);
  if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
    return parts[1];
  }
  return "";
}

export async function buildBackendRequestHeaders(
  request: NextRequest,
): Promise<HeaderBuildResult> {
  const headers = new Headers({
    Accept: "application/json",
  });
  const backendToken = process.env.POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN?.trim();
  if (backendToken) {
    headers.set(BACKEND_ENTITLEMENT_HEADER, backendToken);
  }

  const incomingAuth = extractBearerToken(request.headers.get("authorization"));
  if (hasSupabaseServerEnv()) {
    const passthroughResponse = new NextResponse(null, { status: 200 });
    const supabase = createSupabaseRouteClient(request, passthroughResponse);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const forwardedUserId = String(user?.id || session?.user?.id || "").trim();
    const forwardedEmail = String(user?.email || session?.user?.email || "").trim();
    if (forwardedUserId) {
      headers.set(FORWARDED_SUPABASE_USER_ID_HEADER, forwardedUserId);
    }
    if (forwardedEmail) {
      headers.set(FORWARDED_SUPABASE_EMAIL_HEADER, forwardedEmail);
    }

    if (incomingAuth) {
      headers.set("Authorization", `Bearer ${incomingAuth}`);
      return { headers, response: passthroughResponse };
    }
    const accessToken = session?.access_token || "";
    if (accessToken) {
      // Fallback to cookie-backed session when request does not carry bearer.
      headers.set("Authorization", `Bearer ${accessToken}`);
    }
    return { headers, response: passthroughResponse };
  }

  if (incomingAuth) {
    headers.set("Authorization", `Bearer ${incomingAuth}`);
  }
  return { headers, response: null };
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
