import { NextRequest, NextResponse } from "next/server";
import { proxyBackendJsonGet } from "@/lib/api-proxy";
import { NO_STORE_CACHE_CONTROL } from "@/lib/proxy-cache-policy";
import {
  createProxyTimer,
  finishProxyTimedResponse,
} from "@/lib/proxy-timing";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;
const ARBITRAGE_PROXY_TIMEOUT_MS = Number(
  process.env.POLYWEATHER_ARBITRAGE_PROXY_TIMEOUT_MS || "60000",
);

export const maxDuration = 70;

// 代理后端 GET /api/arbitrage/cities（无 query 参数转发）。
export async function GET(req: NextRequest) {
  const timer = createProxyTimer(req, "arbitrage_cities");
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

  const url = `${API_BASE}/api/arbitrage/cities`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ARBITRAGE_PROXY_TIMEOUT_MS);

  try {
    return await proxyBackendJsonGet(req, {
      cacheControl: NO_STORE_CACHE_CONTROL,
      cacheControlForData: () => NO_STORE_CACHE_CONTROL,
      fetchCache: "no-store",
      publicMessage: "Failed to fetch arbitrage cities",
      includeSupabaseIdentity: true,
      signal: controller.signal,
      timeoutPublicMessage: "Arbitrage cities request timed out",
      timing: timer,
      url,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
