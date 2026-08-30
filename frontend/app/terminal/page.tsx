import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { DashboardShellSkeleton } from "@/components/dashboard/DashboardShellSkeleton";

const ScanTerminalDashboard = dynamic(
  () =>
    import("@/components/dashboard/ScanTerminalDashboard").then(
      (mod) => mod.ScanTerminalDashboard,
    ),
  {
    loading: () => <DashboardShellSkeleton />,
  },
);

export const metadata: Metadata = {
  title: "PolyWeather Terminal | Paid Product",
  description:
    "Paid PolyWeather decision terminal for weather-signal analysis and multi-city chart monitoring.",
};

export default function TerminalPage() {
  return <ScanTerminalDashboard />;
}
