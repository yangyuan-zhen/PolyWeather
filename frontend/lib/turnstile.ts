import { NextRequest, NextResponse } from "next/server";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const NO_STORE = "no-store, max-age=0";

type TurnstileVerification = {
  ok: boolean;
  skipped?: boolean;
  error?: string;
};

function turnstileSecretKey() {
  return String(process.env.POLYWEATHER_TURNSTILE_SECRET_KEY || "").trim();
}

function turnstileSiteKey() {
  return String(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "").trim();
}

export function isTurnstileServerEnabled() {
  if (process.env.POLYWEATHER_TURNSTILE_BYPASS === "true") return false;
  return Boolean(turnstileSecretKey() && turnstileSiteKey());
}

function enforceTurnstileAction() {
  return process.env.POLYWEATHER_TURNSTILE_ENFORCE_ACTION === "true";
}

export function stripTurnstileToken<T>(body: T): T {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const copy = { ...(body as Record<string, unknown>) };
  delete copy.turnstile_token;
  delete copy.turnstileToken;
  return copy as T;
}

function tokenFromBody(body: unknown) {
  if (!body || typeof body !== "object") return "";
  const record = body as Record<string, unknown>;
  return String(record.turnstile_token || record.turnstileToken || "").trim();
}

function remoteIpFromRequest(req: NextRequest) {
  const forwardedFor = req.headers.get("x-forwarded-for") || "";
  return (
    req.headers.get("cf-connecting-ip") ||
    forwardedFor.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    ""
  );
}

export async function verifyTurnstileToken(
  token: string,
  req: NextRequest,
  action: string,
): Promise<TurnstileVerification> {
  if (!isTurnstileServerEnabled()) {
    return { ok: true, skipped: true };
  }

  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    return { ok: false, error: "missing_turnstile_token" };
  }

  const body = new URLSearchParams();
  body.set("secret", turnstileSecretKey());
  body.set("response", normalizedToken);
  const remoteIp = remoteIpFromRequest(req);
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      cache: "no-store",
    });
    const data = (await response.json().catch(() => null)) as {
      success?: unknown;
      action?: unknown;
      "error-codes"?: unknown;
    } | null;
    if (!response.ok || data?.success !== true) {
      return { ok: false, error: "turnstile_siteverify_failed" };
    }
    const returnedAction = String(data.action || "").trim();
    if (enforceTurnstileAction() && returnedAction && returnedAction !== action) {
      return { ok: false, error: "turnstile_action_mismatch" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "turnstile_siteverify_unavailable" };
  }
}

export async function requireTurnstileForRequest(
  req: NextRequest,
  action: string,
  body?: unknown,
) {
  const token = tokenFromBody(body);
  const result = await verifyTurnstileToken(token, req, action);
  if (result.ok) return null;
  return NextResponse.json(
    {
      error: "Security verification failed. Please refresh the challenge and retry.",
      code: result.error || "turnstile_failed",
    },
    {
      status: 403,
      headers: {
        "Cache-Control": NO_STORE,
        "Cloudflare-CDN-Cache-Control": NO_STORE,
      },
    },
  );
}
