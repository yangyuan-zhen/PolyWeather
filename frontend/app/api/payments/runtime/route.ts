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
    cacheControl: "no-store",
    conditionalResponse: false,
    detailLimit: 500,
    fetchCache: "no-store",
    includeSupabaseIdentity: true,
    publicMessage: "Failed to fetch payment runtime",
    url: `${API_BASE}/api/payments/runtime`,
  });
}
