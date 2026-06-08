import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const feedbackPageSource = fs.readFileSync(
    path.join(projectRoot, "components", "ops", "feedback", "FeedbackPageClient.tsx"),
    "utf8",
  );
  const opsApiSource = fs.readFileSync(path.join(projectRoot, "lib", "ops-api.ts"), "utf8");
  const rewardRoutePath = path.join(
    projectRoot,
    "app",
    "api",
    "ops",
    "feedback",
    "[feedbackId]",
    "reward",
    "route.ts",
  );

  assert(fs.existsSync(rewardRoutePath), "ops feedback reward proxy route must exist");
  assert(
    opsApiSource.includes("grantFeedbackReward") &&
      opsApiSource.includes("/api/ops/feedback/${feedbackId}/reward") &&
      opsApiSource.includes("JSON.stringify({ points })"),
    "ops API client must expose grantFeedbackReward with fixed points only",
  );
  assert(
    feedbackPageSource.includes("REWARD_POINT_OPTIONS") &&
      feedbackPageSource.includes("handleRewardGrant") &&
      feedbackPageSource.includes("发放奖励") &&
      feedbackPageSource.includes("opsApi.grantFeedbackReward"),
    "ops feedback page must provide fixed-point reward grant controls",
  );
  assert(
    feedbackPageSource.includes('value: 100') &&
      feedbackPageSource.includes('value: 300') &&
      feedbackPageSource.includes('value: 500') &&
      feedbackPageSource.includes('value: 1000') &&
      feedbackPageSource.includes('value: 1500'),
    "ops feedback page must use fixed reward point options",
  );
  assert(
    !feedbackPageSource.includes("奖励原因") &&
      !feedbackPageSource.includes("rewardDrafts") &&
      !feedbackPageSource.includes("reason:"),
    "ops feedback page must not ask operators for reward reasons",
  );
  assert(
    feedbackPageSource.includes("已发放") &&
      feedbackPageSource.includes("reward_points"),
    "ops feedback page must show existing feedback reward details",
  );
}
