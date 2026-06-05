import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const authMeRouteSource = fs.readFileSync(
    path.join(projectRoot, "app", "api", "auth", "me", "route.ts"),
    "utf8",
  );

  assert(
    authMeRouteSource.includes("createAuthMeTimer") &&
      authMeRouteSource.includes("finishAuthMeResponse"),
    "/api/auth/me proxy must centralize timing so every return path can emit instrumentation",
  );
  assert(
    authMeRouteSource.includes('"Server-Timing"') &&
      authMeRouteSource.includes("auth_headers") &&
      authMeRouteSource.includes("backend_fetch") &&
      authMeRouteSource.includes("total"),
    "/api/auth/me proxy must expose stage durations through Server-Timing for HAR inspection",
  );
  assert(
    authMeRouteSource.includes('response.headers.set("Cache-Control", "no-store")') &&
      authMeRouteSource.indexOf('response.headers.set("Cache-Control", "no-store")') >
        authMeRouteSource.indexOf("function finishAuthMeResponse"),
    "/api/auth/me proxy must mark every auth profile response no-store so anonymous state cannot be reused after login",
  );
  const finishStart = authMeRouteSource.indexOf("function finishAuthMeResponse");
  const finishEnd = authMeRouteSource.indexOf("async function trackAuthDiagnosticEvent");
  const finishSource =
    finishStart >= 0 && finishEnd > finishStart
      ? authMeRouteSource.slice(finishStart, finishEnd)
      : "";
  assert(
    finishSource.includes("[auth-me-timing]") &&
      finishSource.includes("hasAuthorization") &&
      finishSource.includes("hasSupabaseCookie") &&
      !finishSource.includes("authUserId") &&
      !finishSource.includes("authEmail") &&
      !finishSource.includes("userId") &&
      !finishSource.includes("email"),
    "/api/auth/me proxy timing logs must include request shape but avoid raw user ids or emails",
  );
}
