import { NextRequest, NextResponse } from "next/server";
import { buildProxyExceptionResponse } from "@/lib/api-proxy";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
  buildJsonBackendRequestHeaders,
} from "@/lib/backend-auth";
import { requireOpsProxyAuth } from "@/lib/ops-proxy-auth";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ caseId: string }> },
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

    const resolved = await params;
    const body = await req.text();
    const res = await fetch(
      `${API_BASE}/api/ops/refunds/${encodeURIComponent(resolved.caseId)}`,
      {
        method: "PATCH",
        cache: "no-store",
        headers: buildJsonBackendRequestHeaders(auth.headers),
        body,
      },
    );
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
      publicMessage: "Failed to update refund case",
    });
  }
}
