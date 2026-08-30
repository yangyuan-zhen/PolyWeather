import fs from "node:fs";
import path from "node:path";
import { buildTrialValueReplaySummary } from "@/lib/trial-value-replay";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const replayPath = path.join(projectRoot, "lib", "trial-value-replay.ts");
  const accountCenter = fs.readFileSync(
    path.join(projectRoot, "components", "account", "AccountCenter.tsx"),
    "utf8",
  );
  const dashboardSource = fs.readFileSync(
    path.join(projectRoot, "components", "dashboard", "ScanTerminalDashboard.tsx"),
    "utf8",
  );

  assert(fs.existsSync(replayPath), "trial value replay helper must exist");
  const replaySource = fs.readFileSync(replayPath, "utf8");
  const accountReplaySurface = `${accountCenter}\n${replaySource}`;

  assert(
    replaySource.includes("TRIAL_VALUE_REPLAY_STORAGE_KEY") &&
      replaySource.includes("recordTrialValueReplay") &&
      replaySource.includes("readTrialValueReplay") &&
      replaySource.includes("buildTrialValueReplaySummary"),
    "trial value replay must persist and summarize local trial usage evidence",
  );

  assert(
    dashboardSource.includes("recordTrialValueReplay") &&
      dashboardSource.includes("isTrialTerminalAccess") &&
      dashboardSource.includes("selectedRow"),
    "terminal trial users must record real terminal usage for later value replay",
  );

  assert(
    accountCenter.includes("buildTrialValueReplaySummary") &&
      accountCenter.includes("trialValueReplay") &&
      accountReplaySurface.includes("你本次试用已经") &&
      accountReplaySurface.includes("保持访问") &&
      accountReplaySurface.includes("Keep access"),
    "account trial upgrade trigger must replay the user's own trial value before opening checkout",
  );

  assert(
    accountCenter.includes('trackAppEvent("paywall_feature_clicked"') &&
      accountCenter.includes('feature: "trial_value_replay_upgrade"'),
    "trial value replay upgrade CTA must be tracked before checkout opens",
  );

  const zhSummary = buildTrialValueReplaySummary(
    {
      firstActiveAt: "2026-06-09T00:00:00.000Z",
      lastActiveAt: "2026-06-09T00:20:00.000Z",
      lastCityName: "Taipei",
      lastSignalLabel: "Hot",
      lastUserId: "user-1",
      terminalVisits: 2,
      rowsAvailableMax: 50,
      signalsViewed: 2,
      citiesViewed: ["Taipei", "New York"],
    },
    { isEn: false },
  );

  assert(
    zhSummary.headline === "你本次试用已经查看 2 个天气信号。" &&
      zhSummary.bullets.includes("已记录 2 次终端使用。") &&
      zhSummary.bullets.includes("Pro 终端本次提供了 50 个城市机会。") &&
      zhSummary.primaryCta === "保持访问",
    "trial value replay summary must turn usage evidence into concrete upgrade copy",
  );

  const expirySummary = buildTrialValueReplaySummary(
    {
      firstActiveAt: null,
      lastActiveAt: null,
      lastCityName: null,
      lastSignalLabel: null,
      lastUserId: null,
      terminalVisits: 0,
      rowsAvailableMax: 0,
      signalsViewed: 0,
      citiesViewed: [],
    },
    { isEn: false, trialExpiresAt: "2099-01-01T00:00:00.000Z" },
  );
  assert(
    expirySummary.bullets.some((bullet) => bullet.includes("试用剩余")),
    "trial value replay summary must include trial time remaining when expiry is known",
  );
}
