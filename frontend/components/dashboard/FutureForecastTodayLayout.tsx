"use client";

import type { MarketScan, CityDetail } from "@/lib/dashboard-types";
import type { FuturePaceSignalItem } from "./FutureForecastTodayCards";
import { FutureForecastTodayEvidenceGrid } from "./FutureForecastTodayEvidenceGrid";
import {
  FutureModelForecastPanel,
  FutureProbabilityPanel,
  FutureTemperaturePathChart,
} from "./FutureForecastModalPanels";
import {
  FutureAnchorStatusCard,
  FuturePaceCard,
  FuturePaceLoadingCard,
} from "./FutureForecastTodayCards";

type Locale = string;

interface WeatherSummaryView {
  weatherIcon: string;
  weatherText: string;
}

interface DaylightProgressView {
  phase: string;
  percent: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PaceView = any;

export interface FutureForecastTodayLayoutProps {
  locale: Locale;
  isToday: boolean;
  dateStr: string;
  detail: CityDetail;
  currentTempText: string;
  weatherSummary: WeatherSummaryView;
  daylightProgress: DaylightProgressView | null;
  topObservedTemp: number | string | null | undefined;
  gapToBaseBucket: number | null;
  pathStatus: string;
  showDeferredTodaySections: boolean;
  paceView: PaceView | null;
  paceSignalItems: FuturePaceSignalItem[];
  baseCaseBucket: string | undefined;
  upsideBucket: string | null | undefined;
  nextObservationTime: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  airportMetarAnchor: any;
  confirmationRules: string[];
  invalidationRules: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meteorologySignals: any[];
  modelSummary: string;
  probabilityTitle: string;
  probabilitySummary: string;
  activeMarketScan: MarketScan | null | undefined;
}

export function FutureForecastTodayLayout(props: FutureForecastTodayLayoutProps) {
  const {
    locale,
    isToday,
    dateStr,
    detail,
    currentTempText,
    weatherSummary,
    daylightProgress,
    topObservedTemp,
    gapToBaseBucket,
    pathStatus,
    showDeferredTodaySections,
    paceView,
    paceSignalItems,
    baseCaseBucket,
    upsideBucket,
    nextObservationTime,
    airportMetarAnchor,
    confirmationRules,
    invalidationRules,
    meteorologySignals,
    modelSummary,
    probabilityTitle,
    probabilitySummary,
    activeMarketScan,
  } = props;

  return (
    <div className="future-v2-layout">
      <aside className="future-v2-left">
        <FutureAnchorStatusCard
          locale={locale}
          currentTempText={currentTempText}
          weatherSummary={weatherSummary}
          obsTime={detail.current?.obs_time}
          topObservedTemp={topObservedTemp}
          tempSymbol={detail.temp_symbol}
          gapToBaseBucket={gapToBaseBucket}
          pathStatus={pathStatus}
        />

        {showDeferredTodaySections && paceView ? (
          <FuturePaceCard
            locale={locale}
            paceView={paceView}
            tempSymbol={detail.temp_symbol}
            signalItems={paceSignalItems}
          />
        ) : isToday ? (
          <FuturePaceLoadingCard locale={locale} />
        ) : null}
      </aside>

      <main className="future-v2-right">
        <section className="future-modal-section future-v2-main-chart">
          <div className="modal-section-heading">
            <div className="modal-section-kicker">
              {locale === "en-US" ? "Primary view" : "主视图"}
            </div>
            <h3>
              {locale === "en-US"
                ? "Today's temperature path (anchor obs + models)"
                : "今日气温路径（锚点观测 + 模型）"}
            </h3>
          </div>
          <FutureTemperaturePathChart dateStr={dateStr} forceToday={isToday} />
          <div className="future-v2-chart-thresholds">
            <span>
              {locale === "en-US" ? "Base" : "基准"} ·{" "}
              {baseCaseBucket || "--"}
            </span>
            <span>
              {locale === "en-US" ? "Upside" : "上修"} ·{" "}
              {upsideBucket || "--"}
            </span>
            <span>
              {locale === "en-US" ? "Invalidates at" : "失效观察"} ·{" "}
              {nextObservationTime}
            </span>
          </div>
        </section>

        <FutureForecastTodayEvidenceGrid
          airportMetarAnchor={airportMetarAnchor}
          confirmationRules={confirmationRules}
          invalidationRules={invalidationRules}
          locale={locale}
          meteorologySignals={meteorologySignals}
          modelSummary={modelSummary}
        />

        <div className="future-modal-grid">
          <section className="future-modal-section">
            <div className="modal-section-heading">
              <div className="modal-section-kicker">
                {locale === "en-US" ? "Probability read" : "概率判断"}
              </div>
              <h3>{probabilityTitle}</h3>
            </div>
            <div className="future-text-block" style={{ marginBottom: "12px" }}>
              {probabilitySummary}
            </div>
            <div style={{ position: "relative", minHeight: "120px" }}>
              <FutureProbabilityPanel
                detail={detail}
                targetDate={dateStr}
                marketScan={activeMarketScan}
                hideTitle
              />
            </div>
          </section>
          <section className="future-modal-section">
            <div className="modal-section-heading">
              <div className="modal-section-kicker">
                {locale === "en-US" ? "Model layer" : "模型层"}
              </div>
              <h3>
                {locale === "en-US"
                  ? "Model Range & Spread"
                  : "模型区间与分歧"}
              </h3>
            </div>
            <div className="future-text-block" style={{ marginBottom: "12px" }}>
              {modelSummary}
            </div>
            <FutureModelForecastPanel detail={detail} targetDate={dateStr} hideTitle />
          </section>
        </div>
      </main>
    </div>
  );
}
