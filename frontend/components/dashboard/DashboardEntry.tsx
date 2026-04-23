"use client";

import dynamic from "next/dynamic";
import { DashboardShellSkeleton } from "@/components/dashboard/DashboardShellSkeleton";

const ScanTerminalDashboard = dynamic(
  () =>
    import("@/components/dashboard/ScanTerminalDashboard").then(
      (module) => module.ScanTerminalDashboard,
    ),
  {
    ssr: false,
    loading: () => <DashboardShellSkeleton />,
  },
);

export function DashboardEntry() {
  return <ScanTerminalDashboard />;
}
