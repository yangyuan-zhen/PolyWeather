import { NextRequest, NextResponse } from "next/server";
import { proxyBackendJsonGet } from "@/lib/api-proxy";
import { NO_STORE_CACHE_CONTROL } from "@/lib/proxy-cache-policy";
import {
  createProxyTimer,
  finishProxyTimedResponse,
} from "@/lib/proxy-timing";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;
const ARBITRAGE_BATCH_PROXY_TIMEOUT_MS = Number(
  process.env.POLYWEATHER_ARBITRAGE_BATCH_PROXY_TIMEOUT_MS || "15000",
);

export const maxDuration = 70;

function parseRequestedCities(req: NextRequest) {
  const requestedLimit = Number(req.nextUrl.searchParams.get("limit") || "50");
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(50, requestedLimit))
    : 50;
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

function buildArbitrageBatchTimeoutPayload(requestedCities: string[]) {
  return {
    cities: requestedCities,
    details: {},
    errors: {},
    missing: requestedCities,
    partial: true,
    timeout: true,
    _meta: {
      response_source: "next_proxy_timeout",
      requested_count: requestedCities.length,
      completed_count: 0,
      missing_count: requestedCities.length,
      error_count: 0,
      proxy_timeout_ms: ARBITRAGE_BATCH_PROXY_TIMEOUT_MS,
    },
  };
}

export async function GET(req: NextRequest) {
  const timer = createProxyTimer(req, "arbitrage_overview_batch");
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
  const searchParams = new URLSearchParams({
    cities: req.nextUrl.searchParams.get("cities") || "",
    force_refresh: forceRefresh,
    limit: req.nextUrl.searchParams.get("limit") || "50",
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    ARBITRAGE_BATCH_PROXY_TIMEOUT_MS,
  );

  try {
    return await proxyBackendJsonGet(req, {
      cacheControl: NO_STORE_CACHE_CONTROL,
      cacheControlForData: (data) =>
        data &&
        typeof data === "object" &&
        (data as { partial?: unknown }).partial === true
          ? NO_STORE_CACHE_CONTROL
          : NO_STORE_CACHE_CONTROL,
      fetchCache: "no-store",
      includeSupabaseIdentity: true,
      publicMessage: "Failed to fetch arbitrage overview batch",
      signal: controller.signal,
      timeoutResponse: () =>
        NextResponse.json(buildArbitrageBatchTimeoutPayload(requestedCities), {
          headers: {
            "Cache-Control": NO_STORE_CACHE_CONTROL,
            "Cloudflare-CDN-Cache-Control": NO_STORE_CACHE_CONTROL,
          },
          status: 200,
        }),
      timeoutPublicMessage: "Arbitrage overview batch request timed out",
      timing: timer,
      url: `${API_BASE}/api/arbitrage/overview-batch?${searchParams.toString()}`,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
