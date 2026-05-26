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
import { buildCityDetailProxyCachePolicy } from "@/lib/proxy-cache-policy";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

function normalizeCityDetailPayload(data: unknown) {
  if (!data || typeof data !== "object") return data;
  const payload = data as Record<string, any>;

  // Backend v2 nests hourly under timeseries; chart expects it at top level.
  if (!payload.hourly && payload.timeseries?.hourly) {
    payload.hourly = payload.timeseries.hourly;
  }

  if (!payload.market_scan && payload.market_scan_payload) {
    return {
      ...payload,
      market_scan: payload.market_scan_payload,
    };
  }
  return payload;
}

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
  const cachePolicy = buildCityDetailProxyCachePolicy(forceRefresh, 15);
  const depth = req.nextUrl.searchParams.get("depth");
  const marketSlug = req.nextUrl.searchParams.get("market_slug");
  const targetDate = req.nextUrl.searchParams.get("target_date");
  const resolution = req.nextUrl.searchParams.get("resolution");
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
  if (resolution) {
    searchParams.set("resolution", resolution);
  }
  const url = `${API_BASE}/api/city/${encodeURIComponent(name)}/detail?${searchParams.toString()}`;

  try {
    const auth = await buildBackendRequestHeaders(req, {
      includeSupabaseIdentity: false,
    });
    const res = await fetch(url, {
      headers: auth.headers,
      ...(cachePolicy.fetchMode === "no-store"
        ? { cache: "no-store" as const }
        : { next: { revalidate: cachePolicy.revalidateSeconds ?? 15 } }),
    });
    if (!res.ok) {
      const raw = await res.text();
      const response = buildUpstreamErrorResponse(res.status, raw);
      return applyAuthResponseCookies(response, auth.response);
    }
    const data = normalizeCityDetailPayload(await res.json());
    const response = buildCachedJsonResponse(
      req,
      data,
      cachePolicy.responseCacheControl,
    );
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    const response = buildProxyExceptionResponse(error, {
      publicMessage: "Failed to fetch city detail aggregate",
    });
    return response;
  }
}
