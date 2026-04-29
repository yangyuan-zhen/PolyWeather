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
const AI_CITY_GATEWAY_TIMEOUT_MS = Math.max(
  10_000,
  Number(
    process.env.POLYWEATHER_SCAN_AI_GATEWAY_TIMEOUT_MS ||
      process.env.POLYWEATHER_AI_CITY_GATEWAY_TIMEOUT_MS ||
      process.env.POLYWEATHER_SCAN_AI_PROXY_TIMEOUT_MS ||
      "55000",
  ) || 55_000,
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
  const startedAt = Date.now();
  const timeoutId = setTimeout(() => controller.abort(), AI_CITY_GATEWAY_TIMEOUT_MS);
  const requestBody = body && typeof body === "object" ? body as Record<string, unknown> : {};

  try {
    auth = await buildBackendRequestHeaders(req);
    const headers = new Headers(auth.headers);
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "application/json");
    console.info("[scan-ai-city] gateway request", {
      city: requestBody.city,
      force_refresh: requestBody.force_refresh === true,
      locale: requestBody.locale,
      timeout_ms: AI_CITY_GATEWAY_TIMEOUT_MS,
    });
    const res = await fetch(`${API_BASE}/api/scan/terminal/ai-city`, {
      method: "POST",
      headers,
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) {
      const raw = await res.text();
      console.warn("[scan-ai-city] backend returned non-ok", {
        status: res.status,
        detail: raw.slice(0, 180),
      });
      const response = buildUpstreamErrorResponse(res.status, raw);
      return applyAuthResponseCookies(response, auth.response);
    }
    const data = await res.json();
    console.info("[scan-ai-city] gateway complete", {
      status: data?.status,
      city: data?.city,
      model: data?.model,
      cached: data?.cached === true,
      elapsed_ms: Date.now() - startedAt,
    });
    const response = NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    const timedOut = controller.signal.aborted;
    const elapsedMs = Date.now() - startedAt;
    console.warn("[scan-ai-city] gateway failed", {
      city: requestBody.city,
      timed_out: timedOut,
      elapsed_ms: elapsedMs,
      timeout_ms: AI_CITY_GATEWAY_TIMEOUT_MS,
      error: String(error),
    });
    const response = buildProxyExceptionResponse(error, {
      publicMessage: timedOut
        ? "City AI gateway timed out before backend responded"
        : "Failed to fetch city AI data",
      status: timedOut ? 504 : 500,
      extra: {
        elapsed_ms: elapsedMs,
        timeout_ms: AI_CITY_GATEWAY_TIMEOUT_MS,
        city: requestBody.city,
      },
    });
    return auth ? applyAuthResponseCookies(response, auth.response) : response;
  } finally {
    clearTimeout(timeoutId);
  }
}
