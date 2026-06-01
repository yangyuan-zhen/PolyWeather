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
const BACKEND_RETRY_DELAY_MS = 250;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWalletChallengeWithRetry(
  url: string,
  init: RequestInit,
  attempts = 2,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      await sleep(BACKEND_RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

function logWalletChallengeProxyError(
  error: unknown,
  authDebug: Record<string, unknown>,
) {
  const source = error as { name?: unknown; message?: unknown; cause?: unknown };
  console.error("[payment-wallet-challenge-proxy-exception]", {
    error_name: String(source?.name || "Error"),
    error_message: String(source?.message || error || "unknown"),
    error_cause: source?.cause ? String(source.cause) : "",
    ...authDebug,
  });
}

export async function POST(req: NextRequest) {
  if (!API_BASE) {
    return NextResponse.json(
      { error: "POLYWEATHER_API_BASE_URL is not configured" },
      { status: 500 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid wallet challenge request" },
      { status: 400 },
    );
  }
  let authDebug: Record<string, unknown> = {};
  try {
    const auth = await buildBackendRequestHeaders(req);
    const authError = requireBackendPaymentAuth(auth);
    if (authError) return authError;
    const proxiedHeaders = new Headers(auth.headers);
    proxiedHeaders.set("Content-Type", "application/json");
    authDebug = {
      incoming_has_authorization: Boolean(
        String(req.headers.get("authorization") || "").trim(),
      ),
      has_authorization: proxiedHeaders.has("authorization"),
      has_entitlement: proxiedHeaders.has("x-polyweather-entitlement"),
      has_forwarded_user_id: proxiedHeaders.has("x-polyweather-auth-user-id"),
      has_forwarded_email: proxiedHeaders.has("x-polyweather-auth-email"),
    };
    const res = await fetchWalletChallengeWithRetry(
      `${API_BASE}/api/payments/wallets/challenge`,
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
        extraDebug: authDebug,
      });
      return applyAuthResponseCookies(response, auth.response);
    }
    const data = await res.json();
    const response = NextResponse.json(data);
    return applyAuthResponseCookies(response, auth.response);
  } catch (error) {
    logWalletChallengeProxyError(error, authDebug);
    return buildProxyExceptionResponse(error, {
      status: 502,
      publicMessage:
        "Wallet challenge service is temporarily unavailable. Please retry.",
      extra: { retryable: true },
    });
  }
}
