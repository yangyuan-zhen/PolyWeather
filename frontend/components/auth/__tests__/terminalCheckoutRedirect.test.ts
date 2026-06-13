import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const loginClientSource = fs.readFileSync(
    path.join(projectRoot, "components", "auth", "LoginClient.tsx"),
    "utf8",
  );
  const authCallbackSource = fs.readFileSync(
    path.join(projectRoot, "app", "auth", "callback", "route.ts"),
    "utf8",
  );

  assert(
    loginClientSource.includes("TERMINAL_CHECKOUT_PATH") &&
      loginClientSource.includes('"/account?checkout=1"') &&
      loginClientSource.includes("resolvePostLoginRedirect") &&
      loginClientSource.includes("subscription_active === false") &&
      loginClientSource.includes("router.replace(redirectPath)") &&
      !loginClientSource.includes("router.replace(nextPath);\n        return;"),
    "email/password terminal login must send non-members to the checkout account page instead of blindly returning to /terminal",
  );

  assert(
    authCallbackSource.includes("resolvePostAuthRedirect") &&
      authCallbackSource.includes("TERMINAL_CHECKOUT_PATH") &&
      authCallbackSource.includes('"/account?checkout=1"') &&
      authCallbackSource.includes("subscription_active === false") &&
      authCallbackSource.includes("NextResponse.redirect(redirectUrl)") &&
      authCallbackSource.includes("await resolvePostAuthRedirect"),
    "OAuth terminal callback must send non-members to the checkout account page instead of blindly returning to /terminal",
  );
}
