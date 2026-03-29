import type { CityDetail } from "@/lib/dashboard-types";
import type { Locale } from "@/lib/i18n";

const CITY_TO_MARKET_SLUG: Record<string, string> = {
  ankara: "ankara",
  atlanta: "atlanta",
  austin: "austin",
  beijing: "beijing",
  "buenos aires": "buenos-aires",
  chengdu: "chengdu",
  chicago: "chicago",
  chongqing: "chongqing",
  dallas: "dallas",
  houston: "houston",
  "hong kong": "hong-kong",
  istanbul: "istanbul",
  london: "london",
  "los angeles": "los-angeles",
  lucknow: "lucknow",
  madrid: "madrid",
  mexico: "mexico-city",
  "mexico city": "mexico-city",
  miami: "miami",
  milan: "milan",
  munich: "munich",
  "new york": "nyc",
  paris: "paris",
  "san francisco": "san-francisco",
  "sao paulo": "sao-paulo",
  seattle: "seattle",
  seoul: "seoul",
  shanghai: "shanghai",
  shenzhen: "shenzhen",
  singapore: "singapore",
  taipei: "taipei",
  "tel aviv": "tel-aviv",
  tokyo: "tokyo",
  toronto: "toronto",
  warsaw: "warsaw",
  wellington: "wellington",
  wuhan: "wuhan",
};

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function normalizeCityKey(detail?: CityDetail | null) {
  return String(detail?.name || detail?.display_name || "")
    .trim()
    .toLowerCase();
}

function slugifyCityName(cityKey: string) {
  return cityKey
    .trim()
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/&/g, " and ")
    .replace(/\s+/g, "-");
}

function normalizeDateParts(localDate?: string | null) {
  const value = String(localDate || "").trim();
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(monthIndex) ||
    !Number.isFinite(day) ||
    monthIndex < 0 ||
    monthIndex > 11
  ) {
    return null;
  }
  return {
    year,
    month: MONTHS[monthIndex],
    day,
  };
}

export function getTodayPolymarketUrl(
  detail?: CityDetail | null,
  locale: Locale = "en-US",
) {
  const cityKey = normalizeCityKey(detail);
  const citySlug = CITY_TO_MARKET_SLUG[cityKey] || slugifyCityName(cityKey);
  const dateParts = normalizeDateParts(detail?.local_date);
  if (!citySlug || !dateParts) return null;

  const prefix =
    locale === "zh-CN"
      ? "https://polymarket.com/zh/event/"
      : "https://polymarket.com/event/";

  return `${prefix}highest-temperature-in-${citySlug}-on-${dateParts.month}-${dateParts.day}-${dateParts.year}`;
}
