import type { ScanOpportunityRow } from "@/lib/dashboard-types";
import {
  getMarketFocus,
  getRowMarketRegion,
  getRowPeakSortValue,
} from "@/lib/scan-market-focus";

export function formatShortDate(value?: string | null, locale = "zh-CN") {
  const text = String(value || "").trim();
  if (!text) return "--";
  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return text;
  return locale === "en-US"
    ? date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export function formatCountdownMinutes(value?: number | null, locale = "zh-CN") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  const minutes = Math.max(0, Math.round(Math.abs(numeric)));
  const hours = Math.floor(minutes / 60);
  const remains = minutes % 60;
  if (locale === "en-US") {
    if (hours <= 0) return `${remains}m`;
    if (remains <= 0) return `${hours}h`;
    return `${hours}h ${remains}m`;
  }
  if (hours <= 0) return `${remains} 分钟`;
  if (remains <= 0) return `${hours} 小时`;
  return `${hours} 小时 ${remains} 分钟`;
}

export function getPeakWindowLabel(row: ScanOpportunityRow) {
  const direct = String(row.peak_window_label || "").trim();
  if (direct) return direct;
  const start = String(row.peak_window_start || "").trim();
  const end = String(row.peak_window_end || "").trim();
  if (start && end) return `${start}-${end}`;
  return "--";
}

export function getPeakCountdownMeta(row: ScanOpportunityRow, locale = "zh-CN") {
  const isEn = locale === "en-US";
  const phase = String(row.window_phase || "").toLowerCase();
  const startDelta = Number(row.minutes_until_peak_start);
  const endDelta = Number(row.minutes_until_peak_end);
  const hasStart = Number.isFinite(startDelta);
  const hasEnd = Number.isFinite(endDelta);

  if (phase === "active_peak" || (hasStart && startDelta <= 0 && hasEnd && endDelta >= 0)) {
    return {
      key: "active",
      groupLabel: isEn ? "Peak window now" : "峰值窗口进行中",
      tone: "active",
      sort: 0,
      title: isEn ? "At peak window" : "已进入峰值窗口",
      detail:
        hasEnd && endDelta >= 0
          ? isEn
            ? `${formatCountdownMinutes(endDelta, locale)} left`
            : `剩余 ${formatCountdownMinutes(endDelta, locale)}`
          : getPeakWindowLabel(row),
    };
  }

  if (hasStart && startDelta > 0 && startDelta <= 180) {
    return {
      key: "next",
      groupLabel: isEn ? "Next 3 hours" : "未来 3 小时到峰值",
      tone: "next",
      sort: 1000 + startDelta,
      title: isEn
        ? `${formatCountdownMinutes(startDelta, locale)} to peak`
        : `还有 ${formatCountdownMinutes(startDelta, locale)} 到峰值`,
      detail: getPeakWindowLabel(row),
    };
  }

  if (hasStart && startDelta > 0 && startDelta <= 1440) {
    return {
      key: "today",
      groupLabel: isEn ? "Later today" : "今日稍后",
      tone: "upcoming",
      sort: 2000 + startDelta,
      title: isEn
        ? `${formatCountdownMinutes(startDelta, locale)} to peak`
        : `还有 ${formatCountdownMinutes(startDelta, locale)} 到峰值`,
      detail: getPeakWindowLabel(row),
    };
  }

  if (hasStart && startDelta > 1440) {
    return {
      key: "later",
      groupLabel: isEn ? "Later sessions" : "后续交易时段",
      tone: "later",
      sort: 3000 + startDelta,
      title: isEn
        ? `${formatCountdownMinutes(startDelta, locale)} to peak`
        : `还有 ${formatCountdownMinutes(startDelta, locale)} 到峰值`,
      detail: getPeakWindowLabel(row),
    };
  }

  return {
    key: "past",
    groupLabel: isEn ? "Past peak" : "峰值已过",
    tone: "past",
    sort: 9000 + Math.abs(startDelta || 0),
    title:
      hasEnd && endDelta < 0
        ? isEn
          ? `Peak passed ${formatCountdownMinutes(endDelta, locale)} ago`
          : `峰值已过 ${formatCountdownMinutes(endDelta, locale)}`
        : isEn
          ? "Peak window passed"
          : "峰值窗口已过",
    detail: getPeakWindowLabel(row),
  };
}

export function formatUserLocalTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}`;
}

export function getLocalDateIndex(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86_400_000);
}

export function getPhaseUrgency(row: ScanOpportunityRow) {
  const phase = String(row.window_phase || "").toLowerCase();
  if (phase === "active_peak") return 0;
  if (phase === "setup_today") return 1;
  if (phase === "post_peak") return 2;
  if (phase === "early_today") return 3;
  if (phase === "tomorrow") return 4;
  if (phase === "week_ahead") return 5;
  return 6;
}

export function sortRowsByUserTime(rows: ScanOpportunityRow[]) {
  const focus = getMarketFocus(rows);
  return [...rows].sort((left, right) => {
    const rl = Number(left.trading_region_sort) || 0;
    const rr = Number(right.trading_region_sort) || 0;
    if (rl !== rr) return rl - rr;

    if (focus) {
      const leftFocusRank = getRowMarketRegion(left) === focus.key ? 0 : 1;
      const rightFocusRank = getRowMarketRegion(right) === focus.key ? 0 : 1;
      if (leftFocusRank !== rightFocusRank) return leftFocusRank - rightFocusRank;
    }

    const leftPeakSort = getRowPeakSortValue(left);
    const rightPeakSort = getRowPeakSortValue(right);
    if (leftPeakSort.stage.rank !== rightPeakSort.stage.rank) {
      return leftPeakSort.stage.rank - rightPeakSort.stage.rank;
    }
    if (leftPeakSort.countdown !== rightPeakSort.countdown) {
      return leftPeakSort.countdown - rightPeakSort.countdown;
    }

    const leftDateIndex = getLocalDateIndex(left.selected_date || left.local_date);
    const rightDateIndex = getLocalDateIndex(right.selected_date || right.local_date);
    if (leftDateIndex !== rightDateIndex) return leftDateIndex - rightDateIndex;

    const leftRemaining = Number.isFinite(Number(left.remaining_window_minutes))
      ? Number(left.remaining_window_minutes)
      : Number.POSITIVE_INFINITY;
    const rightRemaining = Number.isFinite(Number(right.remaining_window_minutes))
      ? Number(right.remaining_window_minutes)
      : Number.POSITIVE_INFINITY;
    if (leftRemaining !== rightRemaining) return leftRemaining - rightRemaining;

    const leftPhase = getPhaseUrgency(left);
    const rightPhase = getPhaseUrgency(right);
    if (leftPhase !== rightPhase) return leftPhase - rightPhase;

    const scoreDelta = Number(right.final_score || 0) - Number(left.final_score || 0);
    if (scoreDelta !== 0) return scoreDelta;
    return Number(right.edge_percent || 0) - Number(left.edge_percent || 0);
  });
}

export function normalizeCityKey(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

export function prettifyCityName(value?: string | null) {
  return String(value || "")
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function rowMatchesCity(row: ScanOpportunityRow, cityName: string) {
  const cityKey = normalizeCityKey(cityName);
  if (!cityKey) return false;
  return [row.city, row.city_display_name, row.display_name].some(
    (value) => normalizeCityKey(value) === cityKey,
  );
}

export function findRowForCity(rows: ScanOpportunityRow[], cityName?: string | null) {
  const normalized = normalizeCityKey(cityName);
  if (!normalized) return null;
  return rows.find((row) => rowMatchesCity(row, cityName || "")) || null;
}
