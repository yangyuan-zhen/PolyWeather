import type { Metadata } from "next";
import { OpsDashboard } from "@/components/ops/OpsDashboard";
import { requireOpsAdmin } from "@/lib/ops-admin";

export const metadata: Metadata = {
  title: "PolyWeather Ops",
  description: "PolyWeather lightweight operations dashboard.",
};

export default async function OpsPage() {
  await requireOpsAdmin("/ops");
  return <OpsDashboard />;
}
