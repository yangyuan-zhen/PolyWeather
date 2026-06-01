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
