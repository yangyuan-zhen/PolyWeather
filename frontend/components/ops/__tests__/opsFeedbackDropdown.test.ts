import fs from "node:fs";
import path from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const feedbackPagePath = path.join(
    projectRoot,
    "components",
    "ops",
    "feedback",
    "FeedbackPageClient.tsx",
  );
  const source = fs.readFileSync(feedbackPagePath, "utf8");

  assert(
    source.includes("<select") &&
      source.includes("onChange={(event) =>") &&
      source.includes("changeStatus(row, event.target.value)") &&
      source.includes("disabled={updatingId === row.id}") &&
      source.includes("STATUS_UPDATE_OPTIONS.map"),
    "ops feedback action column must use a status dropdown",
  );
  assert(
    !source.includes("标为{feedbackActionLabel(row.status)}") &&
      !source.includes("advanceStatus(row)"),
    "ops feedback action column must not use one-step status buttons",
  );
  assert(
    source.includes("积分奖励标准") &&
      source.includes("REWARD_GUIDELINES") &&
      source.includes("100") &&
      source.includes("300") &&
      source.includes("500") &&
      source.includes("1000") &&
      source.includes("1500"),
    "ops feedback page must document fixed reward point guidelines",
  );
  assert(
    source.includes("feedbackFreshnessBadges") &&
      source.includes("freshness?.live_path") &&
      source.includes("freshness?.live_age_sec") &&
      source.includes("sse_server_to_client_latency_sec") &&
      source.includes("sse_collector_to_client_latency_sec") &&
      source.includes("sse_source_to_collector_latency_sec") &&
      source.includes("detail_batch_diagnostics") &&
      source.includes("partial_reason"),
    "ops feedback page must summarize live freshness, SSE latency and detail-batch diagnostics",
  );
}
