import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
  requireBackendPaymentAuth,
} from "@/lib/backend-auth";
import {
  buildProxyExceptionResponse,
  buildUpstreamErrorResponse,
} from "@/lib/api-proxy";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

function looksLikeHtmlDocument(value: string) {
  const text = String(value || "").trim().toLowerCase();
  return (
    text.startsWith("<!doctype html") ||
    text.startsWith("<html") ||
    /<title>[^<]*(50\d|cloudflare|polyweather\.top)/i.test(String(value || ""))
  );
}

function submitErrorMessage(raw: string) {
  try {
    const parsed = JSON.parse(String(raw || "")) as {
      detail?: unknown;
      error?: unknown;
      message?: unknown;
    };
    const message = [parsed.detail, parsed.error, parsed.message].find(
      (item) => typeof item === "string" && item.trim(),
    );
    if (typeof message === "string") {
      const trimmed = message.trim();
      if (!looksLikeHtmlDocument(trimmed)) return trimmed.slice(0, 350);
    }
  } catch {
    // Non-JSON upstream errors are commonly HTML 50x pages; do not expose them.
  }
  return "Payment submit upstream failed";
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ intentId: string }> },
) {
  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }
  const { intentId } = await context.params;
  try {
    const body = await req.json();
    const auth = await buildBackendRequestHeaders(req);
    const authError = requireBackendPaymentAuth(auth);
    if (authError) return authError;
    const proxiedHeaders = new Headers(auth.headers);
    proxiedHeaders.set("Content-Type", "application/json");
    const res = await fetch(
      `${API_BASE}/api/payments/intents/${encodeURIComponent(intentId)}/submit`,
      {
        method: "POST",
        headers: proxiedHeaders,
        body: JSON.stringify(body ?? {}),
        cache: "no-store",
      },
    );
    if (!res.ok) {
      const raw = await res.text();
      const response = buildUpstreamErrorResponse(res.status, raw, {
        detailLimit: 350,
        error: submitErrorMessage(raw),
      });
      return applyAuthResponseCookies(response, auth.response);
    }
    const data = await res.json();
    const response = NextResponse.json(data);
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    return buildProxyExceptionResponse(error, {
      publicMessage: "Failed to submit payment tx",
    });
  }
}
