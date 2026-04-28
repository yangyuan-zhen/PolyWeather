import type { CityDetail } from "@/lib/dashboard-types";
import type { Locale } from "@/lib/i18n";
import {
  hmToMinutes,
  interpolateSeriesAtMinutes,
  normalizeHm,
} from "@/lib/time-utils";

function isEnglish(locale: Locale) {
  return locale === "en-US";
}

export function getTodayPaceView(
  detail: CityDetail,
  locale: Locale = "zh-CN",
) {
  const hourly = detail.hourly || {};
  const times = hourly.times || [];
  const temps = hourly.temps || [];
  if (!times.length || !temps.length) return null;

  const currentMinutes =
    hmToMinutes(detail.local_time) ??
    hmToMinutes(detail.airport_primary?.obs_time) ??
    hmToMinutes(detail.airport_current?.obs_time) ??
    hmToMinutes(detail.current?.obs_time);
  if (currentMinutes == null) return null;

  const omHigh = Number(detail.forecast?.today_high);
  const debHigh = Number(detail.deb?.prediction);
  const useDebOffset = Number.isFinite(omHigh) && Number.isFinite(debHigh);
  const offset = useDebOffset ? debHigh - omHigh : 0;
  const expectedSeries = temps.map((temp) =>
    temp != null && Number.isFinite(Number(temp))
      ? Number((Number(temp) + offset).toFixed(1))
      : null,
  );
  const expectedNow = interpolateSeriesAtMinutes(times, expectedSeries, currentMinutes);
  if (expectedNow == null) return null;

  const observedNowCandidate = [
    detail.airport_primary?.temp,
    detail.airport_current?.temp,
    detail.current?.temp,
  ]
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value));
  if (observedNowCandidate == null) return null;
  const observedNow = Number(observedNowCandidate);

  const delta = Number((observedNow - expectedNow).toFixed(1));
  const biasMagnitude = Math.abs(delta);
  const biasTone =
    delta >= 0.6 ? "warm" : delta <= -0.6 ? "cold" : "neutral";
  const badge =
    biasTone === "warm"
      ? isEnglish(locale)
        ? "Running hot"
        : "跑得偏热"
      : biasTone === "cold"
        ? isEnglish(locale)
          ? "Running cool"
          : "跑得偏冷"
        : isEnglish(locale)
          ? "On track"
          : "基本跟踪";
  const kicker = isEnglish(locale)
    ? `As of ${normalizeHm(detail.local_time) || detail.local_time || "--:--"}`
    : `截至 ${normalizeHm(detail.local_time) || detail.local_time || "--:--"}`;
  const deltaText =
    delta === 0
      ? isEnglish(locale)
        ? "0.0°C vs expected"
        : "0.0°C 相对预期"
      : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}${detail.temp_symbol}`;

  const topObservedCandidate = [
    detail.airport_primary?.max_so_far,
    detail.airport_current?.max_so_far,
    detail.current?.max_so_far,
    observedNow,
  ]
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value));
  const topObserved = topObservedCandidate != null ? Number(topObservedCandidate) : null;
  const projectedBase = Number.isFinite(debHigh)
    ? debHigh
    : Number.isFinite(omHigh)
      ? omHigh
      : null;
  const paceAdjustedHigh =
    projectedBase != null
      ? Number(
          Math.max(projectedBase + delta, topObserved ?? projectedBase).toFixed(1),
        )
      : topObserved;
  const paceAdjustedLabel = isEnglish(locale)
    ? "Pace-adjusted high"
    : "节奏修正高点";
  const peakWindowText =
    Number.isFinite(Number(detail.peak?.first_h)) &&
    Number.isFinite(Number(detail.peak?.last_h))
      ? `${String(Number(detail.peak?.first_h)).padStart(2, "0")}:00-${String(
          Number(detail.peak?.last_h) + 1,
        ).padStart(2, "0")}:00`
      : "--";
  const observedLabel =
    detail.airport_primary?.temp != null || detail.airport_current?.temp != null
      ? isEnglish(locale)
        ? "Airport obs"
        : "机场实测"
      : isEnglish(locale)
        ? "Current obs"
        : "当前实测";

  const paceSummary =
    biasTone === "warm"
      ? isEnglish(locale)
        ? `The airport anchor is ${biasMagnitude.toFixed(1)}°C above the intraday curve. If that bias survives into the peak window, the day high is more likely to lean hotter than the current DEB path.`
        : `机场主站当前比盘中曲线高 ${biasMagnitude.toFixed(1)}°C。若这段偏热节奏延续进峰值窗口，日高更容易落在当前 DEB 路径之上。`
      : biasTone === "cold"
        ? isEnglish(locale)
          ? `The airport anchor is ${biasMagnitude.toFixed(1)}°C below the intraday curve. If that drag survives into the peak window, chasing higher buckets becomes harder.`
          : `机场主站当前比盘中曲线低 ${biasMagnitude.toFixed(1)}°C。若这段偏冷节奏延续进峰值窗口，继续追更高温区间会更吃力。`
        : isEnglish(locale)
          ? "The airport anchor is still tracking the intraday curve. Let later pace and peak-window structure decide."
          : "机场主站当前仍基本贴着盘中曲线运行，后续主要看峰值窗口内的节奏有没有进一步偏离。";

  const clamped = Math.min(Math.max(delta, -4), 4);
  const meterLeft =
    biasTone === "neutral"
      ? 46
      : clamped >= 0
        ? 50
        : 50 - (Math.abs(clamped) / 4) * 50;
  const meterWidth =
    biasTone === "neutral" ? 8 : Math.max((Math.abs(clamped) / 4) * 50, 8);

  return {
    badge,
    biasTone,
    delta,
    deltaText,
    expectedNow,
    kicker,
    meterLeft,
    meterWidth,
    observedLabel,
    observedNow,
    paceAdjustedHigh,
    paceAdjustedLabel,
    peakWindowText,
    summary: paceSummary,
    topObserved,
  };
}
