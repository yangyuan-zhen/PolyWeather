import type { Metadata } from "next";
import { requireOpsAdmin } from "@/lib/ops-admin";
import { OverviewPageClient } from "@/components/ops/overview/OverviewPageClient";

export const metadata: Metadata = { title: "总览 — PolyWeather Ops" };

export default async function OverviewPage() {
  await requireOpsAdmin("/ops/overview");
  return <OverviewPageClient />;
}
