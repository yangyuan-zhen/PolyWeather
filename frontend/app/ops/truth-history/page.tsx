import type { Metadata } from "next";
import { TruthHistoryDashboard } from "@/components/ops/TruthHistoryDashboard";
import { requireOpsAdmin } from "@/lib/ops-admin";

export const metadata: Metadata = {
  title: "PolyWeather Truth History",
  description: "Admin truth history viewer for PolyWeather.",
};

export default async function TruthHistoryPage() {
  await requireOpsAdmin("/ops/truth-history");
  return <TruthHistoryDashboard />;
}
