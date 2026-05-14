import { NextRequest, NextResponse } from "next/server";
import { proxyBackendJsonGet } from "@/lib/api-proxy";
import { buildForceRefreshProxyCachePolicy } from "@/lib/proxy-cache-policy";

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
  const cachePolicy = buildForceRefreshProxyCachePolicy(forceRefresh, 20);

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

  return proxyBackendJsonGet(req, {
    cacheControl: cachePolicy.responseCacheControl,
    detailLimit: 800,
    error: "Backend city market scan failed",
    fetchCache:
      cachePolicy.fetchMode === "no-store" ? "no-store" : undefined,
    publicMessage: "Failed to fetch city market scan",
    revalidateSeconds: cachePolicy.revalidateSeconds,
    statusOnException: 502,
    url,
  });
}
