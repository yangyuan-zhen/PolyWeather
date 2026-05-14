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
  const forceRefresh = req.nextUrl.searchParams.get("force_refresh") ?? "false";
  const cachePolicy = buildForceRefreshProxyCachePolicy(forceRefresh, 20);
  const url = `${API_BASE}/api/city/${encodeURIComponent(name)}/summary?force_refresh=${forceRefresh}`;

  return proxyBackendJsonGet(req, {
    cacheControl: cachePolicy.responseCacheControl,
    fetchCache:
      cachePolicy.fetchMode === "no-store" ? "no-store" : undefined,
    publicMessage: "Failed to fetch city summary",
    revalidateSeconds: cachePolicy.revalidateSeconds,
    url,
  });
}
