import { NextRequest, NextResponse } from "next/server";
import { buildProxyExceptionResponse } from "@/lib/api-proxy";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
  buildJsonBackendRequestHeaders,
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

    const upstream = new URL(`${API_BASE}/api/ops/refunds`);
    req.nextUrl.searchParams.forEach((value, key) => {
      upstream.searchParams.set(key, value);
    });

    const res = await fetch(upstream.toString(), {
      cache: "no-store",
      headers: auth.headers,
    });
    const raw = await res.text();
    const response = new NextResponse(raw, {
      status: res.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": res.headers.get("content-type") || "application/json",
      },
    });
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    return buildProxyExceptionResponse(error, {
      publicMessage: "Failed to fetch refund cases",
    });
  }
}

export async function POST(req: NextRequest) {
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

    const body = await req.text();
    const res = await fetch(`${API_BASE}/api/ops/refunds`, {
      method: "POST",
      cache: "no-store",
      headers: buildJsonBackendRequestHeaders(auth.headers),
      body,
    });
    const raw = await res.text();
    const response = new NextResponse(raw, {
      status: res.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": res.headers.get("content-type") || "application/json",
      },
    });
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    return buildProxyExceptionResponse(error, {
      publicMessage: "Failed to create refund case",
    });
  }
}
