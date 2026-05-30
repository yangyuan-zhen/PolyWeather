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
  const appPageSource = fs.readFileSync(path.join(root, "app", "page.tsx"), "utf8");
  const pngPath = path.join(root, "public", "static", "web.png");
  const webpPath = path.join(root, "public", "static", "web.webp");

  assert(source.includes("3 天免费试用"), "landing page must advertise the 3-day trial");
  assert(source.includes("试用期权益和 Pro 一致，除了不显示付费 Telegram 群链接"), "landing page must state trial access matches Pro except the paid group link");
  assert(!source.includes("高频刷新与 API 仍为 Pro 权益"), "landing page must not incorrectly exclude high-frequency refresh or API from trial access");
  assert(source.includes("bg-[#fbfbfa]"), "landing page must use a light Notion-style background");
  assert(source.includes("WeatherWorkflowIllustration"), "landing page must include a friendly illustration surface");
  assert(fs.existsSync(webpPath), "landing page must ship a WebP preview image for the LCP product screenshot");
  assert(
    fs.statSync(webpPath).size < fs.statSync(pngPath).size * 0.65,
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
    source.includes('trackAppEvent("landing_view"') &&
      source.includes('trackAppEvent("login_start"') &&
      source.includes('trackAppEvent("enter_terminal"'),
    "landing page must emit the top-of-funnel analytics events",
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
}

function projectRoot() {
  return process.cwd();
}
