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
      loginClientSource.includes("subscription_active === true") &&
      loginClientSource.includes("return TERMINAL_CHECKOUT_PATH") &&
      loginClientSource.includes("router.replace(redirectPath)") &&
      !loginClientSource.includes("if (!response.ok) return nextPath;") &&
      !loginClientSource.includes("catch {\n    return nextPath;") &&
      !loginClientSource.includes("router.replace(nextPath);\n        return;"),
    "email/password terminal login must only enter /terminal after confirmed active subscription; unknown or inactive users go to checkout",
  );

  assert(
    authCallbackSource.includes("resolvePostAuthRedirect") &&
      authCallbackSource.includes("TERMINAL_CHECKOUT_PATH") &&
      authCallbackSource.includes('"/account?checkout=1"') &&
      authCallbackSource.includes("subscription_active === true") &&
      authCallbackSource.includes("NextResponse.redirect(redirectUrl)") &&
      authCallbackSource.includes("await resolvePostAuthRedirect"),
    "OAuth terminal callback must only enter /terminal after confirmed active subscription; unknown or inactive users go to checkout",
  );
}
