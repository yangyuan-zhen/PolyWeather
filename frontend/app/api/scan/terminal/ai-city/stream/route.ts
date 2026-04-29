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

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const requestBody =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const auth = await buildBackendRequestHeaders(req);
  const headers = new Headers(auth.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "text/event-stream");

  try {
    const res = await fetch(`${API_BASE}/api/scan/terminal/ai-city/stream`, {
      method: "POST",
      headers,
      cache: "no-store",
      body: JSON.stringify(requestBody),
    });
    if (!res.ok || !res.body) {
      const raw = await res.text();
      const response = buildUpstreamErrorResponse(res.status, raw);
      return applyAuthResponseCookies(response, auth.response);
    }

    const response = new NextResponse(res.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    const response = buildProxyExceptionResponse(error, {
      publicMessage: "Failed to stream city AI data",
      extra: { city: requestBody.city },
    });
    return applyAuthResponseCookies(response, auth.response);
  }
}
