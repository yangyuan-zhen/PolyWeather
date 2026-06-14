import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { BACKEND_ENTITLEMENT_HEADER } from "@/lib/backend-auth";
import { isLocalOpsAccessHost } from "@/lib/ops-local-access";
import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
  hasSupabaseSessionCookieValues,
} from "@/lib/supabase/server";

const API_BASE = process.env.POLYWEATHER_API_BASE_URL;
const LOCAL_DEV_OPS_EMAIL = "local-dev@polyweather.local";

function parseAdminEmails() {
  return String(process.env.POLYWEATHER_OPS_ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

async function verifyOpsAdminWithBackend(accessToken: string) {
  const token = String(accessToken || "").trim();
  if (!API_BASE || !token) return false;

  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  });
  const backendToken = process.env.POLYWEATHER_BACKEND_ENTITLEMENT_TOKEN?.trim();
  if (backendToken) {
    headers.set(BACKEND_ENTITLEMENT_HEADER, backendToken);
  }

  try {
    const response = await fetch(`${API_BASE.replace(/\/+$/, "")}/api/ops/online-users`, {
      cache: "no-store",
      headers,
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function requireOpsAdmin(nextPath = "/ops") {
  const headerStore = await headers();
  const requestHost =
    headerStore.get("x-forwarded-host") || headerStore.get("host") || "";
  if (isLocalOpsAccessHost(requestHost)) {
    return { email: LOCAL_DEV_OPS_EMAIL };
  }

  const allowedEmails = parseAdminEmails();
  if (!hasSupabaseServerEnv()) {
    redirect("/");
  }

  const cookieStore = await cookies();
  const supabaseCookies = cookieStore.getAll().map((item) => ({
    name: item.name,
    value: item.value,
  }));
  if (!hasSupabaseSessionCookieValues(supabaseCookies)) {
    redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
  }

  const supabase = createSupabaseServerClient({
    getAll() {
      return supabaseCookies;
    },
    setAll() {
      // Server components cannot persist refreshed cookies. Route handlers keep
      // the session fresh; here we only need read access for page gating.
    },
  });

  const {
    data,
    error,
  } = await supabase.auth.getClaims();

  const email = error ? "" : String(data?.claims?.email || "").trim().toLowerCase();
  if (!email) {
    redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
  }

  if (allowedEmails.includes(email)) {
    return { email };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token || "";
  if (await verifyOpsAdminWithBackend(accessToken)) {
    return { email };
  }

  redirect("/");
}
