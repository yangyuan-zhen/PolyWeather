import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

type RouteContext = {
  params: Promise<{ eventId: string }>;
};

export async function POST(req: NextRequest, context: RouteContext) {
  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }

  try {
    const auth = await buildBackendRequestHeaders(req);
    const { eventId } = await context.params;
    const res = await fetch(`${API_BASE}/api/ops/payments/incidents/${eventId}/resolve`, {
      method: "POST",
      headers: auth.headers,
      cache: "no-store",
    });
    const raw = await res.text();
    const response = new NextResponse(raw, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to resolve payment incident", detail: String(error) },
      { status: 500 },
    );
  }
}
