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
      accountCenterSource,
    ),
    "Binance Web3 Wallet injected provider must remain available for browser-extension binding",
  );
  assert(
    accountCenterSource.includes("Binance 扩展已绑定") &&
      accountCenterSource.includes("如支付卡住，请优先使用 WalletConnect 扫码支付"),
    "Binance extension binding must show a WalletConnect fallback hint for payment stability",
  );
  assert(
    accountCenterSource.includes("钱包里需要少量 Polygon POL/MATIC 作为 gas 手续费") &&
      accountCenterSource.includes("只有 USDC 可能无法完成授权或支付"),
    "payment wallet tab must warn users that Polygon POL/MATIC gas is required in addition to USDC",
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
}
