import type { Metadata } from "next";
import { DashboardEntry } from "@/components/dashboard/DashboardEntry";

export const metadata: Metadata = {
  title: "PolyWeather - 天气衍生品智能地图",
  description:
    "PolyWeather 天气衍生品智能地图，聚合 METAR、MGM、DEB、多模型预报与历史对账分析。",
};

export default function HomePage() {
  return <DashboardEntry />;
}
