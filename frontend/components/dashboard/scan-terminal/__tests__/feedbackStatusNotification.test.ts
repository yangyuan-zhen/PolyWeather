import fs from "node:fs";
import path from "node:path";

import {
  buildFeedbackNotificationKey,
  countUnseenFeedbackUpdates,
  FEEDBACK_STATUS_CACHE_TTL_MS,
  FEEDBACK_STATUS_POLL_MS,
  feedbackStatusLabel,
} from "@/components/dashboard/scan-terminal/feedback-status";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function runTests() {
  const projectRoot = process.cwd();
  const statusButtonSource = fs.readFileSync(
    path.join(projectRoot, "components", "dashboard", "scan-terminal", "UserFeedbackStatusButton.tsx"),
    "utf8",
  );

  assert(FEEDBACK_STATUS_POLL_MS === 30 * 60 * 1000, "feedback bell background polling should run every 30 minutes");
  assert(FEEDBACK_STATUS_CACHE_TTL_MS === 10 * 60 * 1000, "feedback bell should reuse a 10 minute local status cache");
  assert(
    statusButtonSource.includes("FEEDBACK_STATUS_CACHE_KEY") &&
      statusButtonSource.includes("readFeedbackStatusCache") &&
      statusButtonSource.includes("writeFeedbackStatusCache") &&
      statusButtonSource.includes("lastLoadedAtRef") &&
      statusButtonSource.includes("FEEDBACK_STATUS_CACHE_TTL_MS"),
    "feedback status button must use a local cache and avoid refetching on every visibility resume",
  );
  assert(feedbackStatusLabel("open", false) === "已收到", "open feedback should read as received to users");
  assert(feedbackStatusLabel("triaged", false) === "已确认", "triaged feedback should read as confirmed to users");
  assert(feedbackStatusLabel("investigating", false) === "处理中", "investigating feedback should read as in progress");
  assert(feedbackStatusLabel("resolved", false) === "已解决", "resolved feedback should read as handled");
  assert(feedbackStatusLabel("closed", true) === "Closed", "closed feedback should have English copy");

  const firstVersion = {
    id: 7,
    status: "open",
    updated_at: "2026-06-06T10:00:00",
  };
  const handledVersion = {
    ...firstVersion,
    status: "resolved",
    updated_at: "2026-06-06T10:30:00",
  };
  const firstKey = buildFeedbackNotificationKey(firstVersion);
  const handledKey = buildFeedbackNotificationKey(handledVersion);

  assert(firstKey !== handledKey, "status and updated_at changes should create a new notification key");
  assert(
    countUnseenFeedbackUpdates([firstVersion, handledVersion], new Set([firstKey])) === 1,
    "already seen feedback versions should not count, but later handled versions should",
  );
  assert(
    countUnseenFeedbackUpdates([firstVersion, handledVersion], new Set([firstKey, handledKey])) === 0,
    "opening the status panel should be able to clear all visible feedback update badges",
  );
}
