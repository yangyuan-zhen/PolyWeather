import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";
import {
  buildProxyExceptionResponse,
  buildUpstreamErrorResponse,
} from "@/lib/api-proxy";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;
const SCAN_TERMINAL_PROXY_TIMEOUT_MS = Number(
  process.env.POLYWEATHER_SCAN_TERMINAL_PROXY_TIMEOUT_MS || "28000",
);

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

  let auth: Awaited<ReturnType<typeof buildBackendRequestHeaders>> | null = null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SCAN_TERMINAL_PROXY_TIMEOUT_MS);

  try {
    auth = await buildBackendRequestHeaders(req);
    const res = await fetch(url, {
      headers: auth.headers,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      const raw = await res.text();
      const response = buildUpstreamErrorResponse(res.status, raw);
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
    const timedOut = controller.signal.aborted;
    const response = buildProxyExceptionResponse(error, {
      publicMessage: timedOut
        ? "Scan terminal request timed out"
        : "Failed to fetch scan terminal data",
      status: timedOut ? 504 : 500,
    });
    return auth ? applyAuthResponseCookies(response, auth.response) : response;
  } finally {
    clearTimeout(timeoutId);
  }
}
