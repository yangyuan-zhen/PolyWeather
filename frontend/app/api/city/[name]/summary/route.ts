import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";
import { buildCachedJsonResponse } from "@/lib/http-cache";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ name: string }> },
) {
  if (!API_BASE) {
    const response = NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
    return response;
  }

  const { name } = await context.params;
  const forceRefresh = req.nextUrl.searchParams.get("force_refresh") ?? "false";
  const bypassCache = forceRefresh === "true";
  const url = `${API_BASE}/api/city/${encodeURIComponent(name)}/summary?force_refresh=${forceRefresh}`;

  try {
    const auth = await buildBackendRequestHeaders(req);
    const res = await fetch(url, {
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
    if (bypassCache) {
      const response = NextResponse.json(data, {
        headers: {
          "Cache-Control": "no-store",
        },
      });
      return applyAuthResponseCookies(response, auth.response);
    }
    const response = buildCachedJsonResponse(
      req,
      data,
      "public, max-age=0, s-maxage=20, stale-while-revalidate=60",
    );
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    const response = NextResponse.json(
      { error: "Failed to fetch city summary", detail: String(error) },
      { status: 500 },
    );
    return response;
  }
}
