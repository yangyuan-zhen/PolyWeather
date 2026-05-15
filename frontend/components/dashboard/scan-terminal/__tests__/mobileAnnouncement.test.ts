import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const dashboardPath = path.join(
    projectRoot,
    "components",
    "dashboard",
    "ScanTerminalDashboard.tsx",
  );
  const source = fs.readFileSync(dashboardPath, "utf8");

  assert(
    source.includes("isMobileViewport") &&
      source.includes("showAnnouncement && !isMobileViewport"),
    "scan upgrade announcement must not render on mobile viewports",
  );
}
