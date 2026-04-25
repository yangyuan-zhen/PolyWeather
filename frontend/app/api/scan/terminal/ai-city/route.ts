import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;
const SCAN_AI_PROXY_TIMEOUT_MS = Math.max(
  35_000,
  Number(process.env.POLYWEATHER_SCAN_AI_PROXY_TIMEOUT_MS || "55000") || 55_000,
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
    const requestBody = body && typeof body === "object" ? body as Record<string, unknown> : {};
    console.info("[scan-ai-city] proxy request", {
      city: requestBody.city,
      force_refresh: requestBody.force_refresh === true,
      locale: requestBody.locale,
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
      const response = NextResponse.json(
        { error: `Backend returned ${res.status}`, detail: raw.slice(0, 300) },
        { status: res.status === 402 || res.status === 403 ? res.status : 502 },
      );
      return applyAuthResponseCookies(response, auth.response);
    }
    const data = await res.json();
    console.info("[scan-ai-city] proxy complete", {
      status: data?.status,
      city: data?.city,
      model: data?.model,
      cached: data?.cached === true,
    });
    const response = NextResponse.json(data, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    const timedOut = controller.signal.aborted;
    const response = NextResponse.json(
      {
        error: timedOut
          ? "City AI request timed out"
          : "Failed to fetch city AI data",
        detail: String(error),
      },
      { status: timedOut ? 504 : 500 },
    );
    return auth ? applyAuthResponseCookies(response, auth.response) : response;
  } finally {
    clearTimeout(timeoutId);
  }
}
