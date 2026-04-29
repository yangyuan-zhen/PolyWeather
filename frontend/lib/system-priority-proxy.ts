import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
} from "@/lib/backend-auth";
import { buildProxyExceptionResponse } from "@/lib/api-proxy";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

function getClientTimezone(req: NextRequest) {
  return String(
    req.nextUrl.searchParams.get("timezone") ||
      req.nextUrl.searchParams.get("tz") ||
      "",
  ).trim();
}

export async function forwardPriorityWarmHint(req: NextRequest) {
  if (!API_BASE) {
    return NextResponse.json(
      {
        ok: false,
        skipped: true,
        reason: "POLYWEATHER_API_BASE_URL is not configured",
      },
      { status: 202 },
    );
  }

  const params = new URLSearchParams();
  const timezone = getClientTimezone(req);
  if (timezone) {
    params.set("timezone", timezone);
  }

  try {
    const auth = await buildBackendRequestHeaders(req);
    const res = await fetch(
      `${API_BASE}/api/system/priority-warm${
        params.size ? `?${params.toString()}` : ""
      }`,
      {
        method: "POST",
        headers: auth.headers,
        cache: "no-store",
      },
    );

    if (!res.ok) {
      const raw = await res.text();
      const response = buildProxyExceptionResponse(raw, {
        status: 202,
        publicMessage: "Priority warm hint was skipped",
        extra: {
          ok: false,
          skipped: true,
          upstream_status: res.status,
        },
      });
      return applyAuthResponseCookies(response, auth.response);
    }

    const data = await res.json();
    const response = NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    return buildProxyExceptionResponse(error, {
      status: 202,
      publicMessage: "Failed to send priority warm hint",
      extra: {
        ok: false,
        skipped: true,
      },
    });
  }
}
