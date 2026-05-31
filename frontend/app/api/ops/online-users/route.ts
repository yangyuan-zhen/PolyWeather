import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";
import { buildProxyExceptionResponse } from "@/lib/api-proxy";
import { requireOpsProxyAuth } from "@/lib/ops-proxy-auth";
import {
  createProxyTimer,
  finishProxyTimedResponse,
} from "@/lib/proxy-timing";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

export async function GET(req: NextRequest) {
  const timer = createProxyTimer(req, "ops_online_users");
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

  try {
    const auth = await timer.measure("auth_headers", () =>
      buildBackendRequestHeaders(req),
    );
    const authError = timer.measureSync("ops_auth", () =>
      requireOpsProxyAuth(req, auth),
    );
    if (authError) {
      return finishProxyTimedResponse(authError, timer, "ops_auth_error");
    }

    const res = await timer.measure("backend_fetch", () =>
      fetch(`${API_BASE}/api/ops/online-users`, {
        headers: auth.headers,
        cache: "no-store",
      }),
    );
    const backendServerTiming = res.headers.get("server-timing") || "";
    const raw = await timer.measure("backend_read", () => res.text());
    const response = new NextResponse(raw, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
    return finishProxyTimedResponse(
      applyAuthResponseCookies(response, auth.response),
      timer,
      res.ok ? "ok" : `upstream_${res.status}`,
      { backendServerTiming },
    );
  } catch (error) {
    return finishProxyTimedResponse(
      buildProxyExceptionResponse(error, {
        publicMessage: "Failed to fetch online users",
      }),
      timer,
      "exception",
    );
  }
}
