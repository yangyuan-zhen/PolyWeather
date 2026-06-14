import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { isLocalOpsAccessHost } from "@/lib/ops-local-access";
import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
  hasSupabaseSessionCookieValues,
} from "@/lib/supabase/server";

const LOCAL_DEV_OPS_EMAIL = "local-dev@polyweather.local";

function parseAdminEmails() {
  return String(process.env.POLYWEATHER_OPS_ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export async function requireOpsAdmin(nextPath = "/ops") {
  const headerStore = await headers();
  const requestHost =
    headerStore.get("x-forwarded-host") || headerStore.get("host") || "";
  if (isLocalOpsAccessHost(requestHost)) {
    return { email: LOCAL_DEV_OPS_EMAIL };
  }

  const allowedEmails = parseAdminEmails();
  if (!allowedEmails.length || !hasSupabaseServerEnv()) {
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
  if (!allowedEmails.includes(email)) {
    redirect("/");
  }

  return { email };
}
