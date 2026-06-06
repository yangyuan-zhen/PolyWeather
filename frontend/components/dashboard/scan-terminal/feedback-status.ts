import type { UserFeedbackEntry } from "@/types/ops";

export function feedbackStatusLabel(status: string | undefined, isEn: boolean) {
  const key = String(status || "open").toLowerCase();
  if (key === "triaged") return isEn ? "Confirmed" : "已确认";
  if (key === "investigating") return isEn ? "In progress" : "处理中";
  if (key === "resolved") return isEn ? "Resolved" : "已解决";
  if (key === "closed") return isEn ? "Closed" : "已关闭";
  return isEn ? "Received" : "已收到";
}

export function feedbackStatusTone(status: string | undefined) {
  const key = String(status || "open").toLowerCase();
  if (key === "triaged") return "border-amber-200 bg-amber-50 text-amber-700";
  if (key === "investigating") return "border-blue-200 bg-blue-50 text-blue-700";
  if (key === "resolved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (key === "closed") return "border-slate-200 bg-slate-50 text-slate-500";
  return "border-red-200 bg-red-50 text-red-700";
}

export function buildFeedbackNotificationKey(
  entry: Pick<UserFeedbackEntry, "id" | "status" | "updated_at" | "created_at">,
) {
  return [
    Number(entry.id || 0),
    String(entry.status || "open").toLowerCase(),
    String(entry.updated_at || entry.created_at || ""),
  ].join(":");
}

export function countUnseenFeedbackUpdates(
  entries: Array<
    Pick<UserFeedbackEntry, "id" | "status" | "updated_at" | "created_at">
  >,
  seenKeys: Set<string>,
) {
  return entries.reduce((count, entry) => {
    return count + (seenKeys.has(buildFeedbackNotificationKey(entry)) ? 0 : 1);
  }, 0);
}
