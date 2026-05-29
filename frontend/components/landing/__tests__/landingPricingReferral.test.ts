import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const source = fs.readFileSync(
    path.join(projectRoot(), "components", "landing", "InstitutionalLandingPage.tsx"),
    "utf8",
  );

  assert(source.includes("3 天免费试用"), "landing page must advertise the 3-day trial");
  assert(source.includes("29.9") && source.includes("30 天"), "landing page must show monthly Pro pricing");
  assert(source.includes("79.9") && source.includes("90 天"), "landing page must show quarterly Pro pricing");
  assert(source.includes("26.9") && source.includes("+3 天 Pro"), "landing page must describe referral discount and reward");
  assert(!source.includes("$10"), "legacy $10/month pricing must be removed from landing page");
}

function projectRoot() {
  return process.cwd();
}
