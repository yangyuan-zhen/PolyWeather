"use client";

import dynamic from "next/dynamic";

const PolyWeatherDashboard = dynamic(
  () =>
    import("@/components/dashboard/PolyWeatherDashboard").then(
      (module) => module.PolyWeatherDashboard,
    ),
  {
    ssr: false,
  },
);

export function DashboardEntry() {
  return <PolyWeatherDashboard />;
}
