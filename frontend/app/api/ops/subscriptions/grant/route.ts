import { NextRequest, NextResponse } from "next/server";
import {
  applyAuthResponseCookies,
  buildBackendRequestHeaders,
  buildJsonBackendRequestHeaders,
} from "@/lib/backend-auth";
import { buildProxyExceptionResponse } from "@/lib/api-proxy";
import { requireOpsProxyAuth } from "@/lib/ops-proxy-auth";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;

function parseAdminEmails() {
  return String(process.env.POLYWEATHER_OPS_ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

async function getBearerEmail(req: NextRequest) {
  const auth = String(req.headers.get("authorization") || "").trim();
  const token = auth.replace(/^bearer\s+/i, "").trim();
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const anonKey = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!token || !supabaseUrl || !anonKey) return "";
  const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) return "";
  const data = (await res.json()) as { email?: string };
  return String(data.email || "").trim().toLowerCase();
}

async function findSupabaseUserIdByEmail(email: string) {
  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "")
    .trim()
    .replace(/\/$/, "");
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase service role is not configured on Vercel");
  }
  const profileRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?select=id&email=eq.${encodeURIComponent(email)}&limit=1`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );
  const profileData = (await profileRes.json().catch(() => [])) as Array<{ id?: string }>;
  if (profileRes.ok) {
    const profileUserId = String(profileData?.[0]?.id || "").trim();
    if (profileUserId) return { supabaseUrl, serviceRoleKey, userId: profileUserId };
  }

  const res = await fetch(
    `${supabaseUrl}/auth/v1/admin/users?filter=${encodeURIComponent(`email.eq.${email}`)}`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    users?: Array<{ id?: string }>;
  };
  if (!res.ok) throw new Error(`Supabase user lookup failed: ${JSON.stringify(data).slice(0, 200)}`);
  const userId = String(data.users?.[0]?.id || "").trim();
  if (!userId) {
    const error = new Error(`user not found: ${email}`);
    (error as Error & { status?: number }).status = 404;
    throw error;
  }
  return { supabaseUrl, serviceRoleKey, userId };
}

async function grantSubscriptionDirectly(req: NextRequest, bodyText: string, authEmail?: string | null) {
  const adminEmail = String(authEmail || (await getBearerEmail(req)) || "")
    .trim()
    .toLowerCase();
  const allowedEmails = parseAdminEmails();
  if (!adminEmail) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!allowedEmails.includes(adminEmail)) {
    return NextResponse.json({ error: "ops admin required" }, { status: 403 });
  }

  const body = JSON.parse(bodyText || "{}") as {
    email?: string;
    plan_code?: string;
    days?: number;
  };
  const email = String(body.email || "").trim().toLowerCase();
  const planCode = String(body.plan_code || "pro_monthly").trim();
  const days = Math.max(1, Math.min(365, Number(body.days || 30)));
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });
  if (planCode !== "pro_monthly") {
    return NextResponse.json({ error: "invalid plan_code" }, { status: 400 });
  }

  try {
    const { supabaseUrl, serviceRoleKey, userId } = await findSupabaseUserIdByEmail(email);
    const now = new Date();
    const expires = new Date(now.getTime() + days * 86_400_000);
    const payload = {
      user_id: userId,
      email,
      plan_code: planCode,
      "status": "active",
      starts_at: now.toISOString(),
      expires_at: expires.toISOString(),
      source: "ops_manual_grant_next_fallback",
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
    const insert = await fetch(`${supabaseUrl}/rest/v1/subscriptions`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    const raw = await insert.text();
    if (!insert.ok) {
      return NextResponse.json(
        { error: "Supabase insert failed", detail: raw.slice(0, 300) },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      user_id: userId,
      plan_code: planCode,
      days,
      expires_at: expires.toISOString(),
      fallback: "next_supabase_direct",
    });
  } catch (error) {
    const status = Number((error as Error & { status?: number }).status || 500);
    return NextResponse.json({ error: String(error) }, { status });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await buildBackendRequestHeaders(req);
    const authError = requireOpsProxyAuth(req, auth);
    if (authError) return authError;

    const body = await req.text();
    if (!API_BASE) {
      return grantSubscriptionDirectly(req, body, auth.authEmail);
    }

    const res = await fetch(`${API_BASE}/api/ops/subscriptions/grant`, {
      method: "POST",
      headers: buildJsonBackendRequestHeaders(auth.headers),
      body,
      cache: "no-store",
    });
    const raw = await res.text();
    if (res.status === 404) {
      const fallback = await grantSubscriptionDirectly(req, body, auth.authEmail);
      return applyAuthResponseCookies(fallback, auth.response);
    }
    const response = new NextResponse(raw, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
    return applyAuthResponseCookies(response, auth.response);
  } catch (e) {
    return buildProxyExceptionResponse(e, { publicMessage: "Subscription grant failed" });
  }
}
