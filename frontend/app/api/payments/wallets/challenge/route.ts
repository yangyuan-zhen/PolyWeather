import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
  requireBackendPaymentAuth,
} from "@/lib/backend-auth";
import {
  buildProxyExceptionResponse,
  buildUpstreamErrorResponse,
} from "@/lib/api-proxy";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

export async function POST(req: NextRequest) {
  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }
  try {
    const body = await req.json();
    const auth = await buildBackendRequestHeaders(req);
    const authError = requireBackendPaymentAuth(auth);
    if (authError) return authError;
    const proxiedHeaders = new Headers(auth.headers);
    proxiedHeaders.set("Content-Type", "application/json");
    const res = await fetch(`${API_BASE}/api/payments/wallets/challenge`, {
      method: "POST",
      headers: proxiedHeaders,
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
    });
    if (!res.ok) {
      const raw = await res.text();
      const response = buildUpstreamErrorResponse(res.status, raw, {
        detailLimit: 350,
        extraDebug: {
            has_authorization: proxiedHeaders.has("authorization"),
            has_entitlement: proxiedHeaders.has("x-polyweather-entitlement"),
            has_forwarded_user_id: proxiedHeaders.has(
              "x-polyweather-auth-user-id",
            ),
            has_forwarded_email: proxiedHeaders.has("x-polyweather-auth-email"),
        },
      });
      return applyAuthResponseCookies(response, auth.response);
    }
    const data = await res.json();
    const response = NextResponse.json(data);
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    return buildProxyExceptionResponse(error, {
      publicMessage: "Failed to create wallet challenge",
    });
  }
}
