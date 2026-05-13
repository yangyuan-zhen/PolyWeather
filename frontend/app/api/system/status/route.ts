import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";
import {
  buildProxyExceptionResponse,
  buildUpstreamErrorResponse,
} from "@/lib/api-proxy";
import { buildCachedJsonResponse } from "@/lib/http-cache";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

export async function GET(req: NextRequest) {
  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }

  try {
    const auth = await buildBackendRequestHeaders(req, {
      includeSupabaseIdentity: false,
    });
    const res = await fetch(`${API_BASE}/api/system/status`, {
      headers: auth.headers,
      next: { revalidate: 30 },
    });
    if (!res.ok) {
      const raw = await res.text();
      const response = buildUpstreamErrorResponse(res.status, raw, {
        detailLimit: 500,
      });
      return applyAuthResponseCookies(response, auth.response);
    }

    const data = await res.json();
    const response = buildCachedJsonResponse(
      req,
      data,
      "public, max-age=0, s-maxage=30, stale-while-revalidate=120",
    );
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    return buildProxyExceptionResponse(error, {
      publicMessage: "Failed to fetch system status",
    });
  }
}
