import type { Metadata } from "next";
import { ProbabilityHubPage } from "@/components/probability-hub/ProbabilityHubPage";

export const metadata: Metadata = {
  title: "PolyWeather - 概率判断总览",
  description: "集中查看 52 个城市的 EMOS 概率判断与市场合约桶对比。",
};

export default function ProbabilitiesPage() {
  return <ProbabilityHubPage />;
}
