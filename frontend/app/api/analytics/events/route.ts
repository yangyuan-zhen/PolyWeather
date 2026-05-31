import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";
import {
  buildProxyExceptionResponse,
  buildUpstreamErrorResponse,
} from "@/lib/api-proxy";
import {
  createProxyTimer,
  finishProxyTimedResponse,
} from "@/lib/proxy-timing";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;
const ANALYTICS_ENABLED =
  process.env.NEXT_PUBLIC_POLYWEATHER_APP_ANALYTICS !== "false";
const ANALYTICS_PROXY_TIMEOUT_MS = Math.max(
  250,
  Number(process.env.POLYWEATHER_ANALYTICS_PROXY_TIMEOUT_MS || "1500") || 1500,
);

export async function POST(req: NextRequest) {
  const timer = createProxyTimer(req, "analytics_events");
  if (!ANALYTICS_ENABLED) {
    return finishProxyTimedResponse(
      new NextResponse(null, { status: 204 }),
      timer,
      "disabled",
    );
  }

  if (!API_BASE) {
    return finishProxyTimedResponse(
      NextResponse.json(
        { error: "POLYWEATHER_API_BASE_URL is not configured" },
        { status: 500 },
      ),
      timer,
      "missing_api_base",
    );
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ANALYTICS_PROXY_TIMEOUT_MS);
  let auth: Awaited<ReturnType<typeof buildBackendRequestHeaders>> | null = null;

  try {
    const body = await timer.measure("request_read", () => req.json());
    const payload =
      body && typeof body.payload === "object" && body.payload != null
        ? body.payload
        : {};
    const enrichedBody = {
      ...(body ?? {}),
      payload: {
        ...payload,
        cf_country:
          req.headers.get("cf-ipcountry") ||
          req.headers.get("x-vercel-ip-country") ||
          "",
        user_agent: req.headers.get("user-agent") || "",
        referer_header: req.headers.get("referer") || "",
      },
    };
    auth = await timer.measure("auth_headers", () =>
      buildBackendRequestHeaders(req, {
        includeSupabaseIdentity: false,
      }),
    );
    const headers = new Headers(auth.headers);
    headers.set("Content-Type", "application/json");
    const res = await timer.measure("backend_fetch", () =>
      fetch(`${API_BASE}/api/analytics/events`, {
        method: "POST",
        headers,
        body: JSON.stringify(enrichedBody),
        cache: "no-store",
        signal: controller.signal,
      }),
    );
    const backendServerTiming = res.headers.get("server-timing") || "";
    if (!res.ok) {
      const raw = await timer.measure("backend_read", () => res.text());
      const response = buildUpstreamErrorResponse(res.status, raw, {
        detailLimit: 260,
      });
      return finishProxyTimedResponse(
        applyAuthResponseCookies(response, auth.response),
        timer,
        `upstream_${res.status}`,
        { backendServerTiming },
      );
    }
    const data = await timer.measure("backend_read", () => res.json());
    const response = NextResponse.json(data);
    return finishProxyTimedResponse(
      applyAuthResponseCookies(response, auth.response),
      timer,
      "ok",
      { backendServerTiming },
    );
  } catch (error) {
    const timedOut = controller.signal.aborted;
    const response = timedOut
      ? NextResponse.json(
          {
            ok: false,
            accepted: true,
            dropped: true,
            reason: "timeout",
          },
          { status: 202 },
        )
      : buildProxyExceptionResponse(error, {
          publicMessage: "Failed to track analytics event",
        });
    const withCookies = auth ? applyAuthResponseCookies(response, auth.response) : response;
    return finishProxyTimedResponse(
      withCookies,
      timer,
      timedOut ? "timeout_accepted" : "exception",
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
