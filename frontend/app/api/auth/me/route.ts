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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: auth.headers,
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    if (res.status === 401 || res.status === 403) {
      const response = NextResponse.json({
        authenticated: false,
        subscription_active: false,
        points: 0,
      });
      return applyAuthResponseCookies(response, auth.response);
    }
    if (!res.ok) {
      const raw = await res.text();
      if (auth.authUserId) {
        const response = NextResponse.json({
          authenticated: true,
          user_id: auth.authUserId,
          email: auth.authEmail || null,
          subscription_active: null,
          subscription_plan_code: null,
          subscription_expires_at: null,
          subscription_total_expires_at: null,
          subscription_queued_days: 0,
          subscription_queued_count: 0,
          points: 0,
          degraded_auth_profile: true,
          degraded_reason: `backend_${res.status}`,
        });
        return applyAuthResponseCookies(response, auth.response);
      }
      const response = NextResponse.json(
        { error: `Backend returned ${res.status}`, detail: raw.slice(0, 300) },
        { status: res.status },
      );
      return applyAuthResponseCookies(response, auth.response);
    }
    const data = await res.json();
    const response = NextResponse.json(data);
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    const auth = await buildBackendRequestHeaders(req);
    if (auth.authUserId) {
      const response = NextResponse.json({
        authenticated: true,
        user_id: auth.authUserId,
        email: auth.authEmail || null,
        subscription_active: null,
        subscription_plan_code: null,
        subscription_expires_at: null,
        subscription_total_expires_at: null,
        subscription_queued_days: 0,
        subscription_queued_count: 0,
        points: 0,
        degraded_auth_profile: true,
        degraded_reason: String(error),
      });
      return applyAuthResponseCookies(response, auth.response);
    }
    return NextResponse.json(
      { error: "Failed to fetch auth profile", detail: String(error) },
      { status: 500 },
    );
  }
}

