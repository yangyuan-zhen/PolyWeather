import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const turnstileLibPath = path.join(projectRoot, "lib", "turnstile.ts");
  const widgetPath = path.join(projectRoot, "components", "security", "TurnstileWidget.tsx");
  const loginPath = path.join(projectRoot, "components", "auth", "LoginClient.tsx");
  const feedbackModalPath = path.join(
    projectRoot,
    "components",
    "dashboard",
    "scan-terminal",
    "UserFeedbackModal.tsx",
  );
  const feedbackRoutePath = path.join(projectRoot, "app", "api", "feedback", "route.ts");
  const paymentIntentRoutePath = path.join(projectRoot, "app", "api", "payments", "intents", "route.ts");
  const paymentSubmitRoutePath = path.join(
    projectRoot,
    "app",
    "api",
    "payments",
    "intents",
    "[intentId]",
    "submit",
    "route.ts",
  );
  const paymentFlowPath = path.join(projectRoot, "components", "account", "usePaymentFlow.ts");

  assert(fs.existsSync(turnstileLibPath), "shared Turnstile verifier module must exist");
  assert(fs.existsSync(widgetPath), "Turnstile widget component must exist");

  const turnstileLib = fs.readFileSync(turnstileLibPath, "utf8");
  const widgetSource = fs.readFileSync(widgetPath, "utf8");
  const loginSource = fs.readFileSync(loginPath, "utf8");
  const feedbackModalSource = fs.readFileSync(feedbackModalPath, "utf8");
  const feedbackRouteSource = fs.readFileSync(feedbackRoutePath, "utf8");
  const paymentIntentRouteSource = fs.readFileSync(paymentIntentRoutePath, "utf8");
  const paymentSubmitRouteSource = fs.readFileSync(paymentSubmitRoutePath, "utf8");
  const paymentFlowSource = fs.readFileSync(paymentFlowPath, "utf8");

  assert(
    turnstileLib.includes("POLYWEATHER_TURNSTILE_SECRET_KEY") &&
      turnstileLib.includes("NEXT_PUBLIC_TURNSTILE_SITE_KEY") &&
      turnstileLib.includes("https://challenges.cloudflare.com/turnstile/v0/siteverify") &&
      turnstileLib.includes("requireTurnstileForRequest") &&
      turnstileLib.includes("POLYWEATHER_TURNSTILE_BYPASS"),
    "Turnstile verifier must be optional, use Cloudflare siteverify, and expose a request guard",
  );
  assert(
    widgetSource.includes("NEXT_PUBLIC_TURNSTILE_SITE_KEY") &&
      widgetSource.includes("challenges.cloudflare.com/turnstile/v0/api.js") &&
      widgetSource.includes("window.turnstile.render") &&
      widgetSource.includes("data-turnstile-action"),
    "Turnstile widget must render Cloudflare Turnstile only when a site key is configured",
  );
  assert(
    loginSource.includes("TurnstileWidget") &&
      loginSource.includes("getTurnstileTokenForAction") &&
      loginSource.includes("captchaToken") &&
      loginSource.includes("signInWithPassword") &&
      loginSource.includes("signUp"),
    "login/signup must attach a Turnstile captchaToken to Supabase auth calls",
  );
  assert(
    feedbackModalSource.includes("TurnstileWidget") &&
      feedbackModalSource.includes("getTurnstileTokenForAction") &&
      feedbackModalSource.includes("turnstile_token"),
    "feedback modal must include a Turnstile token in feedback submissions",
  );
  assert(
    feedbackRouteSource.includes('requireTurnstileForRequest(req, "feedback_submit"') &&
      feedbackRouteSource.indexOf('requireTurnstileForRequest(req, "feedback_submit"') <
        feedbackRouteSource.indexOf("fetch(`${API_BASE}/api/feedback`"),
    "feedback POST proxy must verify Turnstile before forwarding user feedback",
  );
  assert(
    paymentIntentRouteSource.includes('requireTurnstileForRequest(req, "payment_intent_create"') &&
      paymentSubmitRouteSource.includes('requireTurnstileForRequest(req, "payment_tx_submit"'),
    "payment mutation proxies must verify Turnstile before forwarding create and submit requests",
  );
  assert(
    paymentFlowSource.includes("getTurnstileTokenForAction") &&
      paymentFlowSource.includes("turnstile_token") &&
      paymentFlowSource.includes("payment_intent_create") &&
      paymentFlowSource.includes("payment_tx_submit"),
    "payment flow must include Turnstile tokens in intent creation and tx submit payloads",
  );
}
