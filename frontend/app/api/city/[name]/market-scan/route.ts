import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

function parseBackendError(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw.slice(0, 800);
  }
}

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
  const params = new URLSearchParams();
  const forceRefresh = req.nextUrl.searchParams.get("force_refresh") ?? "false";
  params.set("force_refresh", forceRefresh);

  const targetDate = req.nextUrl.searchParams.get("target_date");
  if (targetDate) {
    params.set("target_date", targetDate);
  }

  const marketSlug = req.nextUrl.searchParams.get("market_slug");
  if (marketSlug) {
    params.set("market_slug", marketSlug);
  }

  const lite = req.nextUrl.searchParams.get("lite");
  if (lite) {
    params.set("lite", lite);
  }

  const url = `${API_BASE}/api/city/${encodeURIComponent(name)}/market-scan?${params.toString()}`;

  try {
    const auth = await buildBackendRequestHeaders(req);
    const res = await fetch(url, {
      headers: auth.headers,
      cache: "no-store",
    });
    if (!res.ok) {
      const raw = await res.text();
      const response = NextResponse.json(
        {
          error: "Backend city market scan failed",
          upstream_status: res.status,
          detail: parseBackendError(raw),
        },
        { status: 502 },
      );
      return applyAuthResponseCookies(response, auth.response);
    }
    const data = await res.json();
    const response = NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    const response = NextResponse.json(
      {
        error: "Failed to fetch city market scan",
        detail: String(error),
      },
      { status: 502 },
    );
    return response;
  }
}
