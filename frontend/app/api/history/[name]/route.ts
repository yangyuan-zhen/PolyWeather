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

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ name: string }> },
) {
  if (!API_BASE) {
    const response = NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
    return response;
  }

  const { name } = await context.params;
  const url = `${API_BASE}/api/history/${encodeURIComponent(name)}`;

  try {
    const auth = await buildBackendRequestHeaders(req, {
      includeSupabaseIdentity: false,
    });
    const fetchOptions = {
      headers: auth.headers,
      next: { revalidate: 60 },
    } as const;
    const res = await fetch(url, {
      ...fetchOptions,
    });
    if (!res.ok) {
      const raw = await res.text();
      const response = buildUpstreamErrorResponse(res.status, raw);
      return applyAuthResponseCookies(response, auth.response);
    }
    const data = await res.json();
    const response = buildCachedJsonResponse(
      req,
      data,
      "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    );
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    const response = buildProxyExceptionResponse(error, {
      publicMessage: "Failed to fetch history",
    });
    return response;
  }
}
