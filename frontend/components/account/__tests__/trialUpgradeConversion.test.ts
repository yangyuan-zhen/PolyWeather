import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const accountDir = path.join(projectRoot, "components", "account");
  const accountCenter = fs.readFileSync(path.join(accountDir, "AccountCenter.tsx"), "utf8");
  const paymentFlow = fs.readFileSync(path.join(accountDir, "usePaymentFlow.ts"), "utf8");
  const accountPayment = fs.readFileSync(path.join(accountDir, "useAccountPayment.ts"), "utf8");
  const landingPage = fs.readFileSync(
    path.join(projectRoot, "components", "landing", "InstitutionalLandingPage.tsx"),
    "utf8",
  );
  const landingAuthActions = fs.readFileSync(
    path.join(projectRoot, "components", "landing", "LandingAuthActions.tsx"),
    "utf8",
  );
  const productAccess = fs.readFileSync(
    path.join(projectRoot, "components", "dashboard", "scan-terminal", "ProductAccessRequired.tsx"),
    "utf8",
  );

  assert(
    accountCenter.includes("canTrialUpgrade") &&
      accountCenter.includes("isTrialSubscription") &&
      accountCenter.includes("canTrialUpgrade || !isSubscribed"),
    "trial subscribers must be allowed to open the Pro checkout before expiry",
  );

  assert(
    accountCenter.includes("useSearchParams") &&
      accountCenter.includes('searchParams.get("checkout") === "1"') &&
      accountCenter.includes("setShowOverlay(true)"),
    "account page must support /account?checkout=1 for direct upgrade entry",
  );

  assert(
    accountCenter.includes('href="/auth/login?next=%2Faccount%3Fcheckout%3D1"'),
    "account page sign-in button must preserve the checkout entry for unauthenticated subscription recovery",
  );

  assert(
    landingAuthActions.includes('href="/account?checkout=1"') &&
      landingPage.includes('href="/account?checkout=1"') &&
      !/href="\/account"(?![/?#])/.test(landingAuthActions) &&
      !/href="\/account"(?![/?#])/.test(landingPage),
    "landing subscription/account CTAs must open the checkout account entry instead of a generic account page",
  );

  assert(
    productAccess.includes('href="/account?checkout=1"') &&
      productAccess.includes("Renew and restore access") &&
      productAccess.includes("续费并恢复访问"),
    "expired terminal gate must send users directly to the checkout entry with renewal recovery copy, not a generic account page",
  );

  assert(
    accountPayment.includes("authUserId,") &&
      paymentFlow.includes("authUserId: string") &&
      paymentFlow.includes("user_id: authUserId || null"),
    "payment_start and payment_success analytics must carry the authenticated user id for trial-to-paid attribution",
  );
}
