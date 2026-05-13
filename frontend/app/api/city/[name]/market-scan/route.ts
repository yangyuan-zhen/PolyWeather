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
  const params = new URLSearchParams();
  const forceRefresh = req.nextUrl.searchParams.get("force_refresh") ?? "false";
  params.set("force_refresh", forceRefresh);

  const targetDate = req.nextUrl.searchParams.get("target_date");
  if (targetDate) {
    params.set("target_date", targetDate);
  }

  const marketSlug = req.nextUrl.searchParams.get("market_slug");
  if (marketSlug) {
    params.set("market_slug", marketSlug);
  }

  const lite = req.nextUrl.searchParams.get("lite");
  if (lite) {
    params.set("lite", lite);
  }

  const url = `${API_BASE}/api/city/${encodeURIComponent(name)}/market-scan?${params.toString()}`;

  try {
    const auth = await buildBackendRequestHeaders(req, {
      includeSupabaseIdentity: false,
    });
    const res = await fetch(url, {
      headers: auth.headers,
      next: { revalidate: 20 },
    });
    if (!res.ok) {
      const raw = await res.text();
      const response = buildUpstreamErrorResponse(res.status, raw, {
        detailLimit: 800,
        error: "Backend city market scan failed",
      });
      return applyAuthResponseCookies(response, auth.response);
    }
    const data = await res.json();
    const response = buildCachedJsonResponse(
      req,
      data,
      "public, max-age=0, s-maxage=20, stale-while-revalidate=60",
    );
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    const response = buildProxyExceptionResponse(error, {
      publicMessage: "Failed to fetch city market scan",
      status: 502,
    });
    return response;
  }
}
