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
  const depth = req.nextUrl.searchParams.get("depth");
  const marketSlug = req.nextUrl.searchParams.get("market_slug");
  const targetDate = req.nextUrl.searchParams.get("target_date");
  const searchParams = new URLSearchParams({
    force_refresh: forceRefresh,
  });
  if (depth) {
    searchParams.set("depth", depth);
  }
  if (marketSlug) {
    searchParams.set("market_slug", marketSlug);
  }
  if (targetDate) {
    searchParams.set("target_date", targetDate);
  }
  const url = `${API_BASE}/api/city/${encodeURIComponent(name)}/detail?${searchParams.toString()}`;

  try {
    const auth = await buildBackendRequestHeaders(req, {
      includeSupabaseIdentity: false,
    });
    const res = await fetch(url, {
      headers: auth.headers,
      next: { revalidate: 15 },
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
      "public, max-age=0, s-maxage=15, stale-while-revalidate=45",
    );
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    const response = buildProxyExceptionResponse(error, {
      publicMessage: "Failed to fetch city detail aggregate",
    });
    return response;
  }
}
