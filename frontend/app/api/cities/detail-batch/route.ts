import { NextRequest, NextResponse } from "next/server";
import { proxyBackendJsonGet } from "@/lib/api-proxy";
import { buildCityDetailProxyCachePolicy } from "@/lib/proxy-cache-policy";
import {
  createProxyTimer,
  finishProxyTimedResponse,
} from "@/lib/proxy-timing";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;
const DETAIL_BATCH_PROXY_TIMEOUT_MS = Number(
  process.env.POLYWEATHER_CITY_DETAIL_BATCH_PROXY_TIMEOUT_MS || "12000",
);

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
  const cachePolicy = buildCityDetailProxyCachePolicy(forceRefresh, 15);
  const searchParams = new URLSearchParams({
    cities: req.nextUrl.searchParams.get("cities") || "",
    force_refresh: forceRefresh,
    limit: req.nextUrl.searchParams.get("limit") || "12",
  });
  for (const key of ["market_slug", "target_date", "resolution"]) {
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
      timeoutPublicMessage: "City detail batch request timed out",
      timing: timer,
      url: `${API_BASE}/api/cities/detail-batch?${searchParams.toString()}`,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
