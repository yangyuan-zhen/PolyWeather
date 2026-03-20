import type { Metadata } from "next";
import { OpsDashboard } from "@/components/ops/OpsDashboard";

export const metadata: Metadata = {
  title: "PolyWeather Ops",
  description: "PolyWeather lightweight operations dashboard.",
};

export default function OpsPage() {
  return <OpsDashboard />;
}
