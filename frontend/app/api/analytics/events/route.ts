import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";
import {
  buildProxyExceptionResponse,
  buildUpstreamErrorResponse,
} from "@/lib/api-proxy";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;
const ANALYTICS_ENABLED =
  process.env.NEXT_PUBLIC_POLYWEATHER_APP_ANALYTICS === "true";

export async function POST(req: NextRequest) {
  if (!ANALYTICS_ENABLED) {
    return new NextResponse(null, { status: 204 });
  }

  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }

  try {
    const body = await req.json();
    const auth = await buildBackendRequestHeaders(req, {
      includeSupabaseIdentity: false,
    });
    const headers = new Headers(auth.headers);
    headers.set("Content-Type", "application/json");
    const res = await fetch(`${API_BASE}/api/analytics/events`, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
    });
    if (!res.ok) {
      const raw = await res.text();
      const response = buildUpstreamErrorResponse(res.status, raw, {
        detailLimit: 260,
      });
      return applyAuthResponseCookies(response, auth.response);
    }
    const data = await res.json();
    const response = NextResponse.json(data);
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    return buildProxyExceptionResponse(error, {
      publicMessage: "Failed to track analytics event",
    });
  }
}
