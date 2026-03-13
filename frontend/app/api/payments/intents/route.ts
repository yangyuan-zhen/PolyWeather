import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";

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
    const proxiedHeaders = new Headers(auth.headers);
    proxiedHeaders.set("Content-Type", "application/json");
    const res = await fetch(`${API_BASE}/api/payments/intents`, {
      method: "POST",
      headers: proxiedHeaders,
      body: JSON.stringify(body ?? {}),
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
    const response = NextResponse.json(data);
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to create payment intent", detail: String(error) },
      { status: 500 },
    );
  }
}

