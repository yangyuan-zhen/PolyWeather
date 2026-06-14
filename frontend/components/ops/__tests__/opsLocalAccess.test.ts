import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const opsAdminSource = fs.readFileSync(
    path.join(projectRoot, "lib", "ops-admin.ts"),
    "utf8",
  );
  const middlewareSource = fs.readFileSync(
    path.join(projectRoot, "middleware.ts"),
    "utf8",
  );
  const opsProxyAuthSource = fs.readFileSync(
    path.join(projectRoot, "lib", "ops-proxy-auth.ts"),
    "utf8",
  );
  const opsLocalAccessSource = fs.readFileSync(
    path.join(projectRoot, "lib", "ops-local-access.ts"),
    "utf8",
  );

  assert(
    middlewareSource.includes("isLocalOpsAccessHost") &&
      middlewareSource.includes('pathname.startsWith("/ops")') &&
      middlewareSource.includes('pathname.startsWith("/api/ops")') &&
      middlewareSource.includes('pathname === "/api/system/status"') &&
      middlewareSource.indexOf("isLocalOpsAccessHost") <
        middlewareSource.indexOf("handleTerminalGate"),
    "middleware must honor localhost ops access before redirecting /ops to login",
  );

  assert(
    opsAdminSource.includes("headers") &&
      opsAdminSource.includes("isLocalOpsAccessHost") &&
      opsAdminSource.includes("local-dev@polyweather.local") &&
      opsAdminSource.indexOf("isLocalOpsAccessHost") <
        opsAdminSource.indexOf("parseAdminEmails"),
    "ops server page gate must honor localhost ops access before Supabase/admin-email redirects",
  );

  assert(
    opsAdminSource.includes("verifyOpsAdminWithBackend") &&
      opsAdminSource.includes("POLYWEATHER_API_BASE_URL") &&
      opsAdminSource.includes("/api/ops/online-users") &&
      opsAdminSource.includes("Authorization") &&
      opsAdminSource.includes("BACKEND_ENTITLEMENT_HEADER") &&
      opsAdminSource.includes("await supabase.auth.getSession()") &&
      opsAdminSource.includes("if (allowedEmails.includes(email))") &&
      opsAdminSource.includes("if (await verifyOpsAdminWithBackend(accessToken))") &&
      !opsAdminSource.includes("if (!allowedEmails.length || !hasSupabaseServerEnv())"),
    "ops admin page gate must fall back to the backend ops admin check when the frontend admin email env is missing or stale",
  );

  assert(
    opsProxyAuthSource.includes("isLocalOpsAccessHost") &&
      opsProxyAuthSource.includes("x-forwarded-host") &&
      opsProxyAuthSource.includes("request.nextUrl.hostname") &&
      opsProxyAuthSource.indexOf("isLocalOpsAccessHost") <
        opsProxyAuthSource.indexOf("auth.authUserId"),
    "ops API proxy auth must allow localhost ops access before requiring a Supabase session",
  );

  assert(
    opsLocalAccessSource.includes("POLYWEATHER_LOCAL_OPS_FULL_ACCESS") &&
      opsLocalAccessSource.includes('process.env.NODE_ENV !== "production"') &&
      opsLocalAccessSource.includes("isLocalHostname") &&
      !opsLocalAccessSource.includes("NEXT_PUBLIC_POLYWEATHER_LOCAL_FULL_ACCESS"),
    "ops local access must be a server-side dev-only switch independent from the public product full-access flag",
  );
}
