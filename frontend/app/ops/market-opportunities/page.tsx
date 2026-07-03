import type { Metadata } from "next";
import { requireOpsAdmin } from "@/lib/ops-admin";
import { MarketOpportunitiesPageClient } from "@/components/ops/market-opportunities/MarketOpportunitiesPageClient";

export const metadata: Metadata = { title: "市场机会 — PolyWeather Ops" };

export default async function MarketOpportunitiesPage() {
  await requireOpsAdmin("/ops/market-opportunities");
  return <MarketOpportunitiesPageClient />;
}
