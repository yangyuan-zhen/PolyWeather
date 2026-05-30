import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const loginClientPath = path.join(
    projectRoot,
    "components",
    "auth",
    "LoginClient.tsx",
  );
  const resetPagePath = path.join(
    projectRoot,
    "app",
    "auth",
    "reset-password",
    "page.tsx",
  );
  const resetClientPath = path.join(
    projectRoot,
    "components",
    "auth",
    "ResetPasswordClient.tsx",
  );
  const authCallbackPath = path.join(
    projectRoot,
    "app",
    "auth",
    "callback",
    "route.ts",
  );

  const loginClientSource = fs.readFileSync(loginClientPath, "utf8");

  assert(
    loginClientSource.includes("/auth/reset-password") &&
      loginClientSource.indexOf("resetPasswordForEmail") <
        loginClientSource.indexOf("/auth/reset-password"),
    "forgot-password emails must land on a password reset page after auth callback",
  );
  assert(
    fs.existsSync(resetPagePath),
    "password reset page must exist at app/auth/reset-password/page.tsx",
  );
  assert(
    fs.existsSync(resetClientPath),
    "password reset page must use a dedicated client component",
  );
  assert(
    loginClientSource.includes("loadingSpinner") &&
      loginClientSource.includes("submittingLabel") &&
      loginClientSource.includes("googleSubmittingLabel") &&
      loginClientSource.includes('aria-busy={loading}') &&
      loginClientSource.includes("animate-spin"),
    "login submit and Google sign-in buttons must show a visible loading spinner and pending label",
  );

  const resetClientSource = fs.readFileSync(resetClientPath, "utf8");
  assert(
    resetClientSource.includes("supabase.auth.updateUser") &&
      resetClientSource.includes("password"),
    "password reset client must update the authenticated user's password",
  );
  assert(
    resetClientSource.includes("getSession") &&
      resetClientSource.includes("expired"),
    "password reset client must detect an expired or invalid recovery session",
  );

  const authCallbackSource = fs.readFileSync(authCallbackPath, "utf8");
  assert(
    authCallbackSource.includes("warmSignupTrial") &&
      authCallbackSource.includes("exchangeCodeForSession") &&
      authCallbackSource.includes("/api/auth/me") &&
      authCallbackSource.includes("Authorization") &&
      authCallbackSource.includes("Bearer"),
    "auth callback must warm /api/auth/me with the exchanged Supabase session so new users receive the signup trial immediately",
  );
}
