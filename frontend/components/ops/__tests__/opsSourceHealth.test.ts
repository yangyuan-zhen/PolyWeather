import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const opsApi = fs.readFileSync(path.join(projectRoot, "lib", "ops-api.ts"), "utf8");
  const systemPage = fs.readFileSync(
    path.join(projectRoot, "components", "ops", "system", "SystemPageClient.tsx"),
    "utf8",
  );
  const nextRoute = fs.readFileSync(
    path.join(projectRoot, "app", "api", "ops", "source-health", "route.ts"),
    "utf8",
  );

  assert(
    opsApi.includes("sourceHealth") &&
      opsApi.includes("/api/ops/source-health"),
    "ops client must expose the city source health endpoint",
  );
  assert(
    systemPage.includes("城市数据源健康") &&
      systemPage.includes("sourceHealth") &&
      systemPage.includes("MGM、KNMI、IMS") &&
      systemPage.includes("断线") &&
      systemPage.includes("延迟"),
    "ops system page must show source latency/disconnect status for operational city sources",
  );
  assert(
    nextRoute.includes("requireOpsProxyAuth") &&
      nextRoute.includes("/api/ops/source-health") &&
      nextRoute.includes("no-store"),
    "source health proxy must stay ops-admin protected and uncached",
  );
}
