import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
    const res = await fetch(`${API_BASE}/api/ai/metar-summary`, {
      method: "POST",
      headers,
      cache: "no-store",
      body: JSON.stringify(requestBody),
    });
    if (!res.ok || !res.body) {
      const raw = await res.text();
      const response = NextResponse.json(
        { error: `Backend returned ${res.status}`, detail: raw.slice(0, 300) },
        { status: res.status === 402 || res.status === 403 ? res.status : 502 },
      );
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
    const response = NextResponse.json(
      {
        error: "Failed to stream METAR summary",
        detail: String(error),
      },
      { status: 500 },
    );
    return applyAuthResponseCookies(response, auth.response);
  }
}
