"use client";

import type { useDashboardStore } from "@/hooks/useDashboardStore";
import type { useI18n } from "@/hooks/useI18n";
import type { getFutureModalView } from "@/lib/dashboard-utils";
import {
  FutureModelForecastPanel,
  FutureProbabilityPanel,
  FutureTemperaturePathChart,
} from "./FutureForecastModalPanels";

type DashboardDetail = NonNullable<
  ReturnType<typeof useDashboardStore>["selectedDetail"]
>;
type FutureModalView = ReturnType<typeof getFutureModalView>;
type TranslationFn = ReturnType<typeof useI18n>["t"];

export function FutureForecastForwardView({
  dateStr,
  detail,
  t,
  view,
}: {
  dateStr: string;
  detail: DashboardDetail;
  t: TranslationFn;
  view: FutureModalView;
}) {
  return (
    <>
      <div className="history-stats">
        <div className="h-stat-card">
          <span className="label">{t("future.targetForecast")}</span>
          <span className="val">
            {view.forecastEntry?.max_temp ?? "--"}
            {detail.temp_symbol}
          </span>
        </div>
        <div className="h-stat-card">
          <span className="label">{t("future.deb")}</span>
          <span className="val">
            {view.deb ?? "--"}
            {detail.temp_symbol}
          </span>
        </div>
        <div className="h-stat-card">
          <span className="label">{t("future.mu")}</span>
          <span className="val">
            {view.mu != null
              ? `${view.mu.toFixed(1)}${detail.temp_symbol}`
              : "--"}
          </span>
        </div>
        <div className="h-stat-card">
          <span className="label">{t("future.score")}</span>
          <span className="val">
            {view.front.score > 0 ? "+" : ""}
            {view.front.score}
          </span>
        </div>
      </div>

      <section className="future-modal-section">
        <h3>{t("future.targetTempTrend")}</h3>
        <FutureTemperaturePathChart dateStr={dateStr} forceToday={false} />
      </section>

      <div className="future-modal-grid">
        <section className="future-modal-section">
          <h3>{t("future.probability")}</h3>
          <FutureProbabilityPanel detail={detail} targetDate={dateStr} hideTitle />
        </section>
        <section className="future-modal-section">
          <h3>{t("future.models")}</h3>
          <FutureModelForecastPanel detail={detail} targetDate={dateStr} hideTitle />
        </section>
      </div>
    </>
  );
}
