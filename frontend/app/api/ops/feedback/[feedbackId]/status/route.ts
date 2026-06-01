import { NextRequest, NextResponse } from "next/server";
import { buildProxyExceptionResponse } from "@/lib/api-proxy";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";
import { requireOpsProxyAuth } from "@/lib/ops-proxy-auth";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ feedbackId: string }> },
) {
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

    const { feedbackId } = await context.params;
    const body = await req.json();
    const res = await fetch(
      `${API_BASE}/api/ops/feedback/${encodeURIComponent(feedbackId)}/status`,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          ...Object.fromEntries(new Headers(auth.headers).entries()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    const raw = await res.text();
    const response = new NextResponse(raw, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": res.headers.get("content-type") || "application/json",
      },
      status: res.status,
    });
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    return buildProxyExceptionResponse(error, {
      publicMessage: "Failed to update feedback status",
    });
  }
}
