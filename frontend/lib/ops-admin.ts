import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createSupabaseServerClient,
  hasSupabaseServerEnv,
  hasSupabaseSessionCookieValues,
} from "@/lib/supabase/server";

function parseAdminEmails() {
  return String(process.env.POLYWEATHER_OPS_ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export async function requireOpsAdmin(nextPath = "/ops") {
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
