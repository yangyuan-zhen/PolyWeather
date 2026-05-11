import type { ScanOpportunityRow } from "@/lib/dashboard-types";

export type MarketRegionKey =
  | "americas"
  | "europe_africa"
  | "asia_pacific"
  | "unknown";

type RegionMeta = {
  key: MarketRegionKey;
  labelEn: string;
  labelZh: string;
};

export type RowTradingStage = {
  key: string;
  rank: number;
  score: number;
  labelEn: string;
  labelZh: string;
};

export type MarketFocus = {
  key: MarketRegionKey;
  label: string;
  labelEn: string;
  labelZh: string;
  stageLabel: string;
  activeCityCount: number;
  opportunityCount: number;
  score: number;
  leadRow: ScanOpportunityRow | null;
};

const REGION_META: Record<MarketRegionKey, RegionMeta> = {
  americas: {
    key: "americas",
    labelEn: "Americas",
    labelZh: "美洲",
  },
  europe_africa: {
    key: "europe_africa",
    labelEn: "Europe / Africa",
    labelZh: "欧洲 / 非洲",
  },
  asia_pacific: {
    key: "asia_pacific",
    labelEn: "Asia-Pacific",
    labelZh: "亚太",
  },
  unknown: {
    key: "unknown",
    labelEn: "Global",
    labelZh: "全球",
  },
};

const CITY_REGION_FALLBACK: Record<string, MarketRegionKey> = {
  "new york": "americas",
  toronto: "americas",
  "los angeles": "americas",
  "san francisco": "americas",
  aurora: "americas",
  denver: "americas",
  austin: "americas",
  houston: "americas",
  "mexico city": "americas",
  chicago: "americas",
  dallas: "americas",
  miami: "americas",
  atlanta: "americas",
  seattle: "americas",
  "panama city": "americas",
  "buenos aires": "americas",
  "sao paulo": "americas",
  london: "europe_africa",
  paris: "europe_africa",
  istanbul: "europe_africa",
  ankara: "europe_africa",
  moscow: "europe_africa",
  helsinki: "europe_africa",
  amsterdam: "europe_africa",
  munich: "europe_africa",
  milan: "europe_africa",
  warsaw: "europe_africa",
  madrid: "europe_africa",
  lagos: "europe_africa",
  "cape town": "europe_africa",
  jeddah: "europe_africa",
  "tel aviv": "europe_africa",
  seoul: "asia_pacific",
  busan: "asia_pacific",
  "hong kong": "asia_pacific",
  "lau fau shan": "asia_pacific",
  taipei: "asia_pacific",
  shanghai: "asia_pacific",
  singapore: "asia_pacific",
  "kuala lumpur": "asia_pacific",
  jakarta: "asia_pacific",
  manila: "asia_pacific",
  karachi: "asia_pacific",
  tokyo: "asia_pacific",
  wellington: "asia_pacific",
  lucknow: "asia_pacific",
  chengdu: "asia_pacific",
  chongqing: "asia_pacific",
  shenzhen: "asia_pacific",
  guangzhou: "asia_pacific",
  qingdao: "asia_pacific",
  beijing: "asia_pacific",
  wuhan: "asia_pacific",
};

