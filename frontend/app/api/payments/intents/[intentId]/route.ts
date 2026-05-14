import { NextRequest, NextResponse } from "next/server";
import { proxyBackendJsonGet } from "@/lib/api-proxy";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ intentId: string }> },
) {
  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }
  const { intentId } = await context.params;
  return proxyBackendJsonGet(req, {
    detailLimit: 350,
    fetchCache: "no-store",
    includeSupabaseIdentity: true,
    publicMessage: "Failed to fetch payment intent",
    url: `${API_BASE}/api/payments/intents/${encodeURIComponent(intentId)}`,
  });
}
