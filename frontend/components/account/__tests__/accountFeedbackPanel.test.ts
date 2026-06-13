import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const accountDir = path.join(projectRoot, "components", "account");
  const accountCenterSource = fs.readFileSync(
    path.join(accountDir, "AccountCenter.tsx"),
    "utf8",
  );
  const feedbackPanelPath = path.join(accountDir, "AccountFeedbackPanel.tsx");

  assert(fs.existsSync(feedbackPanelPath), "account center must ship a My Feedback panel component");

  const feedbackPanelSource = fs.readFileSync(feedbackPanelPath, "utf8");
  assert(
    accountCenterSource.includes('import { AccountFeedbackPanel } from "./AccountFeedbackPanel";') &&
      accountCenterSource.includes("<AccountFeedbackPanel") &&
      accountCenterSource.includes("accountFeedbackTitle"),
    "account center must mount the My Feedback panel with localized account copy",
  );
  assert(
    feedbackPanelSource.includes("/api/feedback?limit=10") &&
      feedbackPanelSource.includes("feedbackStatusLabel") &&
      feedbackPanelSource.includes("RefreshCw") &&
      feedbackPanelSource.includes("useEffect") &&
      !feedbackPanelSource.includes("setInterval"),
    "account feedback panel must load the current user's feedback once, support manual refresh, and avoid polling",
  );
  const sessionLookupIndex = feedbackPanelSource.indexOf(".auth.getSession()");
  const feedbackFetchIndex = feedbackPanelSource.indexOf("/api/feedback?limit=10");
  assert(
    feedbackPanelSource.includes("getSupabaseBrowserClient") &&
      feedbackPanelSource.includes("hasSupabasePublicEnv") &&
      sessionLookupIndex >= 0 &&
      feedbackFetchIndex >= 0 &&
      sessionLookupIndex < feedbackFetchIndex &&
      feedbackPanelSource.includes("accessToken") &&
      feedbackPanelSource.includes("Authorization: `Bearer ${accessToken}`") &&
      feedbackPanelSource.includes("if (!accessToken)") &&
      feedbackPanelSource.includes("setAvailable(false)"),
    "account feedback panel must avoid unauthenticated 401 requests by checking the browser session before fetching feedback",
  );
  assert(
    feedbackPanelSource.includes("reward_points") &&
      feedbackPanelSource.includes("reward_reason") &&
      feedbackPanelSource.includes("reward_status") &&
      feedbackPanelSource.includes("formatRewardPoints") &&
      feedbackPanelSource.includes("renderFeedbackReward") &&
      feedbackPanelSource.includes("奖励原因"),
    "account feedback panel must show per-feedback reward points and reward reasons",
  );
}
