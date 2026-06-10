import { NextRequest, NextResponse } from "next/server";
import { proxyBackendJsonGet } from "@/lib/api-proxy";
import { buildCityDetailProxyCachePolicy } from "@/lib/proxy-cache-policy";
import {
  createProxyTimer,
  finishProxyTimedResponse,
} from "@/lib/proxy-timing";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;
const DETAIL_BATCH_PROXY_TIMEOUT_MS = Number(
  process.env.POLYWEATHER_CITY_DETAIL_BATCH_PROXY_TIMEOUT_MS || "15000",
);

function parseRequestedCities(req: NextRequest) {
  const requestedLimit = Number(req.nextUrl.searchParams.get("limit") || "12");
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(24, requestedLimit))
    : 12;
  const seen = new Set<string>();
  const requestedCities: string[] = [];

  for (const item of (req.nextUrl.searchParams.get("cities") || "").split(
    ",",
  )) {
    const city = item.trim();
    if (!city || seen.has(city)) continue;
    seen.add(city);
    requestedCities.push(city);
    if (requestedCities.length >= limit) break;
  }

  return requestedCities;
}

function buildCityDetailBatchTimeoutPayload(requestedCities: string[]) {
  const city_status = Object.fromEntries(
    requestedCities.map((city) => [
      city,
      {
        status: "proxy_timeout",
        duration_ms: null,
      },
    ]),
  );
  return {
    cities: requestedCities,
    details: {},
    errors: {},
    missing: requestedCities,
    partial: true,
    timeout: true,
    diagnostics: {
      version: 1,
      response_source: "next_proxy_timeout",
      partial: true,
      partial_reason: "proxy_timeout",
      requested_count: requestedCities.length,
      completed_count: 0,
      missing_count: requestedCities.length,
      error_count: 0,
      proxy_timeout_ms: DETAIL_BATCH_PROXY_TIMEOUT_MS,
      city_status,
    },
  };
}

export async function GET(req: NextRequest) {
  const timer = createProxyTimer(req, "city_detail_batch");
  if (!API_BASE) {
    return finishProxyTimedResponse(
      NextResponse.json(
        { error: "POLYWEATHER_API_BASE_URL is not configured" },
        { status: 500 },
      ),
      timer,
      "missing_api_base",
    );
  }

  const forceRefresh = req.nextUrl.searchParams.get("force_refresh") ?? "false";
  const requestedCities = parseRequestedCities(req);
  const cachePolicy = buildCityDetailProxyCachePolicy(forceRefresh, 15);
  const searchParams = new URLSearchParams({
    cities: req.nextUrl.searchParams.get("cities") || "",
    force_refresh: forceRefresh,
    limit: req.nextUrl.searchParams.get("limit") || "12",
  });
  for (const key of ["market_slug", "target_date", "resolution", "scope"]) {
    const value = req.nextUrl.searchParams.get(key);
    if (value) searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DETAIL_BATCH_PROXY_TIMEOUT_MS);

  try {
    return await proxyBackendJsonGet(req, {
      cacheControl: cachePolicy.responseCacheControl,
      cacheControlForData: (data) =>
        data &&
        typeof data === "object" &&
        (data as { partial?: unknown }).partial === true
          ? "no-store, max-age=0"
          : cachePolicy.responseCacheControl,
      fetchCache: "no-store",
      publicMessage: "Failed to fetch city detail batch",
      revalidateSeconds: cachePolicy.revalidateSeconds,
      signal: controller.signal,
      timeoutResponse: () =>
        NextResponse.json(buildCityDetailBatchTimeoutPayload(requestedCities), {
          headers: { "Cache-Control": "no-store, max-age=0" },
          status: 200,
        }),
      timeoutPublicMessage: "City detail batch request timed out",
      timing: timer,
      url: `${API_BASE}/api/cities/detail-batch?${searchParams.toString()}`,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
