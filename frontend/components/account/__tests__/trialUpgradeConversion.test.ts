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
    productAccess.includes('href="/account?checkout=1"') &&
      productAccess.includes("Subscribe & Activate") &&
      productAccess.includes("立即订阅并激活"),
    "expired terminal gate must send users directly to the checkout entry, not a generic account page",
  );

  assert(
    accountPayment.includes("authUserId,") &&
      paymentFlow.includes("authUserId: string") &&
      paymentFlow.includes("user_id: authUserId || null"),
    "payment_start and payment_success analytics must carry the authenticated user id for trial-to-paid attribution",
  );
}
