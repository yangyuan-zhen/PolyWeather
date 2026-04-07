"use client";

import dynamic from "next/dynamic";
import { DashboardShellSkeleton } from "@/components/dashboard/DashboardShellSkeleton";

const PolyWeatherDashboard = dynamic(
  () =>
    import("@/components/dashboard/PolyWeatherDashboard").then(
      (module) => module.PolyWeatherDashboard,
    ),
  {
    ssr: false,
    loading: () => <DashboardShellSkeleton />,
  },
);

export function DashboardEntry() {
  return <PolyWeatherDashboard />;
}
