import { NextRequest, NextResponse } from "next/server";
import { proxyBackendJsonGet } from "@/lib/api-proxy";
import { NO_STORE_CACHE_CONTROL } from "@/lib/proxy-cache-policy";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ name: string }> },
) {
  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      {
        headers: {
          "Cache-Control": NO_STORE_CACHE_CONTROL,
          "Cloudflare-CDN-Cache-Control": NO_STORE_CACHE_CONTROL,
        },
        status: 500,
      },
    );
  }

  const { name } = await context.params;
  return proxyBackendJsonGet(req, {
    cacheControl: NO_STORE_CACHE_CONTROL,
    fetchCache: "no-store",
    includeSupabaseIdentity: false,
    publicMessage: "Failed to fetch live city observation",
    url: `${API_BASE}/api/city/${encodeURIComponent(name)}/observation`,
  });
}
