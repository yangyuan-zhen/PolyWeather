import clsx from "clsx";
import type { CSSProperties } from "react";
import type { getTodayPaceView } from "@/lib/pace-utils";
import { WeatherIcon } from "./FutureForecastModalWeatherIcon";

type Locale = string;
type TodayPaceView = NonNullable<ReturnType<typeof getTodayPaceView>>;

type WeatherSummaryView = {
  weatherIcon: string;
  weatherText: string;
};

type DaylightProgressView = {
  phase: string;
  percent: number;
};

export type FuturePaceSignalItem = {
  label: string;
  tone: "cyan" | "blue" | "amber";
  status: string;
  value: string;
  note: string;
};

export function FutureAnchorStatusCard({
  locale,
  currentTempText,
  weatherSummary,
  obsTime,
  topObservedTemp,
  tempSymbol,
  gapToBaseBucket,
  pathStatus,
}: {
  locale: Locale;
  currentTempText: string;
  weatherSummary: WeatherSummaryView;
  obsTime?: string | null;
  topObservedTemp: number | string | null | undefined;
  tempSymbol: string;
  gapToBaseBucket: number | null;
  pathStatus: string;
}) {
  const observedHigh = topObservedTemp ?? "--";

  return (
    <section className="future-v2-card future-v2-hero-card">
      <div className="future-v2-card-head">
        <h3 className="future-v2-hero-title">
          {locale === "en-US" ? "Anchor Status" : "锚点状态"}
        </h3>
        <div className="future-v2-card-kicker">
          {locale === "en-US"
            ? "Settlement anchor and current clock"
            : "结算锚点与当前时钟"}
        </div>
      </div>
      <div className="future-v2-hero-main">
        <div className="future-v2-hero-temp">{currentTempText}</div>
        <div className="future-v2-hero-divider" />
        <div className="future-v2-hero-weather">
          <span className="future-v2-hero-icon">
            <WeatherIcon emoji={weatherSummary.weatherIcon} size={42} />
          </span>
          <span>{weatherSummary.weatherText}</span>
        </div>
      </div>
      <div className="future-v2-hero-obs">@{obsTime || "--"}</div>
      <div className="future-v2-mini-grid">
        <FutureMiniMetric
          label={locale === "en-US" ? "High so far" : "日内已见高点"}
          value={`${observedHigh}${tempSymbol}`}
        />
        <FutureMiniMetric
          label={locale === "en-US" ? "Anchor clock" : "锚点时钟"}
          value={obsTime || "--"}
        />
        <FutureMiniMetric
          label={locale === "en-US" ? "Gap to base" : "距基准档"}
          value={
            gapToBaseBucket != null
              ? `${gapToBaseBucket.toFixed(1)}${tempSymbol}`
              : "--"
          }
        />
        <FutureMiniMetric
          label={locale === "en-US" ? "Path state" : "路径状态"}
          value={pathStatus}
        />
      </div>
    </section>
  );
}

export function FuturePaceCard({
  locale,
  paceView,
  tempSymbol,
  signalItems,
}: {
  locale: Locale;
  paceView: TodayPaceView;
  tempSymbol: string;
  signalItems: FuturePaceSignalItem[];
}) {
  return (
    <section className="future-v2-card future-v2-pace-card future-v2-focus-card">
      <div className="future-v2-card-head">
        <h4 className="future-v2-card-title">
          {locale === "en-US" ? "Current Pace" : "当前节奏"}
        </h4>
        <div className="future-v2-card-kicker">
          {locale === "en-US"
            ? "Expected now vs airport anchor"
            : "此刻应到 vs 机场锚点"}
        </div>
      </div>
      <div className="future-v2-pace-head">
        <span className="future-v2-pace-kicker">{paceView.kicker}</span>
        <FutureSignalTag tone={paceView.biasTone}>{paceView.badge}</FutureSignalTag>
      </div>
      <div
        className={clsx(
          "future-v2-pace-delta",
          paceView.biasTone === "cold" && "cold",
          paceView.biasTone === "neutral" && "neutral",
          paceView.biasTone === "warm" && "warm",
        )}
      >
        {paceView.deltaText}
      </div>
      <div className="future-v2-pace-summary">{paceView.summary}</div>
      <div className="future-v2-pace-meter">
        <span className="future-v2-pace-meter-midline" />
        <span
          className={clsx(
            "future-v2-pace-meter-fill",
            paceView.biasTone === "cold" && "cold",
            paceView.biasTone === "neutral" && "neutral",
            paceView.biasTone === "warm" && "warm",
          )}
          style={
            {
              "--pace-left": `${paceView.meterLeft}%`,
              "--pace-width": `${paceView.meterWidth}%`,
            } as CSSProperties & {
              "--pace-left": string;
              "--pace-width": string;
            }
          }
        />
      </div>
      <div className="future-v2-mini-grid future-v2-mini-grid-tight">
        <FutureMiniMetric
          label={locale === "en-US" ? "Expected now" : "预期此刻"}
          value={`${paceView.expectedNow.toFixed(1)}${tempSymbol}`}
        />
        <FutureMiniMetric
          label={paceView.observedLabel}
          value={`${paceView.observedNow.toFixed(1)}${tempSymbol}`}
        />
        <FutureMiniMetric
          label={paceView.paceAdjustedLabel}
          value={
            paceView.paceAdjustedHigh != null
              ? `${paceView.paceAdjustedHigh.toFixed(1)}${tempSymbol}`
              : "--"
          }
        />
        <FutureMiniMetric
          label={locale === "en-US" ? "Peak window" : "峰值窗口"}
          value={paceView.peakWindowText}
        />
      </div>
      {signalItems.length ? (
        <div className="future-v2-pace-signal-grid">
          {signalItems.map((item) => (
            <div key={item.label} className="future-v2-pace-signal-card">
              <div className="future-v2-signal-head">
                <span>{item.label}</span>
                <FutureSignalTag tone={item.tone}>{item.status}</FutureSignalTag>
              </div>
              <strong>{item.value}</strong>
              <div className="future-v2-pace-signal-note">{item.note}</div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function FuturePaceLoadingCard({ locale }: { locale: Locale }) {
  return (
    <section className="future-v2-card future-v2-support-card">
      <div className="future-v2-card-head">
        <h4 className="future-v2-card-title">
          {locale === "en-US" ? "Current Pace" : "当前节奏"}
        </h4>
        <div className="future-v2-card-kicker">
          {locale === "en-US"
            ? "Backfilling intraday pace context"
            : "正在补齐日内节奏上下文"}
        </div>
      </div>
      <div className="future-trend-summary future-trend-summary-muted">
        {locale === "en-US"
          ? "Expected-now pace, boundary risk, and airport-vs-network cues are loading in the background."
          : "预期此刻节奏、边界风险和机场对比站网信号正在后台补齐。"}
      </div>
    </section>
  );
}

function FutureMiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="future-v2-mini-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FutureSignalTag({
  tone,
  children,
}: {
  tone: string;
  children: string;
}) {
  return (
    <em
      className={clsx(
        "future-v2-signal-tag",
        (tone === "cold" || tone === "cyan") && "cyan",
        (tone === "neutral" || tone === "blue") && "blue",
        (tone === "warm" || tone === "amber") && "amber",
      )}
    >
      {children}
    </em>
  );
}
