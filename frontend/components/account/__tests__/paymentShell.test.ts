import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const accountCenterPath = path.join(
    projectRoot,
    "components",
    "account",
    "AccountCenter.tsx",
  );
  const serviceWorkerPath = path.join(projectRoot, "public", "sw.js");

  const accountCenterSource = fs.readFileSync(accountCenterPath, "utf8");
  const accountDir = path.dirname(accountCenterPath);
  const accountSplitFiles = [
    "types.ts",
    "constants.ts",
    "formatters.ts",
    "wallet.ts",
    "payment-utils.ts",
    "AccountInfoRow.tsx",
    "account-copy.ts",
    "usePaymentState.ts",
  ];
  for (const file of accountSplitFiles) {
    assert(
      fs.existsSync(path.join(accountDir, file)),
      `AccountCenter split file must exist: components/account/${file}`,
    );
  }
  const accountFeatureSource = [
    "AccountCenter.tsx",
    "account-copy.ts",
    "wallet.ts",
    "payment-utils.ts",
    "usePaymentState.ts",
    "useWalletBind.ts",
    "usePaymentFlow.ts",
    "useBilling.ts",
  ]
    .map((file) => fs.readFileSync(path.join(accountDir, file), "utf8"))
    .join("\n");
  assert(
    accountCenterSource.split(/\r?\n/).length < 3200,
    "AccountCenter.tsx must stay below 3200 lines after extracting account helpers",
  );
  assert(
    accountCenterSource.includes('import { createAccountCopy } from "./account-copy";') &&
      accountCenterSource.includes('const copy = useMemo(() => createAccountCopy(isEn), [isEn]);'),
    "AccountCenter copy text must be centralized in account-copy.ts instead of an inline 170+ line object",
  );
  const hookPath = path.join(accountDir, "useAccountPayment.ts");
  const hookSource = fs.existsSync(hookPath)
    ? fs.readFileSync(hookPath, "utf8")
    : "";
  assert(
    (accountCenterSource.includes('import { usePaymentState } from "./usePaymentState";') ||
      hookSource.includes('import { usePaymentState } from "./usePaymentState";')) &&
      (accountCenterSource.includes("clearPaymentState") ||
        hookSource.includes("clearPaymentState")) &&
      (accountCenterSource.includes("clearPaymentMessages") ||
        hookSource.includes("clearPaymentMessages")),
    "payment UI state reset/message helpers must be centralized in usePaymentState.ts",
  );
  const serviceWorkerSource = fs.readFileSync(serviceWorkerPath, "utf8");
  const appAnalyticsSource = fs.readFileSync(
    path.join(projectRoot, "lib", "app-analytics.ts"),
    "utf8",
  );
  const analyticsRouteSource = fs.readFileSync(
    path.join(projectRoot, "app", "api", "analytics", "events", "route.ts"),
    "utf8",
  );
  const grantRouteSource = fs.readFileSync(
    path.join(
      projectRoot,
      "app",
      "api",
      "ops",
      "subscriptions",
      "grant",
      "route.ts",
    ),
    "utf8",
  );
  const authMeRouteSource = fs.readFileSync(
    path.join(projectRoot, "app", "api", "auth", "me", "route.ts"),
    "utf8",
  );
  const subscriptionsPageSource = fs.readFileSync(
    path.join(
      projectRoot,
      "components",
      "ops",
      "subscriptions",
      "SubscriptionsPageClient.tsx",
    ),
    "utf8",
  );

  assert(
    accountCenterSource.includes(
      'import { UnlockProOverlay } from "@/components/subscription/UnlockProOverlay";',
    ),
    "checkout overlay must be in the account bundle, not lazy-loaded after the user clicks pay",
  );
  assert(
    !/const\s+UnlockProOverlay\s*=\s*dynamic\s*\(/.test(accountCenterSource),
    "checkout overlay must not be dynamically imported; stale deployments can make the lazy chunk fail at pay time",
  );
  assert(
    !/STATIC_ASSETS\s*=\s*\[[^\]]*["']\/_next\//s.test(serviceWorkerSource),
    "service worker must not cache-first the whole /_next/ tree; stale chunks break checkout after deploys",
  );
  assert(
    !/label\.toLowerCase\(\)\.includes\(["']binance["']\)\)\s*return/.test(
      accountFeatureSource,
    ),
    "Binance Web3 Wallet injected provider must remain available for browser-extension binding",
  );
  assert(
    accountFeatureSource.includes("Binance 扩展已绑定") &&
      accountFeatureSource.includes("如支付卡住，请优先使用 WalletConnect 扫码支付"),
    "Binance extension binding must show a WalletConnect fallback hint for payment stability",
  );
  assert(
    accountFeatureSource.includes("钱包里需要少量 POL 作为 gas 手续费") &&
      accountFeatureSource.includes("只有 USDC 可能无法完成授权或支付"),
    "payment wallet tab must warn users that Polygon POL gas is required in addition to USDC",
  );
  assert(
    !appAnalyticsSource.includes('NEXT_PUBLIC_POLYWEATHER_APP_ANALYTICS === "true"') &&
      !analyticsRouteSource.includes('NEXT_PUBLIC_POLYWEATHER_APP_ANALYTICS === "true"'),
    "app analytics must be enabled by default so ops funnel can collect data without a fragile production env flag",
  );
  assert(
    accountCenterSource.includes('trackAppEvent("signup_completed"') &&
      accountCenterSource.includes('trackAppEvent("dashboard_active"'),
    "account center must emit signup_completed and dashboard_active so the ops funnel has top-of-funnel data",
  );
  assert(
    accountCenterSource.includes("isSubscriptionUnknown") &&
      accountCenterSource.includes("subscriptionStatusLabel") &&
      !accountCenterSource.includes(
        'backend?.subscription_active);',
      ),
    "account center must distinguish unknown subscription sync state from a confirmed unsubscribed account",
  );
  assert(
    hookSource.includes("backendJson.authenticated === false") &&
      hookSource.includes("refreshSession()") &&
      hookSource.includes("retriedBackendJson"),
    "account snapshot loader must retry with a refreshed Supabase token when local user exists but /api/auth/me reports unauthenticated",
  );
  assert(
    subscriptionsPageSource.includes("getSupabaseBrowserClient") &&
      subscriptionsPageSource.includes("refreshSession") &&
      subscriptionsPageSource.includes("Authorization") &&
      subscriptionsPageSource.includes("/api/ops/subscriptions/grant") &&
      subscriptionsPageSource.includes("/api/ops/subscriptions/extend"),
    "ops manual subscription grant/extend must send the Supabase bearer token to avoid 401 when route cookies are stale",
  );
  assert(
    grantRouteSource.includes("grantSubscriptionDirectly") &&
      grantRouteSource.includes("res.status === 404") &&
      grantRouteSource.includes('"status": "active"'),
    "ops subscription grant route must fall back to direct Supabase grant when the VPS backend route is missing",
  );
  assert(
    authMeRouteSource.includes("if ((res.status === 401 || res.status === 403) && auth.authUserId)") &&
      authMeRouteSource.includes("degraded_reason: `backend_${res.status}`") &&
      authMeRouteSource.includes("subscription_active: null"),
    "auth profile proxy must preserve authenticated identity with unknown subscription on backend 401/403 instead of forcing a false paywall",
  );
}
