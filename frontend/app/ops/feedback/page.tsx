import type { Metadata } from "next";
import { requireOpsAdmin } from "@/lib/ops-admin";
import { FeedbackPageClient } from "@/components/ops/feedback/FeedbackPageClient";

export const metadata: Metadata = { title: "用户反馈 — PolyWeather Ops" };

export default async function OpsFeedbackPage() {
  await requireOpsAdmin("/ops/feedback");
  return <FeedbackPageClient />;
}
