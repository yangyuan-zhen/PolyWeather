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
      opsApiSource.includes("reason"),
    "ops API client must expose grantFeedbackReward with reason",
  );
  assert(
    feedbackPageSource.includes("rewardDrafts") &&
      feedbackPageSource.includes("handleRewardGrant") &&
      feedbackPageSource.includes("发放奖励") &&
      feedbackPageSource.includes("奖励原因") &&
      feedbackPageSource.includes("opsApi.grantFeedbackReward"),
    "ops feedback page must provide per-feedback reward grant controls",
  );
  assert(
    feedbackPageSource.includes("已发放") &&
      feedbackPageSource.includes("reward_points") &&
      feedbackPageSource.includes("reward_reason"),
    "ops feedback page must show existing feedback reward details",
  );
}
