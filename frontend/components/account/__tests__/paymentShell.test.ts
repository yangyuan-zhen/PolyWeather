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
  const paymentFlowSource = fs.readFileSync(
    path.join(accountDir, "usePaymentFlow.ts"),
    "utf8",
  );
  const useBillingSource = fs.readFileSync(
    path.join(accountDir, "useBilling.ts"),
    "utf8",
  );
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
  const paymentConfigRouteSource = fs.readFileSync(
    path.join(projectRoot, "app", "api", "payments", "config", "route.ts"),
    "utf8",
  );
  const paymentRuntimeRouteSource = fs.readFileSync(
    path.join(projectRoot, "app", "api", "payments", "runtime", "route.ts"),
    "utf8",
  );
  const backendAuthSource = fs.readFileSync(
    path.join(projectRoot, "lib", "backend-auth.ts"),
    "utf8",
  );
  const opsAdminSource = fs.readFileSync(
    path.join(projectRoot, "lib", "ops-admin.ts"),
    "utf8",
  );
  const supabaseServerSource = fs.readFileSync(
    path.join(projectRoot, "lib", "supabase", "server.ts"),
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
  const membershipsPageSource = fs.readFileSync(
    path.join(
      projectRoot,
      "components",
      "ops",
      "memberships",
      "MembershipsPageClient.tsx",
    ),
    "utf8",
  );
  const opsOverviewSource = fs.readFileSync(
    path.join(
      projectRoot,
      "components",
      "ops",
      "overview",
      "OverviewPageClient.tsx",
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
    !accountCenterSource.includes("md:w-96"),
    "account payment management must not use a narrow fixed sidebar that creates an overlong column",
  );
  assert(
    accountCenterSource.includes("items-start") &&
      accountCenterSource.includes("xl:grid-cols-[minmax(0,0.9fr)_minmax(620px,1.1fr)]"),
    "account secondary sections must align cards to the top and give payment management a wider responsive column",
  );
  assert(
    accountCenterSource.includes("data-testid=\"payment-management-grid\"") &&
      accountCenterSource.includes('hasTelegramPanel ? "" : "lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]"') &&
      accountCenterSource.includes("data-testid=\"payment-guard-grid\"") &&
      accountCenterSource.includes('hasTelegramPanel ? "" : "sm:grid-cols-2"'),
    "payment management must only split into internal columns when it is not already sharing the row with a Telegram panel",
  );
  assert(
    !accountCenterSource.includes("`/bind ${userId}${email ? ` ${email}` : \"\"}`") &&
      !accountCenterSource.includes("/bind <supabase_user_id> <email>"),
    "Telegram fallback copy must not expose the legacy /bind supabase_user_id command",
  );
  assert(
    accountCenterSource.includes("telegramBindCommand") &&
      accountCenterSource.includes("createTelegramBotBindCommand") &&
      accountCenterSource.includes("handleCopyTelegramBindCommand"),
    "account Telegram fallback copy must generate a fresh one-time /start bind token before copying",
  );
  assert(
    useBillingSource.includes("bot_command") &&
      useBillingSource.includes("createTelegramBotBindCommand") &&
      useBillingSource.includes("telegramBindCommand"),
    "billing hook must persist the backend /start bind token command for Telegram fallback copy",
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
    appAnalyticsSource.includes('| "landing_view"') &&
      appAnalyticsSource.includes('| "enter_terminal"') &&
      appAnalyticsSource.includes('| "login_start"') &&
      appAnalyticsSource.includes('| "signup_success"') &&
      appAnalyticsSource.includes('| "trial_created"') &&
      appAnalyticsSource.includes('| "payment_start"') &&
      appAnalyticsSource.includes('| "payment_success"'),
    "app analytics must expose the standard growth funnel event names",
  );
  assert(
    accountCenterSource.includes('trackAppEvent("signup_success"') &&
      accountCenterSource.includes('trackAppEvent("trial_created"') &&
      accountCenterSource.includes("subscription_is_trial"),
    "account center must emit signup_success and trial_created for the standard funnel",
  );
  assert(
    paymentFlowSource.includes('trackAppEvent("payment_start"') &&
      paymentFlowSource.includes('trackAppEvent("payment_success"'),
    "payment flow must emit payment_start and payment_success alongside legacy checkout events",
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
    hookSource.includes("refreshEntitlementAfterPayment") &&
      paymentFlowSource.includes("refreshEntitlementAfterPayment") &&
      paymentFlowSource.includes("await refreshEntitlementAfterPayment();") &&
      hookSource.includes("subscription_active === true"),
    "successful payment flows must automatically poll /api/auth/me until the paid subscription is visible instead of requiring logout or manual refresh",
  );
  assert(
    !hookSource.includes(".auth.getUser()") &&
      hookSource.includes(".auth.getSession()"),
    "account snapshot loader must use the local Supabase session instead of calling getUser before /api/auth/me validates the bearer",
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
    membershipsPageSource.includes("opsApi.membershipsOverview") &&
      !membershipsPageSource.includes('fetch("/api/ops/memberships/growth?days=90"') &&
      !membershipsPageSource.includes("Promise.all"),
    "ops memberships page must load memberships and growth through one overview proxy request to avoid duplicate Supabase session/subscription reads",
  );
  assert(
    opsOverviewSource.includes("opsApi.membershipsOverview(200, 30)") &&
      !opsOverviewSource.includes("opsApi.memberships()") &&
      !opsOverviewSource.includes("opsApi.membershipsGrowth(30)"),
    "ops overview page must reuse membershipsOverview for table and growth data instead of issuing separate membership/growth proxy requests",
  );
  assert(
    grantRouteSource.includes("grantSubscriptionDirectly") &&
      grantRouteSource.includes("res.status === 404") &&
      grantRouteSource.includes('"status": "active"') &&
      grantRouteSource.includes("/rest/v1/profiles") &&
      grantRouteSource.includes("select=id&email=eq.") &&
      grantRouteSource.indexOf("/rest/v1/profiles") <
        grantRouteSource.indexOf("/auth/v1/admin/users") &&
      grantRouteSource.includes('Prefer: "return=minimal"'),
    "ops subscription grant route must fall back to direct Supabase grant and resolve users via indexed profiles before Auth Admin",
  );
  assert(
    authMeRouteSource.includes("isSubscriptionRequiredBackendResponse(res.status, raw)") &&
      authMeRouteSource.includes("subscriptionRequiredAuthProfileResponse") &&
      authMeRouteSource.includes("degradedAuthProfileResponse") &&
      authMeRouteSource.includes("reason: `backend_${res.status}`") &&
      authMeRouteSource.includes("subscription_active: null"),
    "auth profile proxy must only convert explicit subscription-required 403 responses to inactive access while preserving unrelated backend 401/403 responses as unknown subscription",
  );
  assert(
    (authMeRouteSource.match(/buildBackendRequestHeaders\(req\)/g) || []).length === 1 &&
      authMeRouteSource.includes("let auth: Awaited<ReturnType<typeof buildBackendRequestHeaders>> | null = null"),
    "auth profile proxy must build backend auth headers once and reuse them on timeout/error fallback",
  );
  assert(
    authMeRouteSource.includes("hasSupabaseServerEnv()") &&
      authMeRouteSource.includes("!auth.authUserId") &&
      authMeRouteSource.includes('req.headers.get("authorization")') &&
      authMeRouteSource.indexOf("authenticated: false") <
        authMeRouteSource.indexOf("await fetch(buildBackendAuthMeUrl(req)"),
    "auth profile proxy must return unauthenticated locally for no-session Supabase requests instead of forwarding the backend entitlement token",
  );
  assert(
    authMeRouteSource.includes("function buildBackendAuthMeUrl") &&
      authMeRouteSource.includes('url.searchParams.set("scope", "entitlement")'),
    "auth profile proxy must forward the lightweight entitlement scope to the backend auth/me endpoint",
  );
  assert(
    authMeRouteSource.includes('reason: "prefer_snapshot_fast_path"') &&
      authMeRouteSource.indexOf('reason: "prefer_snapshot_fast_path"') <
        authMeRouteSource.indexOf("buildBackendRequestHeaders(req)"),
    "auth profile proxy must return a valid entitlement snapshot before reading Supabase session cookies on terminal cold start",
  );
  assert(
    backendAuthSource.includes("if (incomingAuth) {") &&
      backendAuthSource.indexOf("if (incomingAuth) {") <
        backendAuthSource.indexOf("const supabase = createSupabaseRouteClient"),
    "backend proxy must forward caller bearer tokens before creating a Supabase route client to avoid duplicate getUser calls",
  );
  assert(
    backendAuthSource.includes("headers.set(FORWARDED_SUPABASE_USER_ID_HEADER") &&
      backendAuthSource.includes("headers.set(FORWARDED_SUPABASE_EMAIL_HEADER") &&
      backendAuthSource.indexOf("headers.set(FORWARDED_SUPABASE_USER_ID_HEADER") >
        backendAuthSource.indexOf("const sessionUser = session?.user"),
    "backend proxy must forward Supabase session user id/email with the backend token so Python can skip duplicate /auth/v1/user validation",
  );
  assert(
    backendAuthSource.includes("function hasSupabaseSessionCookie") &&
      backendAuthSource.includes("String(cookie.value || \"\").trim()") &&
      backendAuthSource.includes("if (!hasSupabaseSessionCookie(request))") &&
      backendAuthSource.indexOf("if (!hasSupabaseSessionCookie(request))") <
        backendAuthSource.indexOf("const supabase = createSupabaseRouteClient"),
    "backend proxy must skip Supabase route client/session reads when no auth cookie is present",
  );
  assert(
    !backendAuthSource.includes(".auth.getUser()") &&
      backendAuthSource.includes(".auth.getSession()"),
    "backend proxy must not call Supabase getUser before forwarding a bearer token that the backend validates again",
  );
  assert(
    supabaseServerSource.includes("export function hasSupabaseSessionCookieValues") &&
      supabaseServerSource.includes('name === "supabase-auth-token"') &&
      supabaseServerSource.includes('name.startsWith("sb-")') &&
      supabaseServerSource.indexOf("if (!hasSupabaseSessionCookieValues") <
        supabaseServerSource.indexOf("const supabase = createSupabaseServerClient"),
    "Supabase server helpers must expose one cookie detector and skip refresh getUser calls when no session cookie exists",
  );
  assert(
    supabaseServerSource.includes(".auth.getClaims()") &&
      !supabaseServerSource.includes(".auth.getUser()"),
    "Supabase middleware refresh must validate JWTs with getClaims so asymmetric JWT projects avoid per-request /auth/v1/user reads",
  );
  assert(
    opsAdminSource.includes("hasSupabaseSessionCookieValues") &&
      opsAdminSource.indexOf("if (!hasSupabaseSessionCookieValues") <
        opsAdminSource.indexOf("const supabase = createSupabaseServerClient"),
    "ops admin page gate must redirect before creating a Supabase client/getUser call when no session cookie exists",
  );
  assert(
    opsAdminSource.includes(".auth.getClaims()") &&
      !opsAdminSource.includes(".auth.getUser()") &&
      opsAdminSource.includes("claims?.email"),
    "ops admin page gate must use verified JWT claims instead of a per-page getUser auth lookup",
  );
  assert(
    paymentConfigRouteSource.includes("includeSupabaseIdentity: false"),
    "payment config proxy must not read Supabase session cookies for public cached config",
  );
  assert(
    paymentRuntimeRouteSource.includes("includeSupabaseIdentity: false"),
    "payment runtime proxy must not read Supabase session cookies because backend entitlement token already protects the runtime status payload",
  );
  assert(
    (paymentFlowSource.match(/await buildAuthedHeaders\(true, true\);/g) || [])
      .length >= 3,
    "manual payment mutations must require a valid Supabase bearer token instead of forwarding unauthenticated requests that surface raw backend JSON",
  );
  assert(
    paymentFlowSource.includes("verifyPaymentAuthReady") &&
      paymentFlowSource.indexOf("await verifyPaymentAuthReady()") <
        paymentFlowSource.indexOf("resolvePaymentProvider(") &&
      paymentFlowSource.includes("auth_confirmed_at"),
    "wallet checkout must confirm a fresh Supabase bearer before opening wallet prompts or creating payment intents",
  );
}
