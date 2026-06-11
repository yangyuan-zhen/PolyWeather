import { NextRequest, NextResponse } from "next/server";
import { applyAuthResponseCookies, buildBackendRequestHeaders, buildJsonBackendRequestHeaders } from "@/lib/backend-auth";
import { buildProxyExceptionResponse } from "@/lib/api-proxy";
import { requireOpsProxyAuth } from "@/lib/ops-proxy-auth";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;
const BACKEND = API_BASE ? `${API_BASE}/api/ops/sensitive-config` : "";

export async function GET(req: NextRequest) {
  if (!API_BASE) return NextResponse.json({ error: "API_BASE not configured" }, { status: 500 });
  try {
    const auth = await buildBackendRequestHeaders(req);
    const authError = requireOpsProxyAuth(req, auth);
    if (authError) return authError;

    const res = await fetch(BACKEND, { headers: auth.headers, cache: "no-store" });
    const raw = await res.text();
    const response = new NextResponse(raw, { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    return applyAuthResponseCookies(response, auth.response);
  } catch (e) { return buildProxyExceptionResponse(e, { publicMessage: "Sensitive config fetch failed" }); }
}

export async function PUT(req: NextRequest) {
  if (!API_BASE) return NextResponse.json({ error: "API_BASE not configured" }, { status: 500 });
  try {
    const auth = await buildBackendRequestHeaders(req);
    const authError = requireOpsProxyAuth(req, auth);
    if (authError) return authError;

    const body = await req.text();
    const res = await fetch(BACKEND, { method: "PUT", headers: buildJsonBackendRequestHeaders(auth.headers), body, cache: "no-store" });
    const raw = await res.text();
    const response = new NextResponse(raw, { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    return applyAuthResponseCookies(response, auth.response);
  } catch (e) { return buildProxyExceptionResponse(e, { publicMessage: "Sensitive config update failed" }); }
}
