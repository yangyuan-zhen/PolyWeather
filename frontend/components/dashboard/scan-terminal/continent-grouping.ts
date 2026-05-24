import type { ScanOpportunityRow } from "@/lib/dashboard-types";

export const TRADING_REGIONS = [
  { key: "east_asia", labelEn: "East Asia", labelZh: "东亚", sort: 1 },
  { key: "southeast_asia", labelEn: "Southeast Asia", labelZh: "东南亚", sort: 2 },
  { key: "central_asia", labelEn: "Central / South Asia", labelZh: "中亚 / 南亚", sort: 3 },
  { key: "west_asia", labelEn: "West Asia / Middle East", labelZh: "西亚 / 中东", sort: 4 },
  { key: "europe_africa", labelEn: "Europe / Africa", labelZh: "欧洲 / 非洲", sort: 5 },
  { key: "south_america", labelEn: "Latin America", labelZh: "拉美", sort: 6 },
  { key: "north_america", labelEn: "North America", labelZh: "北美", sort: 7 },
] as const;

export type TradingRegionKey = (typeof TRADING_REGIONS)[number]["key"];

const TRADING_REGION_KEYS = new Set<string>(TRADING_REGIONS.map((region) => region.key));

const CITY_REGION_FALLBACK: Record<string, TradingRegionKey> = {
  beijing: "east_asia",
  busan: "east_asia",
  chengdu: "east_asia",
  chongqing: "east_asia",
  guangzhou: "east_asia",
  "hong kong": "east_asia",
  "lau fau shan": "east_asia",
  qingdao: "east_asia",
  seoul: "east_asia",
  shanghai: "east_asia",
  shenzhen: "east_asia",
  taipei: "east_asia",
  tokyo: "east_asia",
  wuhan: "east_asia",
  jakarta: "southeast_asia",
  "kuala lumpur": "southeast_asia",
  manila: "southeast_asia",
  singapore: "southeast_asia",
  karachi: "central_asia",
  lucknow: "central_asia",
  ankara: "west_asia",
  istanbul: "west_asia",
  jeddah: "west_asia",
  "tel aviv": "west_asia",
  amsterdam: "europe_africa",
  "cape town": "europe_africa",
  helsinki: "europe_africa",
  london: "europe_africa",
  madrid: "europe_africa",
  milan: "europe_africa",
  moscow: "europe_africa",
  munich: "europe_africa",
  paris: "europe_africa",
  warsaw: "europe_africa",
  "buenos aires": "south_america",
  "sao paulo": "south_america",
  "mexico city": "north_america",
  atlanta: "north_america",
  austin: "north_america",
  chicago: "north_america",
  dallas: "north_america",
  denver: "north_america",
  houston: "north_america",
  "los angeles": "north_america",
  miami: "north_america",
  "new york": "north_america",
  "panama city": "north_america",
  "san francisco": "north_america",
  seattle: "north_america",
  toronto: "north_america",
};

function normalizeRegionValue(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "_");
}

