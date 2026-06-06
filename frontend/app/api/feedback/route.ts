import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
  requireBackendPaymentAuth,
} from "@/lib/backend-auth";
import {
  buildProxyExceptionResponse,
  buildUpstreamErrorResponse,
} from "@/lib/api-proxy";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

export async function GET(req: NextRequest) {
  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }

  let auth: Awaited<ReturnType<typeof buildBackendRequestHeaders>> | null = null;
  try {
    auth = await buildBackendRequestHeaders(req);
    const authError = requireBackendPaymentAuth(auth);
    if (authError) return authError;

    const upstream = new URL(`${API_BASE}/api/feedback`);
    const limit = req.nextUrl.searchParams.get("limit");
    if (limit) upstream.searchParams.set("limit", limit);

    const res = await fetch(upstream, {
      method: "GET",
      headers: auth.headers,
      cache: "no-store",
    });
    const raw = await res.text();
    if (!res.ok) {
      return applyAuthResponseCookies(
        buildUpstreamErrorResponse(res.status, raw, {
          detailLimit: 260,
          error: "Feedback status request failed",
        }),
        auth.response,
      );
    }
    const response = new NextResponse(raw, {
      status: res.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": res.headers.get("content-type") || "application/json",
      },
    });
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    const response = buildProxyExceptionResponse(error, {
      publicMessage: "Failed to fetch feedback status",
    });
    return auth ? applyAuthResponseCookies(response, auth.response) : response;
  }
}

export async function POST(req: NextRequest) {
  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }

  let auth: Awaited<ReturnType<typeof buildBackendRequestHeaders>> | null = null;
  try {
    const body = await req.json();
    auth = await buildBackendRequestHeaders(req);
    const headers = new Headers(auth.headers);
    headers.set("Content-Type", "application/json");

    const res = await fetch(`${API_BASE}/api/feedback`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const raw = await res.text();
    if (!res.ok) {
      return applyAuthResponseCookies(
        buildUpstreamErrorResponse(res.status, raw, {
          detailLimit: 260,
          error: "Feedback request failed",
        }),
        auth.response,
      );
    }
    const response = new NextResponse(raw, {
      status: res.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": res.headers.get("content-type") || "application/json",
      },
    });
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    const response = buildProxyExceptionResponse(error, {
      publicMessage: "Failed to submit feedback",
    });
    return auth ? applyAuthResponseCookies(response, auth.response) : response;
  }
}