function normalizeKey(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function finiteNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function getMarketRegionMeta(
  key?: string | null,
  locale = "zh-CN",
): RegionMeta & { label: string } {
  const normalized = normalizeKey(key).replace(/\s+/g, "_") as MarketRegionKey;
  const meta = REGION_META[normalized] || REGION_META.unknown;
  return {
    ...meta,
    label: locale === "en-US" ? meta.labelEn : meta.labelZh,
  };
}

export function getRowMarketRegion(row: ScanOpportunityRow): MarketRegionKey {
  const direct = normalizeKey(row.trading_region).replace(/\s+/g, "_");
  if (direct in REGION_META) return direct as MarketRegionKey;

  const offset = finiteNumber(row.tz_offset_seconds);
  if (offset !== null) {
    if (offset <= -7200) return "americas";
    if (offset >= 14400) return "asia_pacific";
    return "europe_africa";
  }

  const cityKey = normalizeKey(row.city || row.city_display_name || row.display_name);
  return CITY_REGION_FALLBACK[cityKey] || "unknown";
}

export function getRowTradingStage(row: ScanOpportunityRow): RowTradingStage {
  const phase = normalizeKey(row.window_phase);
  const startDelta = finiteNumber(row.minutes_until_peak_start);
  const endDelta = finiteNumber(row.minutes_until_peak_end);

  if (
    phase === "active peak" ||
    phase === "active_peak" ||
    (startDelta !== null && startDelta <= 0 && endDelta !== null && endDelta >= -120)
  ) {
    return {
      key: "active_peak",
      rank: 0,
      score: 4,
      labelEn: "Peak / settle window",
      labelZh: "峰值 / 结算窗口",
    };
  }

  if (
    phase === "setup today" ||
    phase === "setup_today" ||
    (startDelta !== null && startDelta > 0 && startDelta <= 180)
  ) {
    return {
      key: "setup_today",
      rank: 1,
      score: 3,
      labelEn: "Pre-peak setup",
      labelZh: "峰值前准备",
    };
  }

  if (
    phase === "post peak" ||
    phase === "post_peak" ||
    (endDelta !== null && endDelta < -120 && endDelta >= -300)
  ) {
    return {
      key: "post_peak",
      rank: 2,
      score: 2,
      labelEn: "Post-peak confirmation",
      labelZh: "峰值后确认",
    };
  }

  if (phase === "early today" || phase === "early_today") {
    return {
      key: "early_today",
      rank: 3,
      score: 0.5,
      labelEn: "Early session",
      labelZh: "早盘预备",
    };
  }

  if (phase === "tomorrow") {
    return {
      key: "tomorrow",
      rank: 4,
      score: 0.25,
      labelEn: "Next session",
      labelZh: "下一交易日",
    };
  }

  return {
    key: phase || "unknown",
    rank: 5,
    score: 0,
    labelEn: "Outside active window",
    labelZh: "非活跃窗口",
  };
}

export function getMarketFocus(
  rows: ScanOpportunityRow[],
  locale = "zh-CN",
): MarketFocus | null {
  if (!rows.length) return null;

  const regions = new Map<
    MarketRegionKey,
    {
      maxStageScore: number;
      maxStageRank: number;
      score: number;
      activeCities: Set<string>;
      rows: ScanOpportunityRow[];
      leadRow: ScanOpportunityRow | null;
      leadStage: RowTradingStage | null;
    }
  >();

  for (const row of rows) {
    const region = getRowMarketRegion(row);
    const stage = getRowTradingStage(row);
    const current =
      regions.get(region) ||
      {
        maxStageScore: 0,
        maxStageRank: 99,
        score: 0,
        activeCities: new Set<string>(),
        rows: [],
        leadRow: null,
        leadStage: null,
      };
    const opportunityScore =
      clamp(Number(row.final_score || 0) / 100, 0, 1) +
      clamp(Number(row.edge_percent || 0) / 40, 0, 1);
    current.rows.push(row);
    current.score += opportunityScore;
    if (stage.score > current.maxStageScore) {
      current.maxStageScore = stage.score;
      current.maxStageRank = stage.rank;
      current.leadRow = row;
      current.leadStage = stage;
      current.activeCities.clear();
    }
    if (stage.score === current.maxStageScore) {
      current.activeCities.add(normalizeKey(row.city || row.city_display_name));
      if (
        !current.leadRow ||
        Number(row.final_score || 0) > Number(current.leadRow.final_score || 0)
      ) {
        current.leadRow = row;
        current.leadStage = stage;
      }
    }
    regions.set(region, current);
  }

  const ranked = [...regions.entries()].sort((left, right) => {
    const [, leftValue] = left;
    const [, rightValue] = right;
    const stageDelta = rightValue.maxStageScore - leftValue.maxStageScore;
    if (stageDelta !== 0) return stageDelta;
    const rankDelta = leftValue.maxStageRank - rightValue.maxStageRank;
    if (rankDelta !== 0) return rankDelta;
    const activeDelta = rightValue.activeCities.size - leftValue.activeCities.size;
    if (activeDelta !== 0) return activeDelta;
    return rightValue.score - leftValue.score;
  });

  const [key, value] = ranked[0] || [];
  if (!key || !value) return null;
  const meta = getMarketRegionMeta(key, locale);
  const stage = value.leadStage || getRowTradingStage(value.leadRow || rows[0]);

  return {
    key,
    label: meta.label,
    labelEn: meta.labelEn,
    labelZh: meta.labelZh,
    stageLabel: locale === "en-US" ? stage.labelEn : stage.labelZh,
    activeCityCount: value.activeCities.size,
    opportunityCount: value.rows.length,
    score: value.maxStageScore * 100 + value.activeCities.size * 10 + value.score,
    leadRow: value.leadRow,
  };
}

export function getRowPeakSortValue(row: ScanOpportunityRow) {
  const stage = getRowTradingStage(row);
  const startDelta = finiteNumber(row.minutes_until_peak_start);
  const endDelta = finiteNumber(row.minutes_until_peak_end);
  const remaining = finiteNumber(row.remaining_window_minutes);
  const countdown =
    stage.key === "active_peak"
      ? remaining ?? Math.abs(endDelta ?? 0)
      : stage.key === "post_peak"
        ? Math.abs(endDelta ?? 0)
        : Math.abs(startDelta ?? remaining ?? 9999);
  return {
    stage,
    countdown,
  };
}
