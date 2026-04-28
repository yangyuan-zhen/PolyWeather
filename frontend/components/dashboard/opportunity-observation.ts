import type { CityDetail, ScanOpportunityRow } from "@/lib/dashboard-types";
import {
  formatTemperatureValue,
  normalizeTemperatureSymbol,
} from "@/lib/temperature-utils";
import {
  formatAirportReportRead,
  formatAirportWeatherRead,
} from "./opportunity-airport-read";
import { formatMinuteSpan } from "./opportunity-format";
import { getTargetRange } from "./opportunity-target";

export type ObservationPoint = { time?: string; temp?: number | null };

export function normalizeObservationPoints(points?: ObservationPoint[] | null) {
  if (!Array.isArray(points)) return [];
  return points
    .map((point) => ({
      time: String(point?.time || "").trim(),
      temp:
        point?.temp != null && Number.isFinite(Number(point.temp))
          ? Number(point.temp)
          : null,
    }))
    .filter((point): point is { time: string; temp: number } =>
      Boolean(point.time && point.temp != null),
    )
    .sort((a, b) => getObservationSortMinutes(a.time) - getObservationSortMinutes(b.time));
}

export function getObservationSortMinutes(time: string) {
  const parsed = Date.parse(time);
  if (Number.isFinite(parsed)) {
    const date = new Date(parsed);
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
  const match = time.match(/(\d{1,2}):(\d{2})/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatPeakWindowTiming(row: ScanOpportunityRow, locale: string) {
  const isEn = locale === "en-US";
  const phase = String(row.window_phase || "").toLowerCase();
  const label = String(row.peak_window_label || "").trim();
  const untilStart =
    row.minutes_until_peak_start != null && Number.isFinite(Number(row.minutes_until_peak_start))
      ? Number(row.minutes_until_peak_start)
      : null;
  const untilEnd =
    row.minutes_until_peak_end != null && Number.isFinite(Number(row.minutes_until_peak_end))
      ? Number(row.minutes_until_peak_end)
      : null;
  const windowText = label ? `${isEn ? "peak window" : "峰值窗口"} ${label}` : isEn ? "peak window" : "峰值窗口";
  if (phase === "active_peak" || (untilStart != null && untilStart <= 0 && untilEnd != null && untilEnd > 0)) {
    return isEn ? `Currently inside the ${windowText}.` : `当前已进入${windowText}。`;
  }
  if (phase === "post_peak" || (untilEnd != null && untilEnd <= 0)) {
    return isEn ? `The ${windowText} has passed.` : `${windowText}已结束。`;
  }
  if (untilStart != null && untilStart > 0) {
    return isEn
      ? `${windowText} starts in ${formatMinuteSpan(untilStart, locale)}.`
      : `${windowText}尚未开始，约 ${formatMinuteSpan(untilStart, locale)} 后进入。`;
  }
  if (phase === "early_today" || phase === "setup_today") {
    return isEn ? `Before the ${windowText}; latest METAR is not final peak evidence yet.` : `尚处峰值前，最新 METAR 还不能当作最终峰值证据。`;
  }
  return label ? (isEn ? `Reference ${windowText}.` : `参考${windowText}。`) : null;
}

export function firstNonEmptyPoints(...groups: Array<ReturnType<typeof normalizeObservationPoints>>) {
  return groups.find((group) => group.length > 0) || [];
}

export function getMetarObservationContext(
  row: ScanOpportunityRow,
  detail: CityDetail | null,
) {
  const context = row.metar_context || {};
  const metarToday = firstNonEmptyPoints(
    normalizeObservationPoints(context.today_obs),
    normalizeObservationPoints(row.metar_today_obs),
  );
  const detailMetarToday = normalizeObservationPoints(detail?.metar_today_obs);
  const metarRecent = firstNonEmptyPoints(
    normalizeObservationPoints(context.recent_obs),
    normalizeObservationPoints(row.metar_recent_obs),
  );
  const detailMetarRecent = normalizeObservationPoints(detail?.metar_recent_obs);
  const settlementToday = firstNonEmptyPoints(
    normalizeObservationPoints(context.settlement_today_obs),
    normalizeObservationPoints(row.settlement_today_obs),
  );
  const detailSettlementToday = normalizeObservationPoints(detail?.settlement_today_obs);

  const primaryPoints =
    metarToday.length
      ? metarToday
      : detailMetarToday.length
        ? detailMetarToday
        : metarRecent.length
          ? metarRecent
          : detailMetarRecent.length
            ? detailMetarRecent
            : settlementToday.length
              ? settlementToday
              : detailSettlementToday;
  const trendPoints =
    (metarRecent.length
      ? metarRecent
      : detailMetarRecent.length
        ? detailMetarRecent
        : primaryPoints.slice(-4));
  const explicitLast = context.last_temp ?? row.metar_status?.last_temp ?? detail?.metar_status?.last_temp;
  const lastPoint = primaryPoints[primaryPoints.length - 1] || null;
  const maxPoint = primaryPoints.reduce<{ time: string; temp: number } | null>(
    (best, point) => (!best || point.temp >= best.temp ? point : best),
    null,
  );
  const trendFirst = trendPoints[0] || null;
  const trendLast = trendPoints[trendPoints.length - 1] || null;
  const trendDelta =
    context.trend_delta != null && Number.isFinite(Number(context.trend_delta))
      ? Number(context.trend_delta)
      : trendFirst && trendLast && trendPoints.length >= 2
        ? trendLast.temp - trendFirst.temp
        : null;
  const lastTemp =
    explicitLast != null && Number.isFinite(Number(explicitLast))
      ? Number(explicitLast)
      : lastPoint?.temp ?? null;
  const maxTemp =
    context.max_temp != null && Number.isFinite(Number(context.max_temp))
      ? Number(context.max_temp)
      : maxPoint?.temp ?? null;
  const stale =
    context.stale_for_today === true ||
    row.metar_status?.stale_for_today === true ||
    detail?.metar_status?.stale_for_today === true;

  return {
    points: primaryPoints,
    lastTime: String(context.last_time || lastPoint?.time || ""),
    lastTemp,
    maxTime: String(context.max_time || maxPoint?.time || ""),
    maxTemp,
    trendDelta,
    stale,
    station: context.station || detail?.risk?.icao || detail?.airport_current?.station_code || null,
  };
}

export function getMetarGate(
  row: ScanOpportunityRow,
  detail: CityDetail | null,
  locale: string,
  tempSymbol?: string | null,
) {
  const isEn = locale === "en-US";
  const side = String(row.side || "").toLowerCase();
  const selectedDate = String(row.selected_date || "");
  const localDate = String(row.local_date || detail?.local_date || "");
  const futureContract = Boolean(selectedDate && localDate && selectedDate > localDate);
  if (futureContract) return null;

  const obs = getMetarObservationContext(row, detail);
  const evidence: string[] = [];
  const unit = normalizeTemperatureSymbol(tempSymbol);
  const peakTiming = formatPeakWindowTiming(row, locale);
  const airportReport = formatAirportReportRead(row, detail, locale, unit);
  const airportWeatherRead = formatAirportWeatherRead(row, detail, locale);
  if (peakTiming) evidence.push(peakTiming);
  if (airportReport) evidence.push(airportReport);
  if (airportWeatherRead) evidence.push(airportWeatherRead);
  if (obs.lastTemp != null) {
    evidence.push(
      `${isEn ? "METAR latest" : "METAR 最新"} ${formatTemperatureValue(obs.lastTemp, unit, { digits: 1 })}${obs.lastTime ? ` @ ${obs.lastTime}` : ""}`,
    );
  }
  if (obs.maxTemp != null) {
    evidence.push(
      `${isEn ? "METAR max" : "METAR 最高"} ${formatTemperatureValue(obs.maxTemp, unit, { digits: 1 })}${obs.maxTime ? ` @ ${obs.maxTime}` : ""}`,
    );
  }
  if (obs.trendDelta != null) {
    evidence.push(
      `${isEn ? "Recent METAR delta" : "近端 METAR 变化"} ${formatTemperatureValue(obs.trendDelta, unit, { digits: 1 })}`,
    );
  }
  if (obs.station) evidence.push(`${isEn ? "Station" : "站点"} ${obs.station}`);

  if (obs.stale || !obs.points.length || obs.maxTemp == null) {
    return {
      decision: "downgrade" as const,
      reason: isEn
        ? "AI has no same-day METAR confirmation yet, so this bucket remains forecast-only."
        : "AI 还没有拿到同日 METAR 确认，该桶暂时只能作为预测映射。",
      evidence,
    };
  }

  const { lower, upper } = getTargetRange(row);
  if (lower == null && upper == null) {
    return {
      decision: "watchlist" as const,
      reason: isEn
        ? "AI has METAR data, but the contract threshold cannot be mapped cleanly to a bucket."
        : "AI 已读取 METAR，但该合约阈值无法稳定映射到温度桶。",
      evidence,
    };
  }

  const epsilon = String(unit).toUpperCase().includes("F") ? 0.7 : 0.4;
  const trendDelta = obs.trendDelta;
  const isNotRising = trendDelta != null && trendDelta <= epsilon;
  const isFalling = trendDelta != null && trendDelta <= -epsilon;
  const phase = String(row.window_phase || "").toLowerCase();
  const remaining =
    row.remaining_window_minutes != null && Number.isFinite(Number(row.remaining_window_minutes))
      ? Number(row.remaining_window_minutes)
      : null;
  const minutesUntilPeakStart =
    row.minutes_until_peak_start != null && Number.isFinite(Number(row.minutes_until_peak_start))
      ? Number(row.minutes_until_peak_start)
      : null;
  const lateWindow =
    phase === "active_peak" ||
    phase === "post_peak" ||
    (remaining != null && remaining <= 180);
  const beforePeak =
    phase === "early_today" ||
    phase === "setup_today" ||
    phase === "tomorrow" ||
    phase === "week_ahead" ||
    (minutesUntilPeakStart != null && minutesUntilPeakStart > 0);
  const aboveUpper = upper != null && obs.maxTemp > upper + epsilon;
  const belowLower = lower != null && obs.maxTemp < lower - epsilon;
  const insideBucket =
    (lower == null || obs.maxTemp >= lower - epsilon) &&
    (upper == null || obs.maxTemp <= upper + epsilon);

  if (side === "no") {
    if (aboveUpper) {
      return {
        decision: "approve" as const,
        reason: isEn
          ? "METAR max has already moved above this bucket, so AI marks the NO bucket as observation-supported."
          : "METAR 实测最高已越过目标桶上沿，AI 判断 NO 桶有实测支撑。",
        evidence,
      };
    }
    if (belowLower && (lateWindow || isFalling || isNotRising)) {
      if (beforePeak && !lateWindow) {
        return {
          decision: "watchlist" as const,
          reason: isEn
            ? "The peak window has not arrived, so a still-low METAR path cannot confirm this NO bucket yet; AI keeps it on watch."
            : "峰值窗口尚未到来，METAR 暂未触达不能直接确认 NO 桶，AI 先列观察。",
          evidence,
        };
      }
      return {
        decision: "approve" as const,
        reason: isEn
          ? "METAR max remains below this bucket and recent observations are not strengthening, so AI favors the NO bucket."
          : "METAR 最高仍低于目标桶且近期走势不强，AI 倾向 NO 桶。",
        evidence,
      };
    }
    if (insideBucket && lateWindow && isNotRising) {
      return {
        decision: "downgrade" as const,
        reason: isEn
          ? "METAR max is still close to this bucket, so AI cannot treat the NO bucket as confirmed."
          : "METAR 最高仍贴近目标桶，AI 不能把 NO 桶视为已确认。",
        evidence,
      };
    }
  }

  if (side === "yes") {
    if (aboveUpper) {
      return {
        decision: "veto" as const,
        reason: isEn
          ? "METAR max has already exceeded the bucket, so AI marks this YES bucket as outside the observed path."
          : "METAR 实测最高已越过目标桶上沿，AI 判断该 YES 桶已偏离实测路径。",
        evidence,
      };
    }
    if (belowLower && (lateWindow || isFalling || isNotRising)) {
      if (beforePeak && !lateWindow) {
        return {
          decision: "watchlist" as const,
          reason: isEn
            ? "The peak window has not arrived, so METAR not reaching the bucket only means this bucket still needs peak-window confirmation."
            : "峰值窗口尚未到来，METAR 未触达目标桶只能说明仍需等待峰值验证，AI 暂列观察。",
          evidence,
        };
      }
      return {
        decision: "downgrade" as const,
        reason: isEn
          ? "METAR max has not reached the bucket and recent observations are weak, so AI downgrades the YES bucket."
          : "METAR 最高仍未触达目标桶且走势不强，AI 将 YES 桶降级观察。",
        evidence,
      };
    }
    if (insideBucket) {
      return {
        decision: "approve" as const,
        reason: isEn
          ? "METAR max is inside the target bucket, so AI sees observation support while monitoring an overshoot."
          : "METAR 实测最高已落入目标桶，AI 认为 YES 桶有实测依据，但仍需防止继续升穿上沿。",
        evidence,
      };
    }
  }

  return {
    decision: "watchlist" as const,
    reason: isEn
      ? "METAR does not give a clean final confirmation yet, so AI keeps this as watchlist."
      : "METAR 还没有给出干净的最终确认，AI 暂列观察。",
    evidence,
  };
}
