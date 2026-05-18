import type { Metadata } from "next";
import { requireOpsAdmin } from "@/lib/ops-admin";
import { AnalyticsPageClient } from "@/components/ops/analytics/AnalyticsPageClient";

export const metadata: Metadata = { title: "转化分析 — PolyWeather Ops" };

export default async function AnalyticsPage() {
  await requireOpsAdmin("/ops/analytics");
  return <AnalyticsPageClient />;
}
