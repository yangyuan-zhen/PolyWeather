import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const bannerPath = path.join(
    projectRoot,
    "components",
    "dashboard",
    "scan-terminal",
    "MarketOverviewBanner.tsx",
  );
  const source = fs.readFileSync(bannerPath, "utf8");

  assert(
    !source.includes("AI Overview") &&
      !source.includes("AI 概览") &&
      !source.includes("styles.badge"),
    "market overview banner should not render the AI overview badge",
  );
}
