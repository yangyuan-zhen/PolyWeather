import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function collectRouteFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectRouteFiles(fullPath);
    return entry.name === "route.ts" ? [fullPath] : [];
  });
}

export function runTests() {
  const projectRoot = process.cwd();
  const apiRoot = path.join(projectRoot, "app", "api");
  const unsafeRoutes = collectRouteFiles(apiRoot)
    .filter((routePath) =>
      /\.\.\.\s*(?:\(\s*)?auth\.headers/.test(fs.readFileSync(routePath, "utf8")),
    )
    .map((routePath) => path.relative(projectRoot, routePath));

  assert(
    unsafeRoutes.length === 0,
    `backend auth Headers must not be object-spread because that drops authorization headers: ${unsafeRoutes.join(", ")}`,
  );

  const helperSource = fs.readFileSync(
    path.join(projectRoot, "lib", "backend-auth.ts"),
    "utf8",
  );
  assert(
    helperSource.includes("buildJsonBackendRequestHeaders") &&
      helperSource.includes("new Headers(headers)") &&
      helperSource.includes('result.set("Content-Type", "application/json")'),
    "backend auth must expose a safe JSON header builder",
  );

  assert(
    helperSource.includes("getVerifiedBearerIdentity") &&
      helperSource.includes("/auth/v1/user") &&
      helperSource.includes("apikey: anonKey") &&
      helperSource.includes("incomingAuth") &&
      helperSource.includes("const identity = await getVerifiedBearerIdentity(incomingAuth)") &&
      helperSource.includes("headers.set(FORWARDED_SUPABASE_USER_ID_HEADER, identity.userId)") &&
      helperSource.includes("headers.set(FORWARDED_SUPABASE_EMAIL_HEADER, identity.email)") &&
      helperSource.includes("authUserId: identity?.userId || null") &&
      helperSource.includes("authEmail: identity?.email || null"),
    "backend auth helper must verify incoming Supabase bearer tokens and forward trusted user identity headers to backend services",
  );

  const scanTerminalRoute = fs.readFileSync(
    path.join(projectRoot, "app", "api", "scan", "terminal", "route.ts"),
    "utf8",
  );
  const cityDetailBatchRoute = fs.readFileSync(
    path.join(projectRoot, "app", "api", "cities", "detail-batch", "route.ts"),
    "utf8",
  );
  assert(
    scanTerminalRoute.includes("includeSupabaseIdentity: true"),
    "scan terminal proxy must forward the Supabase identity; otherwise paid users hit backend 401 even when /api/auth/me is active",
  );
  assert(
    cityDetailBatchRoute.includes("includeSupabaseIdentity: true"),
    "city detail batch proxy must forward the Supabase identity; otherwise paid users see empty charts with backend 401",
  );
}
