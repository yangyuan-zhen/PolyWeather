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

  const params = new URLSearchParams();
  for (const key of [
    "scan_mode",
    "min_price",
    "max_price",
    "min_edge_pct",
    "min_liquidity",
    "high_liquidity_only",
    "market_type",
    "time_range",
    "limit",
    "force_refresh",
  ]) {
    const value = req.nextUrl.searchParams.get(key);
    if (value != null && value !== "") {
      params.set(key, value);
    }
  }

  const url = `${API_BASE}/api/scan/terminal?${params.toString()}`;

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
    const response = NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to fetch scan terminal data", detail: String(error) },
      { status: 500 },
    );
  }
}
