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

function getOpportunityCardKey(row: ScanOpportunityRow) {
  const city =
    normalizeCityKey(row.city) ||
    normalizeCityKey(row.city_display_name) ||
    normalizeCityKey(row.display_name);
  const date = String(row.selected_date || row.local_date || "").trim();
  if (city || date) {
    return `${city || row.id}:${date || "date-unknown"}`;
  }
  return row.id;
}

function getOpportunitySortScore(row: ScanOpportunityRow) {
  return Number(row.final_score || 0) * 1000 + Number(row.edge_percent || 0);
}

function dedupeOpportunityCards(rows: ScanOpportunityRow[]) {
  const bestByCard = new Map<string, ScanOpportunityRow>();
  for (const row of rows) {
    const key = getOpportunityCardKey(row);
    const current = bestByCard.get(key);
    if (!current || getOpportunitySortScore(row) > getOpportunitySortScore(current)) {
      bestByCard.set(key, row);
    }
  }
  return [...bestByCard.values()];
}

function takeUniqueOpportunityRows(
  candidates: ScanOpportunityRow[],
  usedCardKeys: Set<string>,
  limit: number,
) {
  const picked: ScanOpportunityRow[] = [];
  for (const row of candidates) {
    const key = getOpportunityCardKey(row);
    if (usedCardKeys.has(key)) continue;
    usedCardKeys.add(key);
    picked.push(row);
    if (picked.length >= limit) break;
  }
  return picked;
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

export function formatRowProbability(value?: number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  const normalized = numeric > 1 ? numeric / 100 : numeric;
  return `${(normalized * 100).toFixed(0)}%`;
}

export function formatRowPrice(value?: number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  return `${Math.round((numeric > 1 ? numeric / 100 : numeric) * 100)}¢`;
}

export function formatRowSignedPercent(value?: number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  const normalized = Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
  return `${normalized > 0 ? "+" : ""}${normalized.toFixed(1)}%`;
}

export function normalizeRowPercentDelta(value?: number | null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.abs(numeric) <= 1 ? numeric * 100 : numeric;
}

export function getRowTemperatureBucket(row: ScanOpportunityRow) {
  const direct = String(row.target_label || "").trim();
  if (direct) return direct;
  const unit = row.target_unit || row.temp_symbol || "°C";
  const lower = Number(row.target_lower);
  const upper = Number(row.target_upper);
  if (Number.isFinite(lower) && Number.isFinite(upper)) {
    return `${lower.toFixed(0)}-${upper.toFixed(0)}${unit}`;
  }
  const threshold = Number(row.target_threshold ?? row.target_value);
  if (Number.isFinite(threshold)) {
    const direction = String(row.temperature_direction || row.market_direction || row.side || "").toLowerCase();
    if (direction.includes("below") || direction.includes("under") || direction.includes("no")) {
      return `≤ ${threshold.toFixed(0)}${unit}`;
    }
    return `≥ ${threshold.toFixed(0)}${unit}`;
  }
  return "--";
}

export function getRowDecisionMeta(row: ScanOpportunityRow, locale = "zh-CN") {
  const isEn = locale === "en-US";
  const edge = normalizeRowPercentDelta(row.edge_percent ?? row.gap ?? row.signed_gap);
  const phase = getPeakCountdownMeta(row, locale);
  const metarDecision = String(row.v4_metar_decision || row.ai_decision || "").toLowerCase();
  const tradable = Boolean(row.tradable || row.accepting_orders);
  const closed = row.closed || (row.active === false && !tradable);
  if (closed) {
    return {
      tone: "avoid",
      action: isEn ? "Skip" : "放弃",
      reason: isEn ? "Market is closed or inactive." : "市场已关闭或不活跃。",
    };
  }
  if (metarDecision === "veto") {
    return {
      tone: "avoid",
      action: isEn ? "Avoid" : "暂不交易",
      reason:
        (isEn ? row.v4_metar_reason_en || row.ai_reason_en : row.v4_metar_reason_zh || row.ai_reason_zh) ||
        (isEn ? "METAR does not support the setup." : "METAR 暂不支持该方向。"),
    };
  }
  if (edge != null && edge >= 8 && tradable) {
    return {
      tone: "trade",
      action: isEn ? "Watch now" : "重点关注",
      reason:
        (isEn ? row.ai_reason_en || row.ai_city_thesis_en : row.ai_reason_zh || row.ai_city_thesis_zh) ||
        (isEn ? "Weather probability is above market pricing." : "天气概率高于市场隐含概率。"),
    };
  }
  if (phase.key === "next" || phase.key === "today") {
    return {
      tone: "wait",
      action: isEn ? "Wait for confirmation" : "等待确认",
      reason:
        (isEn ? row.ai_watchlist_reason_en || row.ai_forecast_match_reason_en : row.ai_watchlist_reason_zh || row.ai_forecast_match_reason_zh) ||
        phase.title,
    };
  }
  if (metarDecision === "downgrade" || row.risk_level === "high") {
    return {
      tone: "risk",
      action: isEn ? "Observe only" : "只观察",
      reason:
        (isEn ? row.v4_metar_reason_en || row.ai_reason_en : row.v4_metar_reason_zh || row.ai_reason_zh) ||
        (isEn ? "Risk is elevated; require more confirmation." : "风险偏高，需要更多确认。"),
    };
  }
  return {
    tone: "neutral",
    action: isEn ? "Review" : "观察",
    reason:
      (isEn ? row.ai_reason_en || row.ai_city_thesis_en : row.ai_reason_zh || row.ai_city_thesis_zh) ||
      (isEn ? "Open the decision card to verify weather evidence." : "打开决策卡查看天气证据。"),
  };
}

export function pickOpportunitySections(rows: ScanOpportunityRow[], locale = "zh-CN") {
  const isEn = locale === "en-US";
  const usedCardKeys = new Set<string>();
  const uniqueRows = dedupeOpportunityCards(rows);
  const top = takeUniqueOpportunityRows([...uniqueRows]
    .sort((left, right) => {
      const scoreDelta = Number(right.final_score || 0) - Number(left.final_score || 0);
      if (scoreDelta !== 0) return scoreDelta;
      return Number(right.edge_percent || 0) - Number(left.edge_percent || 0);
    }), usedCardKeys, 4);
  const peak = takeUniqueOpportunityRows(
    uniqueRows.filter((row) => {
      const meta = getPeakCountdownMeta(row, locale);
      return meta.key === "active" || meta.key === "next";
    }),
    usedCardKeys,
    4,
  );
  const model = takeUniqueOpportunityRows(
    uniqueRows.filter((row) => Number(row.cluster_model_count || 0) >= 4 || Number(row.consensus_score || 0) >= 0.65),
    usedCardKeys,
    4,
  );
  const risk = takeUniqueOpportunityRows(
    uniqueRows.filter((row) => row.risk_level === "high" || ["veto", "downgrade"].includes(String(row.v4_metar_decision || row.ai_decision || "").toLowerCase())),
    usedCardKeys,
    4,
  );
  return [
    {
      key: "top",
      title: isEn ? "Best opportunities" : "最值得关注",
      subtitle: isEn ? "Sorted by final score and edge." : "按综合分与概率差优先排序。",
      rows: top,
    },
    {
      key: "peak",
      title: isEn ? "Peak window soon" : "即将进入峰值窗口",
      subtitle: isEn ? "Timing-sensitive cities." : "需要卡时间确认的城市。",
      rows: peak,
    },
    {
      key: "model",
      title: isEn ? "Model consensus" : "模型高度一致",
      subtitle: isEn ? "Weather side has stronger model support." : "天气侧模型支撑更集中。",
      rows: model,
    },
    {
      key: "risk",
      title: isEn ? "High risk / avoid" : "高风险 / 不要碰",
      subtitle: isEn ? "Open only for post-mortem or monitoring." : "仅适合复盘或观察。",
      rows: risk,
    },
  ];
}

