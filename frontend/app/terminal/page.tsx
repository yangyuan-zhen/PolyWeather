import type { Metadata } from "next";
import { ScanTerminalDashboard } from "@/components/dashboard/ScanTerminalDashboard";

export const metadata: Metadata = {
  title: "PolyWeather Terminal | Paid Product",
  description:
    "Paid PolyWeather decision terminal for weather-market analysis and city decision cards.",
};

export default function TerminalPage() {
  return <ScanTerminalDashboard />;
}
