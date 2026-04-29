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
const SCAN_AI_PROXY_TIMEOUT_MS = Math.max(
  35_000,
  Number(process.env.POLYWEATHER_SCAN_AI_PROXY_TIMEOUT_MS || "45000") || 45_000,
);

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  let auth: Awaited<ReturnType<typeof buildBackendRequestHeaders>> | null = null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SCAN_AI_PROXY_TIMEOUT_MS);

  try {
    auth = await buildBackendRequestHeaders(req);
    const headers = new Headers(auth.headers);
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "application/json");
    const res = await fetch(`${API_BASE}/api/scan/terminal/ai`, {
      method: "POST",
      headers,
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify(body || {}),
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
        ? "Scan AI request timed out"
        : "Failed to fetch scan AI data",
      status: timedOut ? 504 : 500,
    });
    return auth ? applyAuthResponseCookies(response, auth.response) : response;
  } finally {
    clearTimeout(timeoutId);
  }
}
