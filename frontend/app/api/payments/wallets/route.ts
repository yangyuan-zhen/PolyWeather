import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

export async function GET(req: NextRequest) {
  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }
  try {
    const auth = await buildBackendRequestHeaders(req);
    const res = await fetch(`${API_BASE}/api/payments/wallets`, {
      headers: auth.headers,
      cache: "no-store",
    });
    if (!res.ok) {
      const raw = await res.text();
      const response = NextResponse.json(
        { error: `Backend returned ${res.status}`, detail: raw.slice(0, 350) },
        { status: res.status },
      );
      return applyAuthResponseCookies(response, auth.response);
    }
    const data = await res.json();
    const response = NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch wallets", detail: String(error) },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }
  let payload: Record<string, unknown> = {};
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  try {
    const auth = await buildBackendRequestHeaders(req);
    const proxiedHeaders = new Headers(auth.headers);
    proxiedHeaders.set("Content-Type", "application/json");
    const res = await fetch(`${API_BASE}/api/payments/wallets`, {
      method: "DELETE",
      headers: proxiedHeaders,
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const raw = await res.text();
    if (!res.ok) {
      const response = NextResponse.json(
        {
          error: `Backend returned ${res.status}`,
          detail: raw.slice(0, 350),
          proxy_debug: {
            incoming_has_authorization: Boolean(
              String(req.headers.get("authorization") || "").trim(),
            ),
            has_authorization: proxiedHeaders.has("authorization"),
            has_entitlement: proxiedHeaders.has("x-polyweather-entitlement"),
            has_forwarded_user_id: proxiedHeaders.has(
              "x-polyweather-auth-user-id",
            ),
            has_forwarded_email: proxiedHeaders.has("x-polyweather-auth-email"),
          },
        },
        { status: res.status },
      );
      return applyAuthResponseCookies(response, auth.response);
    }
    let data: unknown = { ok: true };
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = { ok: true, raw };
      }
    }
    const response = NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to unbind wallet", detail: String(error) },
      { status: 500 },
    );
  }
}

