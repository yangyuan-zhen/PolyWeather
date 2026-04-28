"use client";

import dynamic from "next/dynamic";
import type { useDashboardStore } from "@/hooks/useDashboardStore";
import type { MarketScan } from "@/lib/dashboard-types";

const DailyTemperatureChart = dynamic(
  () =>
    import("./FutureForecastModalChart").then(
      (module) => module.DailyTemperatureChart,
    ),
  {
    loading: () => <div className="history-chart-wrapper future-chart-wrapper" />,
    ssr: false,
  },
);

const ProbabilityDistribution = dynamic(
  () =>
    import("@/components/dashboard/PanelSections").then(
      (module) => module.ProbabilityDistribution,
    ),
  {
    loading: () => <div className="future-v2-panel-loading" />,
    ssr: false,
  },
);

const ModelForecast = dynamic(
  () =>
    import("@/components/dashboard/PanelSections").then(
      (module) => module.ModelForecast,
    ),
  {
    loading: () => <div className="future-v2-panel-loading" />,
    ssr: false,
  },
);

type DashboardDetail = NonNullable<
  ReturnType<typeof useDashboardStore>["selectedDetail"]
>;

export function FutureTemperaturePathChart({
  dateStr,
  forceToday,
}: {
  dateStr: string;
  forceToday: boolean;
}) {
  return <DailyTemperatureChart dateStr={dateStr} forceToday={forceToday} />;
}

export function FutureProbabilityPanel({
  detail,
  targetDate,
  marketScan,
  hideTitle = true,
}: {
  detail: DashboardDetail;
  targetDate: string;
  marketScan?: MarketScan | null;
  hideTitle?: boolean;
}) {
  return (
    <ProbabilityDistribution
      detail={detail}
      targetDate={targetDate}
      marketScan={marketScan}
      hideTitle={hideTitle}
    />
  );
}

export function FutureModelForecastPanel({
  detail,
  targetDate,
  hideTitle = true,
}: {
  detail: DashboardDetail;
  targetDate: string;
  hideTitle?: boolean;
}) {
  return (
    <ModelForecast detail={detail} targetDate={targetDate} hideTitle={hideTitle} />
  );
}
