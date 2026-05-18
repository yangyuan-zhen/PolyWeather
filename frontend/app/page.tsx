import type { Metadata } from "next";
import { DashboardEntry } from "@/components/dashboard/DashboardEntry";

export const metadata: Metadata = {
  title: "PolyWeather - Global Weather Intelligence Map",
  description:
    "PolyWeather dashboard with METAR, MGM, DEB fusion forecast, multi-model comparison, and AI weather decision cards.",
};

export default function HomePage() {
  return <DashboardEntry />;
}
