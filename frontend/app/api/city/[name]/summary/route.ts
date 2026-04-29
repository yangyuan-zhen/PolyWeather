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
  const forceRefresh = req.nextUrl.searchParams.get("force_refresh") ?? "false";
  const bypassCache = forceRefresh === "true";
  const url = `${API_BASE}/api/city/${encodeURIComponent(name)}/summary?force_refresh=${forceRefresh}`;

  try {
    const auth = await buildBackendRequestHeaders(req, {
      includeSupabaseIdentity: false,
    });
    const fetchOptions =
      bypassCache
        ? {
            headers: auth.headers,
            cache: "no-store" as const,
          }
        : {
            headers: auth.headers,
            next: { revalidate: 20 },
          };
    const res = await fetch(url, {
      ...fetchOptions,
    });
    if (!res.ok) {
      const raw = await res.text();
      const response = buildUpstreamErrorResponse(res.status, raw);
      return applyAuthResponseCookies(response, auth.response);
    }
    const data = await res.json();
    if (bypassCache) {
      const response = NextResponse.json(data, {
        headers: {
          "Cache-Control": "no-store",
        },
      });
      return applyAuthResponseCookies(response, auth.response);
    }
    const response = buildCachedJsonResponse(
      req,
      data,
      "public, max-age=0, s-maxage=20, stale-while-revalidate=60",
    );
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    const response = buildProxyExceptionResponse(error, {
      publicMessage: "Failed to fetch city summary",
    });
    return response;
  }
}
