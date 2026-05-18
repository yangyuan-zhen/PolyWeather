import type { Metadata } from "next";
import { requireOpsAdmin } from "@/lib/ops-admin";
import { LogsPageClient } from "@/components/ops/view-logs/LogsPageClient";

export const metadata: Metadata = { title: "日志查看 — PolyWeather Ops" };

export default async function LogsPage() {
  await requireOpsAdmin("/ops/view-logs");
  return <LogsPageClient />;
}
