import { NextRequest, NextResponse } from "next/server";
import { proxyBackendJsonGet } from "@/lib/api-proxy";

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
  const url = `${API_BASE}/api/history/${encodeURIComponent(name)}`;

  return proxyBackendJsonGet(req, {
    cacheControl: "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    publicMessage: "Failed to fetch history",
    revalidateSeconds: 60,
    url,
  });
}
