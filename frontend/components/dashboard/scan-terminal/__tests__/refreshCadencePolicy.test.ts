import fs from "node:fs";
import path from "node:path";
import {
  DASHBOARD_REFRESH_POLICY_MS,
  DASHBOARD_REFRESH_POLICY_SEC,
} from "@/lib/refresh-policy";
import { scanTerminalQueryPolicy } from "@/components/dashboard/scan-terminal/scan-terminal-client";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  assert(DASHBOARD_REFRESH_POLICY_MS.observation === 60_000, "observation layer should refresh every 60 seconds");
  assert(DASHBOARD_REFRESH_POLICY_MS.scanRows === 5 * 60_000, "region/city rows should refresh every 5 minutes");
  assert(DASHBOARD_REFRESH_POLICY_MS.marketOverview === 10 * 60_000, "market overview should refresh every 10 minutes");
  assert(DASHBOARD_REFRESH_POLICY_MS.model === 30 * 60_000, "DEB and multi-model data should refresh every 30 minutes");
  assert(DASHBOARD_REFRESH_POLICY_SEC.metar === 5 * 60, "METAR polling should be 5 minutes");
  assert(scanTerminalQueryPolicy.autoRefreshMs === DASHBOARD_REFRESH_POLICY_MS.scanRows, "scan terminal auto refresh should use the shared row cadence");

  const projectRoot = process.cwd();
  const querySource = fs.readFileSync(
    path.join(projectRoot, "components", "dashboard", "scan-terminal", "use-scan-terminal-query.ts"),
    "utf8",
  );
  const chartSource = fs.readFileSync(
    path.join(projectRoot, "components", "dashboard", "scan-terminal", "LiveTemperatureThresholdChart.tsx"),
    "utf8",
  );

  assert(
    querySource.includes("DASHBOARD_REFRESH_POLICY_MS.scanRows"),
    "scan list local cache should use the shared 5-minute row cadence",
  );
  assert(
    chartSource.includes("DASHBOARD_REFRESH_POLICY_MS.metar") &&
      !chartSource.includes("window.setInterval"),
    "selected city detail chart cache should align with 5-minute scan/metar cadence",
  );
  assert(
    chartSource.includes("setInterval(fetchLiveTemp, 60_000)"),
    "selected city chart should poll live temperature every 60 seconds via lightweight summary endpoint",
  );
  assert(
    chartSource.includes("_hourlyRequestCache") &&
      chartSource.includes("seedHourlyForecastFromRow") &&
      chartSource.includes("setHourly(seedHourlyForecastFromRow(row))"),
    "terminal charts should render from row data immediately and dedupe concurrent city detail requests",
  );
}
