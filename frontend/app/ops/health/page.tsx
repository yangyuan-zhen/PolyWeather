import type { Metadata } from "next";
import { requireOpsAdmin } from "@/lib/ops-admin";
import { HealthPageClient } from "@/components/ops/health/HealthPageClient";

export const metadata: Metadata = { title: "API 状态 — PolyWeather Ops" };

export default async function HealthPage() {
  await requireOpsAdmin("/ops/health");
  return <HealthPageClient />;
}
