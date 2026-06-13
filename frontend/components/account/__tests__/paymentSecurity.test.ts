import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const EXPECTED_RECEIVER = "0x351a1bca5f49dd0046a7cf0bafa7e12fa6441c3a";

export function runTests() {
  const projectRoot = process.cwd();
  const receiverModulePath = path.join(projectRoot, "lib", "payment-receiver.ts");
  const backendAuthPath = path.join(projectRoot, "lib", "backend-auth.ts");
  const middlewarePath = path.join(projectRoot, "middleware.ts");
  const accountCenterPath = path.join(
    projectRoot,
    "components",
    "account",
    "AccountCenter.tsx",
  );
  const paymentRoutes = [
    "app/api/payments/wallets/challenge/route.ts",
    "app/api/payments/wallets/verify/route.ts",
    "app/api/payments/wallets/route.ts",
    "app/api/payments/intents/route.ts",
    "app/api/payments/intents/[intentId]/submit/route.ts",
    "app/api/payments/intents/[intentId]/confirm/route.ts",
    "app/api/payments/intents/[intentId]/validate/route.ts",
    "app/api/payments/reconcile-latest/route.ts",
  ];

  assert(
    fs.existsSync(receiverModulePath),
    "payment receiver guard module must exist",
  );
  const receiverSource = fs.readFileSync(receiverModulePath, "utf8");
  assert(
    receiverSource.includes(EXPECTED_RECEIVER),
    "payment receiver guard must pin the production receiver address",
  );
  assert(
    receiverSource.includes("assertExpectedPaymentReceiver"),
    "payment receiver guard must expose an assertion helper",
  );

  const accountCenterSource = fs.readFileSync(accountCenterPath, "utf8");
  const walletBindSource = fs.readFileSync(
    path.join(projectRoot, "components", "account", "useWalletBind.ts"),
    "utf8",
  );
  const hookPath = path.join(
    projectRoot,
    "components",
    "account",
    "useAccountPayment.ts",
  );
  const hookSource = fs.existsSync(hookPath)
    ? fs.readFileSync(hookPath, "utf8")
    : "";
  const paymentFlowPath = path.join(
    projectRoot,
    "components",
    "account",
    "usePaymentFlow.ts",
  );
  const paymentFlowSource = fs.existsSync(paymentFlowPath)
    ? fs.readFileSync(paymentFlowPath, "utf8")
    : "";
  const paymentUtilsSource = fs.readFileSync(
    path.join(projectRoot, "components", "account", "payment-utils.ts"),
    "utf8",
  );

  // The receiver validation now lives in the extracted hook file (called
  // from createManualPaymentIntent and createIntentAndPay).
  assert(
    accountCenterSource.includes("assertExpectedPaymentReceiver") ||
      hookSource.includes("assertExpectedPaymentReceiver") ||
      paymentFlowSource.includes("assertExpectedPaymentReceiver"),
    "AccountCenter must validate backend-returned manual payment receiver before displaying it",
  );
  assert(
    /!\(\s*txValidation\.checked\s*&&\s*txValidation\.valid === true\s*\)/.test(
      accountCenterSource,
    ),
    "manual payment submit button must require checked && valid === true",
  );
  assert(
    paymentFlowSource.includes("validateTxHash") &&
      paymentFlowSource.includes("/validate"),
    "manual payment flow must validate tx hashes with the backend before submission",
  );
  assert(
    paymentFlowSource.includes("await waitForReceipt(txHashNorm, eth)") &&
      paymentFlowSource.indexOf("await waitForReceipt(txHashNorm, eth)") <
        paymentFlowSource.indexOf("const submitRes = await fetch(`/api/payments/intents/${intentId}/submit`"),
    "wallet payment flow must wait for the payment tx receipt before submitting tx hash to the backend",
  );
  assert(
    accountCenterSource.includes("EXPECTED_PAYMENT_RECEIVER_ADDRESS") ||
      hookSource.includes("EXPECTED_PAYMENT_RECEIVER_ADDRESS") ||
      paymentFlowSource.includes("EXPECTED_PAYMENT_RECEIVER_ADDRESS"),
    "AccountCenter must show the pinned payment receiver address in its payment guard",
  );

  const backendAuthSource = fs.readFileSync(backendAuthPath, "utf8");
  assert(
    backendAuthSource.includes("requireBackendAuthUser"),
    "backend auth helper must expose a real-user requirement for payment mutations",
  );
  assert(
    backendAuthSource.includes("requireBackendPaymentAuth") &&
      backendAuthSource.includes("hasBearerAuth"),
    "backend auth helper must allow bearer-backed payment mutations to reach the backend verifier",
  );

  const middlewareSource = fs.readFileSync(middlewarePath, "utf8");
  assert(
    !middlewareSource.includes("/^bearer\\s+\\S+/i.test(authHeader)") &&
      !middlewareSource.includes("return NextResponse.next();\n    }\n  }\n\n  const response = NextResponse.next"),
    "middleware must not treat the mere presence of a bearer token as authenticated",
  );
  assert(
    middlewareSource.includes("function hasSupabaseSessionCookie") &&
      middlewareSource.includes("request.cookies.getAll()") &&
      middlewareSource.includes("hasSupabaseSessionCookieValues"),
    "middleware must detect non-empty Supabase session cookies locally via the shared helper before refreshing auth",
  );
  assert(
    middlewareSource.includes("redirectToLogin(request, pathname)") &&
      middlewareSource.indexOf("if (!hasSupabaseSessionCookie(request))") <
        middlewareSource.indexOf("await refreshMiddlewareSession(request)"),
    "middleware must redirect no-cookie page requests without calling Supabase auth",
  );
  const terminalGateSource = middlewareSource.slice(
    middlewareSource.indexOf("async function handleTerminalGate"),
    middlewareSource.indexOf("async function handleSupabaseAuthGate"),
  );
  assert(
    terminalGateSource.includes("return response;") &&
      !terminalGateSource.includes("return redirectToLogin(request, pathname);\n}"),
    "terminal middleware must not navigate long-lived dashboards away when a session cookie exists but claims refresh is transiently unavailable",
  );
  assert(
    middlewareSource.includes("unauthorizedSupabaseSessionResponse()"),
    "middleware must reject no-cookie protected API requests without calling Supabase auth",
  );

  const authMeRouteSource = fs.readFileSync(
    path.join(projectRoot, "app", "api", "auth", "me", "route.ts"),
    "utf8",
  );
  assert(
    authMeRouteSource.includes("/auth/v1/user") &&
      authMeRouteSource.includes("getVerifiedBearerIdentity") &&
      authMeRouteSource.includes("degraded_auth_profile: true"),
    "/api/auth/me must verify bearer tokens directly and return a degraded authenticated profile when the backend auth profile is transiently unavailable",
  );
  assert(
    authMeRouteSource.includes("const identity = await getBearerIdentityOnce();") &&
      !authMeRouteSource.includes("return buildProxyExceptionResponse(error"),
    "/api/auth/me must try bearer identity fallback before returning a proxy exception",
  );
  assert(
    authMeRouteSource.includes("exception_snapshot") &&
      authMeRouteSource.includes("unauthenticatedAuthProfileResponse") &&
      !authMeRouteSource.includes("return buildProxyExceptionResponse(error"),
    "/api/auth/me must serve a snapshot or anonymous auth profile before surfacing proxy exceptions to long-lived clients",
  );
  for (const route of [
    "app/api/ops/analytics/funnel/route.ts",
    "app/api/ops/config/route.ts",
    "app/api/ops/health-check/route.ts",
    "app/api/ops/leaderboard/weekly/route.ts",
    "app/api/ops/memberships/route.ts",
    "app/api/ops/memberships/growth/route.ts",
    "app/api/ops/memberships/overview/route.ts",
    "app/api/ops/online-users/route.ts",
    "app/api/ops/payments/incidents/route.ts",
    "app/api/ops/payments/incidents/[eventId]/resolve/route.ts",
    "app/api/ops/subscriptions/extend/route.ts",
    "app/api/ops/subscriptions/grant/route.ts",
    "app/api/ops/telegram/members-audit/route.ts",
    "app/api/ops/training/accuracy/route.ts",
    "app/api/ops/truth-history/route.ts",
    "app/api/ops/users/route.ts",
    "app/api/ops/users/grant-points/route.ts",
    "app/api/ops/view-logs/route.ts",
    "app/api/system/status/route.ts",
  ]) {
    const routeSource = fs.readFileSync(path.join(projectRoot, route), "utf8");
    assert(
      routeSource.includes("requireOpsProxyAuth(req, auth)") &&
        routeSource.indexOf("requireOpsProxyAuth(req, auth)") >
          routeSource.indexOf("buildBackendRequestHeaders(req"),
      `${route} must reject requests without Supabase identity before forwarding the backend entitlement token`,
    );
  }
  assert(
    middlewareSource.includes('pathname === "/api/payments/config"'),
    "middleware must treat public payment config as public API so cached config requests do not refresh Supabase sessions",
  );
  const optionalRefreshFunction = middlewareSource.slice(
    middlewareSource.indexOf("function shouldRefreshOptionalSupabaseSession"),
    middlewareSource.indexOf("function hasSupabaseSessionCookie"),
  );
  assert(
    !optionalRefreshFunction.includes('pathname.startsWith("/api/ops/")') &&
      !optionalRefreshFunction.includes('pathname.startsWith("/api/payments/")'),
    "optional Supabase middleware refresh must not pre-read sessions for API routes that already build backend auth headers",
  );
  const optionalRefreshIndex = middlewareSource.indexOf(
    "function shouldRefreshOptionalSupabaseSession",
  );
  assert(
    optionalRefreshIndex >= 0 &&
      !middlewareSource.includes('pathname === "/api/system/status"'),
    "middleware must not treat system status as public after it becomes an ops-only API",
  );

  for (const route of paymentRoutes) {
    const routeSource = fs.readFileSync(path.join(projectRoot, route), "utf8");
    assert(
      routeSource.includes("requireBackendPaymentAuth") &&
        !routeSource.includes("requireBackendAuthUser(auth)"),
      `${route} must allow bearer-backed payment mutations while still rejecting requests with no auth context`,
    );
  }

  const walletChallengeRouteSource = fs.readFileSync(
    path.join(projectRoot, "app/api/payments/wallets/challenge/route.ts"),
    "utf8",
  );
  assert(
    walletChallengeRouteSource.includes("fetchWalletChallengeWithRetry"),
    "wallet challenge proxy must retry a transient backend connection failure before blocking payment",
  );
  assert(
    walletChallengeRouteSource.includes("Invalid wallet challenge request"),
    "wallet challenge proxy must return a client error for malformed JSON instead of a generic payment failure",
  );
  assert(
    walletChallengeRouteSource.includes("retryable: true"),
    "wallet challenge proxy exception response must mark transient failures as retryable",
  );
  const walletVerifyRouteSource = fs.readFileSync(
    path.join(projectRoot, "app/api/payments/wallets/verify/route.ts"),
    "utf8",
  );
  assert(
    walletVerifyRouteSource.includes("fetchWalletVerifyWithRetry"),
    "wallet verify proxy must retry a transient backend connection failure before blocking wallet binding",
  );
  assert(
    walletVerifyRouteSource.includes("Invalid wallet verify request"),
    "wallet verify proxy must return a client error for malformed JSON instead of a generic payment failure",
  );
  assert(
    walletVerifyRouteSource.includes("retryable: true"),
    "wallet verify proxy exception response must mark transient failures as retryable",
  );
  assert(
    walletBindSource.includes("readPaymentApiErrorMessage"),
    "wallet binding errors must show the API error message instead of raw JSON",
  );
  assert(
    walletBindSource.includes("钱包验证服务暂时不可用"),
    "wallet binding HTML/50x fallback should stay localized in the Chinese account UI",
  );
  assert(
    paymentUtilsSource.includes("looksLikeHtmlDocument") &&
      paymentUtilsSource.includes("Payment service is temporarily unavailable") &&
      paymentUtilsSource.includes("支付服务暂时不可用"),
    "payment API error parsing must collapse upstream HTML/Cloudflare 50x pages into a user-safe message",
  );
  assert(
    paymentFlowSource.includes("readPaymentApiErrorMessage") &&
      !paymentFlowSource.includes("(await submitRes.text()).slice(0, 350)") &&
      !paymentFlowSource.includes("(await confirmRes.text()).slice(0, 350)"),
    "payment submit/confirm failures must use sanitized API error messages instead of raw response text",
  );
  const submitRouteSource = fs.readFileSync(
    path.join(
      projectRoot,
      "app",
      "api",
      "payments",
      "intents",
      "[intentId]",
      "submit",
      "route.ts",
    ),
    "utf8",
  );
  assert(
    submitRouteSource.includes("Payment submit upstream failed") &&
      !submitRouteSource.includes("error: detail || undefined"),
    "payment submit proxy must not copy raw upstream HTML into the public error field",
  );
}
