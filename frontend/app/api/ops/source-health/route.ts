import { NextRequest, NextResponse } from "next/server";
import { buildProxyExceptionResponse } from "@/lib/api-proxy";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";
import { requireOpsProxyAuth } from "@/lib/ops-proxy-auth";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

export async function GET(req: NextRequest) {
  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }

  try {
    const auth = await buildBackendRequestHeaders(req);
    const authError = requireOpsProxyAuth(req, auth);
    if (authError) return authError;

    const upstream = new URL(`${API_BASE}/api/ops/source-health`);
    req.nextUrl.searchParams.forEach((value, key) => {
      upstream.searchParams.set(key, value);
    });

    const res = await fetch(upstream.toString(), {
      cache: "no-store",
      headers: auth.headers,
    });
    const raw = await res.text();
    const response = new NextResponse(raw, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      },
      status: res.status,
    });
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    return buildProxyExceptionResponse(error, {
      publicMessage: "Source health check failed",
    });
  }
}
