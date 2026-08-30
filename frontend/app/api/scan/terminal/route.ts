import { NextRequest, NextResponse } from "next/server";
import { proxyBackendJsonGet } from "@/lib/api-proxy";
import {
  NO_STORE_CACHE_CONTROL,
} from "@/lib/proxy-cache-policy";
import {
  createProxyTimer,
  finishProxyTimedResponse,
} from "@/lib/proxy-timing";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;
const SCAN_TERMINAL_PROXY_TIMEOUT_MS = Number(
  process.env.POLYWEATHER_SCAN_TERMINAL_PROXY_TIMEOUT_MS || "60000",
);

export const maxDuration = 70;

export async function GET(req: NextRequest) {
  const timer = createProxyTimer(req, "scan_terminal");
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

  const params = new URLSearchParams();
  for (const key of [
    "scan_mode",
    "min_price",
    "max_price",
    "min_edge_pct",
    "min_liquidity",
    "high_liquidity_only",
    "market_type",
    "time_range",
    "limit",
    "force_refresh",
    "diff",
    "since_snapshot_id",
    "timezone_offset_seconds",
  ]) {
    const value = req.nextUrl.searchParams.get(key);
    if (value != null && value !== "") {
      params.set(key, value);
    }
  }
  const tradingRegion = req.nextUrl.searchParams.get("trading_region");
  if (tradingRegion != null && tradingRegion !== "") {
    params.set("region", tradingRegion);
  }
  const url = `${API_BASE}/api/scan/terminal?${params.toString()}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SCAN_TERMINAL_PROXY_TIMEOUT_MS);

  try {
    return await proxyBackendJsonGet(req, {
      cacheControl: NO_STORE_CACHE_CONTROL,
      cacheControlForData: () => NO_STORE_CACHE_CONTROL,
      fetchCache: "no-store",
      publicMessage: "Failed to fetch scan terminal data",
      includeSupabaseIdentity: true,
      signal: controller.signal,
      timeoutPublicMessage: "Scan terminal request timed out",
      timing: timer,
      url,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
