import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";
import {
  buildProxyExceptionResponse,
  buildUpstreamErrorResponse,
} from "@/lib/api-proxy";

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
  try {
    const auth = await buildBackendRequestHeaders(req);
    const res = await fetch(
      `${API_BASE}/api/payments/intents/${encodeURIComponent(intentId)}`,
      {
        method: "GET",
        headers: auth.headers,
        cache: "no-store",
      },
    );
    if (!res.ok) {
      const raw = await res.text();
      const response = buildUpstreamErrorResponse(res.status, raw, {
        detailLimit: 350,
      });
      return applyAuthResponseCookies(response, auth.response);
    }
    const data = await res.json();
    const response = NextResponse.json(data);
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    return buildProxyExceptionResponse(error, {
      publicMessage: "Failed to fetch payment intent",
    });
  }
}
