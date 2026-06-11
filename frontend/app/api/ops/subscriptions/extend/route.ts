import { NextRequest, NextResponse } from "next/server";
import { applyAuthResponseCookies, buildBackendRequestHeaders, buildJsonBackendRequestHeaders } from "@/lib/backend-auth";
import { buildProxyExceptionResponse } from "@/lib/api-proxy";
import { requireOpsProxyAuth } from "@/lib/ops-proxy-auth";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;
const ENTITLEMENT_TOKEN = process.env.POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN?.trim() || "";

export async function POST(req: NextRequest) {
  if (!API_BASE) return NextResponse.json({ error: "API_BASE not configured" }, { status: 500 });
  try {
    const auth = await buildBackendRequestHeaders(req);
    const authError = requireOpsProxyAuth(req, auth);
    if (authError) return authError;

    const body = await req.text();
    const headers = buildJsonBackendRequestHeaders(auth.headers);
    if (ENTITLEMENT_TOKEN) {
      headers.set("Authorization", `Bearer ${ENTITLEMENT_TOKEN}`);
    }
    const res = await fetch(`${API_BASE}/api/ops/subscriptions/extend`, {
      method: "POST", headers, body, cache: "no-store",
    });
    const raw = await res.text();
    const response = new NextResponse(raw, { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    return applyAuthResponseCookies(response, auth.response);
  } catch (e) { return buildProxyExceptionResponse(e, { publicMessage: "Subscription extend failed" }); }
}
