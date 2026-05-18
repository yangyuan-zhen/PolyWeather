import type { Metadata } from "next";
import { requireOpsAdmin } from "@/lib/ops-admin";
import { TrainingPageClient } from "@/components/ops/training/TrainingPageClient";

export const metadata: Metadata = { title: "训练数据 — PolyWeather Ops" };

export default async function TrainingPage() {
  await requireOpsAdmin("/ops/training");
  return <TrainingPageClient />;
}
