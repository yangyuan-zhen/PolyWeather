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

  // The receiver validation now lives in the extracted hook file (called
  // from createManualPaymentIntent and createIntentAndPay).
  assert(
    accountCenterSource.includes("assertExpectedPaymentReceiver") ||
      hookSource.includes("assertExpectedPaymentReceiver") ||
      paymentFlowSource.includes("assertExpectedPaymentReceiver"),
    "AccountCenter must validate backend-returned manual payment receiver before displaying it",
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

  const middlewareSource = fs.readFileSync(middlewarePath, "utf8");
  assert(
    !middlewareSource.includes("/^bearer\\s+\\S+/i.test(authHeader)") &&
      !middlewareSource.includes("return NextResponse.next();\n    }\n  }\n\n  const response = NextResponse.next"),
    "middleware must not treat the mere presence of a bearer token as authenticated",
  );

  for (const route of paymentRoutes) {
    const routeSource = fs.readFileSync(path.join(projectRoot, route), "utf8");
    assert(
      routeSource.includes("requireBackendAuthUser"),
      `${route} must reject payment mutations without a real Supabase user`,
    );
  }
}
