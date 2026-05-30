import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const root = projectRoot();
  const source = fs.readFileSync(
    path.join(root, "components", "landing", "InstitutionalLandingPage.tsx"),
    "utf8",
  );
  const authActionsSource = fs.readFileSync(
    path.join(root, "components", "landing", "LandingAuthActions.tsx"),
    "utf8",
  );
  const analyticsSource = fs.readFileSync(
    path.join(root, "components", "landing", "LandingAnalytics.tsx"),
    "utf8",
  );
  const localeToggleSource = fs.readFileSync(
    path.join(root, "components", "landing", "LandingLocaleToggle.tsx"),
    "utf8",
  );
  const appPageSource = fs.readFileSync(path.join(root, "app", "page.tsx"), "utf8");
  const publicPngPath = path.join(root, "public", "static", "web.png");
  const fixturePngPath = path.join(root, "components", "landing", "__tests__", "fixtures", "web.png");
  const webpPath = path.join(root, "public", "static", "web.webp");

  assert(!source.startsWith('"use client"'), "landing body must be a Server Component");
  assert(!source.includes("@/lib/supabase/client"), "landing body must not import the Supabase browser client");
  assert(!source.includes("useEffect") && !source.includes("useState"), "landing body must not hydrate static content with React hooks");
  assert(!source.includes("lucide-react"), "landing body must not import lucide-react for the LCP route");
  assert(authActionsSource.startsWith('"use client"'), "auth actions must be isolated in a client island");
  assert(analyticsSource.startsWith('"use client"'), "analytics must be isolated in a client island");
  assert(localeToggleSource.startsWith('"use client"'), "locale toggle must be isolated in a client island");
  assert(!authActionsSource.includes('from "@/lib/supabase/client"'), "auth island must not eagerly import the Supabase browser client");
  assert(
    authActionsSource.includes("await import(") && authActionsSource.includes('"@/lib/supabase/client"'),
    "auth island must lazy-load the Supabase browser client after hydration",
  );
  assert(!analyticsSource.includes('from "@/lib/app-analytics"'), "analytics island must lazy-load analytics code");
  assert(!authActionsSource.includes("lucide-react"), "auth island must avoid shipping lucide-react");
  assert(!localeToggleSource.includes("lucide-react"), "locale island must avoid shipping lucide-react");
  assert(!analyticsSource.includes("lucide-react"), "analytics island must avoid shipping lucide-react");
  assert(source.includes("3 天免费试用"), "landing page must advertise the 3-day trial");
  assert(source.includes("试用期权益和 Pro 一致，除了不显示付费 Telegram 群链接"), "landing page must state trial access matches Pro except the paid group link");
  assert(!source.includes("高频刷新与 API 仍为 Pro 权益"), "landing page must not incorrectly exclude high-frequency refresh or API from trial access");
  assert(source.includes("bg-[#fbfbfa]"), "landing page must use a light Notion-style background");
  assert(source.includes("WeatherWorkflowIllustration"), "landing page must include a friendly illustration surface");
  assert(!fs.existsSync(publicPngPath), "heavy PNG preview must not remain in public static assets");
  assert(fs.existsSync(fixturePngPath), "PNG preview may only remain as a test fixture");
  assert(fs.existsSync(webpPath), "landing page must ship a WebP preview image for the LCP product screenshot");
  assert(
    fs.statSync(webpPath).size < fs.statSync(fixturePngPath).size * 0.65,
    "WebP preview must be materially smaller than the PNG LCP image",
  );
  assert(source.includes("/static/web.webp"), "landing page must load the lighter WebP product preview image");
  assert(!source.includes('src="/static/web.png"'), "landing hero must not use the heavy PNG as its primary LCP image");
  assert(
    source.includes('width="680"') &&
      source.includes('height="340"') &&
      source.includes('fetchPriority="high"') &&
      source.includes('decoding="async"'),
    "landing product preview must expose stable intrinsic dimensions and high fetch priority",
  );
  assert(
    analyticsSource.includes('"landing_view"') &&
      authActionsSource.includes('"login_start"') &&
      authActionsSource.includes('"enter_terminal"'),
    "landing client islands must emit the top-of-funnel analytics events",
  );
  assert(source.includes("29.9") && source.includes("30 天"), "landing page must show monthly Pro pricing");
  assert(source.includes("79.9") && source.includes("90 天"), "landing page must show quarterly Pro pricing");
  assert(source.includes("20 USDC") && source.includes("+3500 积分"), "landing page must describe referral discount and reward");
  assert(!source.includes("AI 气象证据链解读"), "legacy AI evidence-chain wording must be removed");
  assert(!source.includes("AI weather evidence"), "legacy AI evidence wording must be removed");
  assert(!source.includes("$10"), "legacy $10/month pricing must be removed from landing page");
  assert(appPageSource.includes('price: "29.90"'), "JSON-LD must expose monthly Pro pricing");
  assert(appPageSource.includes('price: "79.90"'), "JSON-LD must expose quarterly Pro pricing");
  assert(!appPageSource.includes('price: "10.00"'), "legacy JSON-LD pricing must be removed");
  assert(!appPageSource.includes("PreloadTerminalData"), "landing route must not add a fourth client island");
  assert(
    !appPageSource.includes("AI decision cards") &&
      !appPageSource.includes("AI 气象证据链"),
    "landing metadata and JSON-LD must not advertise the removed AI decision-card positioning",
  );
}

function projectRoot() {
  return process.cwd();
}
