import { NextRequest, NextResponse } from "next/server";
import { proxyBackendJsonGet } from "@/lib/api-proxy";
import { buildCityDetailProxyCachePolicy } from "@/lib/proxy-cache-policy";

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
  const cachePolicy = buildCityDetailProxyCachePolicy(forceRefresh, 15);
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

  return proxyBackendJsonGet(req, {
    cacheControl: cachePolicy.responseCacheControl,
    fetchCache:
      cachePolicy.fetchMode === "no-store" ? "no-store" : undefined,
    publicMessage: "Failed to fetch city detail aggregate",
    revalidateSeconds: cachePolicy.revalidateSeconds,
    url,
  });
}
