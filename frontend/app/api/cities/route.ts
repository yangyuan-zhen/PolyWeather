import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";
import { buildCachedJsonResponse } from "@/lib/http-cache";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!API_BASE) {
    const response = NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
    return response;
  }

  try {
    const auth = await buildBackendRequestHeaders(req, {
      includeSupabaseIdentity: false,
    });
    const res = await fetch(`${API_BASE}/api/cities`, {
      headers: auth.headers,
      cache: "no-store",
    });
    if (!res.ok) {
      const raw = await res.text();
      const response = NextResponse.json(
        { error: `Backend returned ${res.status}`, detail: raw.slice(0, 300) },
        { status: 502 },
      );
      return applyAuthResponseCookies(response, auth.response);
    }
    const data = await res.json();
    const response = buildCachedJsonResponse(
      req,
      data,
      "no-store, max-age=0",
    );
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    const response = NextResponse.json(
      { error: "Failed to fetch cities", detail: String(error) },
      { status: 500 },
    );
    return response;
  }
}
