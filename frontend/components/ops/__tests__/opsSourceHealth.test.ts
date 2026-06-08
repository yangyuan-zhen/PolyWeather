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
  const collectorRoute = fs.readFileSync(
    path.join(projectRoot, "app", "api", "ops", "observation-collector-status", "route.ts"),
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
      systemPage.includes("延迟") &&
      systemPage.includes("sourceReasonLabel") &&
      systemPage.includes("观测时间缺失") &&
      systemPage.includes("formatOpsValue") &&
      systemPage.includes("强制刷新"),
    "ops system page must show readable source reasons, object values, and cache force-refresh metrics",
  );
  assert(
    nextRoute.includes("requireOpsProxyAuth") &&
      nextRoute.includes("/api/ops/source-health") &&
      nextRoute.includes("no-store"),
    "source health proxy must stay ops-admin protected and uncached",
  );
  assert(
    opsApi.includes("observationCollectorStatus") &&
      opsApi.includes("/api/ops/observation-collector-status"),
    "ops client must expose observation collector status endpoint",
  );
  assert(
    systemPage.includes("观测采集器") &&
      systemPage.includes("collectorStatus") &&
      systemPage.includes("failure_count") &&
      systemPage.includes("last_latency_ms") &&
      systemPage.includes("冷却"),
    "ops system page must show observation collector failures, latency, and cooldown status",
  );
  assert(
    collectorRoute.includes("requireOpsProxyAuth") &&
      collectorRoute.includes("/api/ops/observation-collector-status") &&
      collectorRoute.includes("no-store"),
    "observation collector proxy must stay ops-admin protected and uncached",
  );
}
