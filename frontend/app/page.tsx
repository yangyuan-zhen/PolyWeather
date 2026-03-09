import type { Metadata } from "next";
import { DashboardEntry } from "@/components/dashboard/DashboardEntry";

export const metadata: Metadata = {
  title: "PolyWeather - Global Weather Intelligence Map",
  description:
    "PolyWeather dashboard with METAR, MGM, DEB fusion forecast, multi-model comparison, and history reconciliation.",
};

export default function HomePage() {
  return <DashboardEntry />;
}
