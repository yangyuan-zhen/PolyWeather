import { NextRequest, NextResponse } from "next/server";
import { proxyBackendJsonGet } from "@/lib/api-proxy";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

export async function GET(req: NextRequest) {
  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }

  return proxyBackendJsonGet(req, {
    cacheControl: "public, max-age=0, s-maxage=30, stale-while-revalidate=120",
    detailLimit: 500,
    publicMessage: "Failed to fetch system status",
    revalidateSeconds: 30,
    url: `${API_BASE}/api/system/status`,
  });
}
