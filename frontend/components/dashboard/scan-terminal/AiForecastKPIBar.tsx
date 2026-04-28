import type { CityDetail, ScanOpportunityRow } from "@/lib/dashboard-types";
import { getTodayPaceView } from "@/lib/pace-utils";
import { formatTemperatureValue } from "@/lib/temperature-utils";
import { getPeakWindowLabel } from "@/components/dashboard/scan-terminal/decision-utils";

export function AiForecastKPIBar({
  pinnedCount,
  activeCityName,
  activeDetail,
  activeRow,
  locale,
}: {
  pinnedCount: number;
  activeCityName?: string | null;
  activeDetail?: CityDetail | null;
  activeRow?: ScanOpportunityRow | null;
  locale: string;
}) {
  const isEn = locale === "en-US";
  const tempSymbol = activeDetail?.temp_symbol || activeRow?.temp_symbol || "°C";
  const displayName =
    activeDetail?.display_name ||
    activeRow?.city_display_name ||
    activeRow?.display_name ||
    activeCityName ||
    "--";
  const deb = activeDetail?.deb?.prediction ?? activeRow?.deb_prediction ?? null;
  const paceView = activeDetail
    ? getTodayPaceView(activeDetail, locale as "zh-CN" | "en-US")
    : null;
  const peakWindow =
    paceView?.peakWindowText ||
    (activeRow ? getPeakWindowLabel(activeRow) : null) ||
    "--";
  const cards = [
    {
      label: isEn ? "Decision Cards" : "决策卡",
      value: String(pinnedCount),
      note: isEn ? "Cities opened from opportunities or map" : "从机会榜或地图加入",
      tone: "green",
    },
    {
      label: isEn ? "Current City" : "当前城市",
      value: displayName,
      note: isEn ? "City briefing stays in the right rail" : "右侧城市简报同步显示，不自动切页",
      tone: "blue",
    },
    {
      label: isEn ? "Forecast Center" : "预测中枢",
      value:
        deb != null
          ? formatTemperatureValue(deb, tempSymbol, { digits: 1 })
          : "--",
      note: isEn ? "Weather center before price mapping" : "先定天气中枢，再映射价格",
      tone: "cyan",
    },
    {
      label: isEn ? "Peak Window" : "峰值窗口",
      value: peakWindow,
      note: isEn ? "Key window for daily high judgment" : "用于判断是否接近今日最高温",
      tone: "amber",
    },
  ];

  return (
    <section className="scan-kpi-bar">
      {cards.map((card) => (
        <article key={card.label} className={`scan-kpi-card ${card.tone}`}>
          <div className="scan-kpi-label">{card.label}</div>
          <div className="scan-kpi-value">{card.value}</div>
          <div className="scan-kpi-note">{card.note}</div>
        </article>
      ))}
    </section>
  );
}