function normalizeCityValue(value?: string | null) {
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

export function resolveTradingRegionKey(row: ScanOpportunityRow): TradingRegionKey | null {
  const direct = normalizeRegionValue(row.trading_region);
  if (TRADING_REGION_KEYS.has(direct)) return direct as TradingRegionKey;

  const cityKey = normalizeCityValue(row.city || row.city_display_name || row.display_name);
  const cityRegion = CITY_REGION_FALLBACK[cityKey];
  if (cityRegion) return cityRegion;

  const offset = finiteNumber(row.tz_offset_seconds);
  if (offset !== null) {
    const hours = offset / 3600;
    if (hours >= 8) return "east_asia";
    if (hours >= 7) return "southeast_asia";
    if (hours >= 5) return "central_asia";
    if (hours >= 3) return "west_asia";
    if (hours >= 0) return "europe_africa";
    if (hours >= -5) return "south_america";
    return "north_america";
  }

  return null;
}

export interface ContinentGroup {
  key: TradingRegionKey | "active_signals";
  labelEn: string;
  labelZh: string;
  sort: number;
  rows: ScanOpportunityRow[];
  activeCount: number;
  watchCount: number;
  hotCity: string | null;
  localTimeRange: string | null;
}

export function isActiveSignal(row: ScanOpportunityRow): boolean {
  const decision = String(row.ai_decision || row.v4_metar_decision || "").toLowerCase();
  if (decision.includes("approve")) return true;
  if (row.tradable && row.active) return true;
  return false;
}

export function isWatchSignal(row: ScanOpportunityRow): boolean {
  const decision = String(row.ai_decision || row.v4_metar_decision || row.signal_status || "").toLowerCase();
  if (decision.includes("watch")) return true;
  if (decision.includes("monitor")) return true;
  if (!row.tradable && row.active) return true;
  return false;
}

export function isDeadSignal(row: ScanOpportunityRow): boolean {
  if (row.closed) return true;
  const decision = String(row.ai_decision || row.v4_metar_decision || "").toLowerCase();
  if (decision.includes("veto")) return true;
  return false;
}

export function getSignalState(row: ScanOpportunityRow): "active" | "watch" | "closed" | "data" {
  if (isDeadSignal(row)) return "closed";
  if (isActiveSignal(row)) return "active";
  if (isWatchSignal(row)) return "watch";
  return "data";
}

export function getSignalLabel(state: ReturnType<typeof getSignalState>, isEn: boolean): string {
  switch (state) {
    case "active": return isEn ? "◆ Active" : "◆ 活跃";
    case "watch": return isEn ? "● Watch" : "● 观察";
    case "closed": return isEn ? "○ Closed" : "○ 关闭";
    case "data": return isEn ? "! Data" : "! 数据";
  }
}

export type GapColor = "green" | "orange" | "slate" | "gray" | "red";

export function getGapColor(row: ScanOpportunityRow): GapColor {
  const gap = Number(row.signed_gap ?? row.gap_to_target);
  const edge = Number(row.edge_percent || 0);
  const spread = Number(row.spread || 0);
  const liq = Number(row.book_liquidity || row.market_liquidity || 0);

  if (!Number.isFinite(gap)) return "gray";
  if (liq <= 0 || spread > 20) return "red";
  if (gap >= 2) return "green";
  if (gap >= 0 && edge > 5) return "orange";
  if (gap >= 0) return "slate";
  if (gap < -5 || edge < -10) return "gray";
  return "slate";
}

export const GAP_COLOR_MAP: Record<GapColor, string> = {
  green: "text-emerald-600",
  orange: "text-amber-600",
  slate: "text-slate-500",
  gray: "text-slate-400",
  red: "text-red-500",
};

export function formatPrice(midpoint?: number | null, ask?: number | null, bid?: number | null): string {
  const m = Number(midpoint);
  if (Number.isFinite(m) && m > 0) {
    const cents = Math.round(m * 100);
    return `Y ${cents}¢`;
  }
  const a = Number(ask);
  if (Number.isFinite(a) && a > 0) {
    const cents = Math.round(a * 100);
    return `Y ${cents}¢`;
  }
  return "--";
}

export function formatSpreadLiquidity(spread?: number | null, liquidity?: number | null): string {
  const sp = Number(spread);
  const liq = Number(liquidity);
  const spStr = Number.isFinite(sp) ? `${Math.round(sp)}¢` : "--";
  const liqStr = Number.isFinite(liq)
    ? liq >= 1000
      ? `$${(liq / 1000).toFixed(1)}K`
      : `$${Math.round(liq)}`
    : "--";
  return `${spStr} / ${liqStr}`;
}

export function buildContinentGroups(rows: ScanOpportunityRow[], isEn: boolean): ContinentGroup[] {
  const regionMap = new Map<string, ScanOpportunityRow[]>();

  for (const row of rows) {
    const region = resolveTradingRegionKey(row) || "unknown";
    if (!regionMap.has(region)) regionMap.set(region, []);
    regionMap.get(region)!.push(row);
  }

  const groups: ContinentGroup[] = [];

  // Active Signals virtual group
  const activeRows = rows.filter((r) => isActiveSignal(r));
  if (activeRows.length > 0) {
    const hotRow = activeRows.reduce((best, r) =>
      Number(r.edge_percent || 0) > Number(best.edge_percent || 0) ? r : best
    );
    groups.push({
      key: "active_signals",
      labelEn: "Active Signals",
      labelZh: "活跃信号",
      sort: 0,
      rows: activeRows,
      activeCount: activeRows.filter((r) => isActiveSignal(r)).length,
      watchCount: activeRows.filter((r) => isWatchSignal(r)).length,
      hotCity: hotRow?.city_display_name || hotRow?.city || null,
      localTimeRange: null,
    });
  }

  for (const region of TRADING_REGIONS) {
    const regionRows = regionMap.get(region.key) || [];
    if (regionRows.length === 0) continue;

    const activeCount = regionRows.filter((r) => isActiveSignal(r)).length;
    const watchCount = regionRows.filter((r) => isWatchSignal(r)).length;
    const sorted = [...regionRows].sort((a, b) =>
      Number(b.final_score || 0) - Number(a.final_score || 0)
    );
    const hotCity = sorted[0]?.city_display_name || sorted[0]?.city || null;

    const times = regionRows
      .map((r) => String(r.local_time || "").trim())
      .filter(Boolean)
      .sort();
    const ltRange = times.length >= 2
      ? `${times[0]}-${times[times.length - 1]}`
      : times[0] || null;

    groups.push({
      key: region.key,
      labelEn: region.labelEn,
      labelZh: region.labelZh,
      sort: region.sort,
      rows: regionRows,
      activeCount,
      watchCount,
      hotCity,
      localTimeRange: ltRange,
    });
  }

  groups.sort((a, b) => a.sort - b.sort);
  return groups;
}

export function getDefaultExpanded(groups: ContinentGroup[]): Set<string> {
  const expanded = new Set<string>();
  for (const g of groups) {
    if (g.key === "active_signals") {
      expanded.add(g.key);
    } else if (g.activeCount > 0 || g.watchCount > 0) {
      expanded.add(g.key);
    }
  }
  return expanded;
}
