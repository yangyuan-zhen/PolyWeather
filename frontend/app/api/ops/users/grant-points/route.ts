import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
  buildJsonBackendRequestHeaders,
} from "@/lib/backend-auth";
import { buildProxyExceptionResponse } from "@/lib/api-proxy";
import { requireOpsProxyAuth } from "@/lib/ops-proxy-auth";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

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
    const res = await fetch(`${API_BASE}/api/ops/users/grant-points`, {
      method: "POST",
      headers: buildJsonBackendRequestHeaders(auth.headers),
      body,
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
    return buildProxyExceptionResponse(error, {
      publicMessage: "Failed to grant points",
    });
  }
}
