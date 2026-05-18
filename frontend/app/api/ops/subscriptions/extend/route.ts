import { NextRequest, NextResponse } from "next/server";
import { applyAuthResponseCookies, buildBackendRequestHeaders } from "@/lib/backend-auth";
import { buildProxyExceptionResponse } from "@/lib/api-proxy";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

export async function POST(req: NextRequest) {
  if (!API_BASE) return NextResponse.json({ error: "API_BASE not configured" }, { status: 500 });
  try {
    const auth = await buildBackendRequestHeaders(req);
    const body = await req.text();
    const res = await fetch(`${API_BASE}/api/ops/subscriptions/extend`, {
      method: "POST", headers: { ...auth.headers, "Content-Type": "application/json" }, body, cache: "no-store",
    });
    const raw = await res.text();
    const response = new NextResponse(raw, { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    return applyAuthResponseCookies(response, auth.response);
  } catch (e) { return buildProxyExceptionResponse(e, { publicMessage: "Subscription extend failed" }); }
}
