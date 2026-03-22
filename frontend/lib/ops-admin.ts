import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient, hasSupabaseServerEnv } from "@/lib/supabase/server";

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
  const supabase = createSupabaseServerClient({
    getAll() {
      return cookieStore.getAll().map((item) => ({
        name: item.name,
        value: item.value,
      }));
    },
    setAll() {
      // Server components cannot persist refreshed cookies. Route handlers keep
      // the session fresh; here we only need read access for page gating.
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const email = String(user?.email || "").trim().toLowerCase();
  if (!email) {
    redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
  }
  if (!allowedEmails.includes(email)) {
    redirect("/");
  }

  return { email };
}
