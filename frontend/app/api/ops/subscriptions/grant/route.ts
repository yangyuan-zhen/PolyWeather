import { NextRequest, NextResponse } from "next/server";
import { applyAuthResponseCookies, buildBackendRequestHeaders, BACKEND_ENTITLEMENT_HEADER } from "@/lib/backend-auth";
import { buildProxyExceptionResponse } from "@/lib/api-proxy";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;
const ENTITLEMENT_TOKEN = process.env.POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN?.trim() || "";

export async function POST(req: NextRequest) {
  if (!API_BASE) return NextResponse.json({ error: "API_BASE not configured" }, { status: 500 });
  try {
    const auth = await buildBackendRequestHeaders(req);
    const body = await req.text();
    const headers: Record<string, string> = { ...auth.headers as Record<string, string>, "Content-Type": "application/json" };
    // Ops endpoints: pass entitlement token as Bearer for robust admin auth.
    if (ENTITLEMENT_TOKEN) {
      headers.Authorization = `Bearer ${ENTITLEMENT_TOKEN}`;
    }
    const res = await fetch(`${API_BASE}/api/ops/subscriptions/grant`, {
      method: "POST", headers, body, cache: "no-store",
    });
    const raw = await res.text();
    const response = new NextResponse(raw, { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    return applyAuthResponseCookies(response, auth.response);
  } catch (e) { return buildProxyExceptionResponse(e, { publicMessage: "Subscription grant failed" }); }
}
